import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const limit = 8 * 1024 * 1024;
const formats: Record<string, { demuxer: string; matches: (audio: Buffer) => boolean }> = {
  "audio/webm": { demuxer: "matroska", matches: audio => audio.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
  "audio/mp4": { demuxer: "mov", matches: audio => audio.toString("ascii", 4, 8) === "ftyp" },
  "audio/ogg": { demuxer: "ogg", matches: audio => audio.toString("ascii", 0, 4) === "OggS" },
  "audio/wav": { demuxer: "wav", matches: audio => audio.toString("ascii", 0, 4) === "RIFF" && audio.toString("ascii", 8, 12) === "WAVE" },
};
const run = promisify(execFile);
let busy = false;
const error = (message: string, status: number) => Response.json({ error: message }, { status });

export async function POST(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return error("Forbidden", 403);
  const mime = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  const format = Object.hasOwn(formats, mime) ? formats[mime] : undefined;
  if (!format || !request.body) return error("Unsupported recording format.", 415);
  if (Number(request.headers.get("content-length")) > limit) return error("Recording is too large.", 413);
  if (busy) return error("The Mac is already transcribing. Try again in a moment.", 429);
  busy = true;
  let directory: string | undefined;
  try {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let uploadTimedOut = false;
    const uploadDeadline = setTimeout(() => {
      uploadTimedOut = true;
      void reader.cancel().catch(() => {});
    }, 20_000);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          void reader.cancel().catch(() => {});
          return error("Recording is too large.", 413);
        }
        chunks.push(value);
      }
    } finally {
      clearTimeout(uploadDeadline);
    }
    if (uploadTimedOut) return error("The recording took too long to upload.", 408);
    const audio = Buffer.concat(chunks, size);
    if (!format.matches(audio)) return error("This recording could not be read.", 400);
    directory = await mkdtemp(join(tmpdir(), "rich-chat-voice-"));
    const file = join(directory, "audio");
    await writeFile(file, audio, { mode: 0o600 });
    const { stdout } = await run(process.env.TRANSCRIBE_UV || "uv", [
      "run", "--offline", "--python", "3.12", join(process.cwd(), "scripts/transcribe.py"), file, format.demuxer,
    ], {
      timeout: 100_000,
      killSignal: "SIGKILL",
      signal: request.signal,
      maxBuffer: 256 * 1024,
      env: {
        PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: process.env.NODE_ENV,
        HF_HOME: process.env.HF_HOME, HF_HUB_OFFLINE: "1",
        PI_WHISPER_MODEL: process.env.PI_WHISPER_MODEL,
        UV_CACHE_DIR: process.env.UV_CACHE_DIR, UV_PYTHON_INSTALL_DIR: process.env.UV_PYTHON_INSTALL_DIR,
      },
    });
    const result = JSON.parse(stdout.trim()) as { text?: unknown };
    const text = typeof result.text === "string" ? result.text.trim().slice(0, 8000) : "";
    if (!text) return error("No speech detected. Try recording again.", 422);
    return Response.json({ text }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return error("Local transcription failed. Try again or type your message.", 503);
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
    busy = false;
  }
}
