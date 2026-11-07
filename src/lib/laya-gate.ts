import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { GateDecision } from "@/lib/prompt-slices";

/**
 * Client for the Laya sidecar (scripts/laya-sidecar.py): a long-lived Python process that answers typed questions
 * with pi-local-harness's `harness.laya`. Started on the first question, restarted when it dies, and never waited on
 * for longer than `timeoutMs`, so a slow, missing or broken sidecar costs a reply at most that long and the reply
 * uses the general path. Questions and answers never go to the log; callers record only the decision.
 */
export type SidecarLaunch = { command: string; args: string[]; env: Record<string, string> } | { unavailable: string };
export type LayaQuestion = { kind: "choice"; state: Record<string, string>; question: string; options: string[]; minConfidence: number };

type Reply = { answer?: unknown; confidence?: unknown; abstained?: unknown; unavailable?: unknown; reason?: unknown; error?: unknown; ready?: unknown;
  installed?: unknown; pinned?: unknown };

export function createLayaGate({ launch, timeoutMs, retryAfterMs = 60000, now = () => performance.now() }: {
  launch: () => SidecarLaunch;
  timeoutMs: number;
  /** After the sidecar reports it can't answer (not installed, not pinned) or keeps dying, ask again after this. */
  retryAfterMs?: number;
  now?: () => number;
}) {
  let child: ChildProcessWithoutNullStreams | undefined;
  let ready: Promise<string | undefined> | undefined; // resolves to a reason when unavailable
  let unavailableUntil = 0;
  let unavailableReason = "";
  let deaths: number[] = [];
  let nextId = 1;
  const pending = new Map<number, (reply: Reply) => void>();

  const settleAll = (reply: Reply) => {
    for (const resolve of pending.values()) resolve(reply);
    pending.clear();
  };
  const markUnavailable = (reason: string) => {
    unavailableReason = reason;
    unavailableUntil = now() + retryAfterMs;
  };

  function start(): Promise<string | undefined> {
    const how = launch();
    if ("unavailable" in how) {
      markUnavailable(how.unavailable);
      return Promise.resolve(how.unavailable);
    }
    const proc = spawn(how.command, how.args, { env: how.env as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"] });
    child = proc;
    proc.stderr.resume(); // never logged: it could echo a question
    proc.stdin.on("error", () => {});
    const lines = createInterface({ input: proc.stdout });
    let greet: ((reason: string | undefined) => void) | undefined;
    const greeted = new Promise<string | undefined>(resolve => { greet = resolve; });
    lines.on("line", line => {
      let reply: Reply & { id?: unknown };
      try { reply = JSON.parse(line); } catch { return; }
      if (reply.ready === true) {
        greet?.(reply.pinned === false ? "not-pinned" : reply.installed === false ? "not-installed" : undefined);
        return;
      }
      const resolve = typeof reply.id === "number" ? pending.get(reply.id) : undefined;
      if (resolve) { pending.delete(reply.id as number); resolve(reply); }
    });
    const ended = () => {
      if (child !== proc) return;
      child = undefined;
      ready = undefined;
      greet?.("exited");
      settleAll({ error: "exited" });
      // A sidecar that keeps dying is left alone for a while rather than restarted on every request.
      const time = now();
      deaths = [...deaths.filter(at => time - at < retryAfterMs), time];
      if (deaths.length >= 3) markUnavailable("keeps-exiting");
    };
    proc.on("exit", ended);
    proc.on("error", ended);
    return greeted.then(reason => {
      if (reason && reason !== "exited") { markUnavailable(reason); stop(); }
      else if (!reason) send({ warm: true }, () => {}); // load the model now, so the next question is fast
      return reason;
    });
  }

  function send(message: object, resolve: (reply: Reply) => void) {
    const id = nextId++;
    pending.set(id, resolve);
    try { child?.stdin.write(JSON.stringify({ id, ...message }) + "\n"); } catch { pending.delete(id); resolve({ error: "write" }); }
    return id;
  }

  function stop() {
    const running = child;
    child = undefined;
    ready = undefined;
    settleAll({ error: "stopped" });
    if (running && running.exitCode === null) running.kill();
  }

  /** Ask one typed question. Resolves within `timeoutMs` (plus a tick), never rejects. */
  async function ask({ kind, state, question, options, minConfidence }: LayaQuestion): Promise<GateDecision> {
    const begun = now();
    const elapsedMs = () => Math.round((now() - begun) * 10) / 10;
    if (now() < unavailableUntil) return { outcome: "unavailable", reason: unavailableReason, elapsedMs: elapsedMs() };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"timeout">(resolve => { timer = setTimeout(() => resolve("timeout"), timeoutMs); });
    try {
      if (!child) ready = undefined;
      ready ??= start();
      const reason = await Promise.race([ready, deadline]);
      if (reason === "timeout") return { outcome: "timeout", elapsedMs: elapsedMs() };
      if (reason) return { outcome: "unavailable", reason, elapsedMs: elapsedMs() };
      let id = 0;
      const answered = new Promise<Reply>(resolve => {
        id = send({ kind, state, question, options, min_confidence: minConfidence }, resolve);
      });
      const reply = await Promise.race([answered, deadline]);
      if (reply === "timeout") { pending.delete(id); return { outcome: "timeout", elapsedMs: elapsedMs() }; }
      if (reply.unavailable === true) {
        markUnavailable(typeof reply.reason === "string" ? reply.reason : "unavailable");
        return { outcome: "unavailable", reason: unavailableReason, elapsedMs: elapsedMs() };
      }
      if (reply.error !== undefined) return { outcome: "error", reason: String(reply.error).slice(0, 40), elapsedMs: elapsedMs() };
      const confidence = typeof reply.confidence === "number" && Number.isFinite(reply.confidence) ? reply.confidence : undefined;
      if (reply.abstained === false && typeof reply.answer === "string" && options.includes(reply.answer))
        return { outcome: "chosen", option: reply.answer, confidence, elapsedMs: elapsedMs() };
      return { outcome: "abstained", confidence, elapsedMs: elapsedMs() };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ask, stop };
}
export type LayaGate = ReturnType<typeof createLayaGate>;

/** The pinned pi-local-harness revision whose `harness/laya.py` the sidecar runs (cores.lock.json). */
type CoresLock = { "pi-local-harness": { commit: string; files: Record<string, string> } };

/**
 * How the server starts the real sidecar: PLH's own pinned laya runtime (installed by `plh setup laya`), the
 * checkout in RICH_CHAT_PLH_DIR (default ~/Code/pi-local-harness), and its data folder (PI_LAYA_DATA or
 * PI_AGENT_DATA, default ~/pi-local-harness-data). Nothing is ever downloaded: no runtime or model means unavailable.
 * The sidecar gets a minimal environment, never the server's keys.
 */
export function layaSidecarLaunch(env: NodeJS.ProcessEnv = process.env, root = process.cwd()): SidecarLaunch {
  const home = env.HOME || homedir();
  const data = env.PI_LAYA_DATA || env.PI_AGENT_DATA || join(home, "pi-local-harness-data");
  const plh = env.RICH_CHAT_PLH_DIR || join(home, "Code", "pi-local-harness");
  const python = join(data, "toolchain", "laya", "runtime", "bin", "python");
  if (!existsSync(python) || !existsSync(join(data, "toolchain", "laya", "model", "model.safetensors"))) return { unavailable: "not-installed" };
  if (!existsSync(join(plh, "harness", "laya.py"))) return { unavailable: "no-harness" };
  let sha256: string | undefined;
  try {
    sha256 = (JSON.parse(readFileSync(join(root, "cores.lock.json"), "utf8")) as CoresLock)["pi-local-harness"].files["harness/laya.py"];
  } catch { /* handled below */ }
  if (!sha256) return { unavailable: "no-pin" };
  return {
    command: python,
    args: ["-I", join(root, "scripts", "laya-sidecar.py"), "--plh", plh, "--sha256", sha256, "--data", data],
    env: { PATH: env.PATH ?? "/usr/bin:/bin", HOME: home, HF_HUB_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1", TRANSFORMERS_OFFLINE: "1" },
  };
}

/**
 * Whether the gate runs. RICH_CHAT_LAYA_GATE=1 turns it on, 0 off; otherwise `layaGateEnabledByDefault`. The owner's
 * rule: on by default only if Laya's accuracy on the questions it answers is at least 95%. Measured 2026-11-08 on the
 * synthetic sets (docs/BENCHMARK-PLAN.md): 97.8% on the development set, 95.0% on the held-out set.
 */
export const layaGateEnabledByDefault = true;
export function layaGateEnabled(env: NodeJS.ProcessEnv = process.env) {
  const flag = env.RICH_CHAT_LAYA_GATE;
  return flag === "1" ? true : flag === "0" ? false : layaGateEnabledByDefault;
}

/** Kept on globalThis so a development server's module reloads reuse the one sidecar instead of leaking more. */
const holder = globalThis as { richChatLayaGate?: LayaGate };
/** The server's one sidecar. RICH_CHAT_LAYA_COMMAND (a JSON array) replaces it, for tests with a stub. */
export function sharedLayaGate(env: NodeJS.ProcessEnv = process.env): LayaGate {
  const timeoutMs = Math.max(20, Number(env.RICH_CHAT_LAYA_TIMEOUT_MS) || 250);
  return holder.richChatLayaGate ??= createLayaGate({
    timeoutMs,
    launch: () => {
      if (env.RICH_CHAT_LAYA_COMMAND) {
        try {
          const [command, ...args] = JSON.parse(env.RICH_CHAT_LAYA_COMMAND) as string[];
          return { command, args, env: { PATH: env.PATH ?? "/usr/bin:/bin", HOME: env.HOME ?? homedir() } };
        } catch { return { unavailable: "bad-command" }; }
      }
      return layaSidecarLaunch(env);
    },
  });
}
