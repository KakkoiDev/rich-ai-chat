import type { UIMessageChunk } from "ai";
import { createProgressWatch } from "@kakkoidev/ai-core";

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
  const progress = createProgressWatch({ openingMs: timeouts.opening, answerMs: timeouts.answer, toolMs: timeouts.tool });
  let reason = "incomplete-stream";
  let reader: ReadableStreamDefaultReader<UIMessageChunk> | undefined;
  const arm = () => {
    clearTimeout(timer);
    const expired = progress.reason();
    if (expired) guard.abort(expired);
    else timer = setTimeout(arm, Math.ceil(progress.remainingMs()));
  };
  const cancel = () => { void reader?.cancel().catch(() => {}); };
  try {
    if (signal.aborted) return { toolSeen, reason: "cancelled" } as const;
    arm();
    reader = open(guard).getReader();
    if (signal.aborted) cancel();
    signal.addEventListener("abort", cancel, { once: true });
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done || signal.aborted) break;
      switch (value.type) {
        case "text-delta": {
          progress.observe("answer", value.delta);
          arm();
          answer += value.delta;
          if (answer.length > maxAnswerLength) guard.abort("answer-too-large");
          break;
        }
        case "tool-input-available":
          toolSeen = true;
          // The completed answer belongs to the synthesis step, not its preamble.
          answer = "";
          progress.observe("tool-start");
          arm();
          reportTool(value);
          break;
        case "tool-output-available":
        case "tool-output-error":
        case "tool-output-denied":
          toolSeen = true;
          progress.observe("tool-end");
          arm();
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
