import type { UIMessageChunk } from "ai";

const deadlines = { opening: 40000, answer: 22000, tool: 40000 };
const maxAnswerLength = 68000;

/**
 * Collect a complete answer before exposing it to the OpenUI parser. Report
 * validated tool activity as it arrives, but don't publish partial tool inputs.
 */
export async function readChatAttempt(
  open: (guard: AbortController) => ReadableStream<UIMessageChunk>,
  client: AbortSignal,
  reportTool: (chunk: UIMessageChunk) => void,
  timeouts = deadlines,
) {
  const guard = new AbortController();
  const signal = AbortSignal.any([client, guard.signal]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let answer = "";
  let toolSeen = false;
  let meaningful = 0;
  let reason = "incomplete-stream";
  let reader: ReadableStreamDefaultReader<UIMessageChunk> | undefined;
  const arm = (phase: keyof typeof deadlines) => {
    clearTimeout(timer);
    timer = setTimeout(() => guard.abort(`stale-${phase}`), timeouts[phase]);
  };
  const cancel = () => { void reader?.cancel().catch(() => {}); };
  try {
    if (signal.aborted) return { toolSeen, reason: "cancelled" } as const;
    arm("opening");
    reader = open(guard).getReader();
    if (signal.aborted) cancel();
    signal.addEventListener("abort", cancel, { once: true });
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done || signal.aborted) break;
      switch (value.type) {
        case "text-delta": {
          const added = value.delta.replace(/\s/g, "").length;
          if (added && (!answer.trim() || meaningful + added >= 12)) {
            meaningful = 0;
            arm("answer");
          } else meaningful += added;
          answer += value.delta;
          if (answer.length > maxAnswerLength) guard.abort("answer-too-large");
          break;
        }
        case "tool-input-available":
          toolSeen = true;
          // The completed answer belongs to the synthesis step, not its preamble.
          answer = "";
          meaningful = 0;
          arm("tool");
          reportTool(value);
          break;
        case "tool-output-available":
        case "tool-output-error":
        case "tool-output-denied":
          toolSeen = true;
          meaningful = 0;
          arm("opening");
          reportTool(value);
          break;
        case "finish":
          if (value.finishReason === "stop" && answer.trim())
            return { toolSeen, answer } as const;
          return { toolSeen, reason: value.finishReason ?? "missing-finish-reason" } as const;
        case "error":
        case "abort":
          return { toolSeen, reason: "provider-interrupted" } as const;
      }
    }
  } catch {
    reason = "stream-error";
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
    cancel();
  }
  return { toolSeen, reason: client.aborted ? "cancelled" : guard.signal.aborted ? String(guard.signal.reason) : reason } as const;
}
