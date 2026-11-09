import { recoveryEvent, type RecoveryEvent } from "@kakkoidev/ai-core";
import type { UIMessageStreamWriter } from "ai";
import type { GateDecision, GatePrompt, PromptSlice } from "@/lib/prompt-slices";

/**
 * What happened behind one reply, recorded where it actually happens (a tool's execute, an attempt's start and end),
 * so a retry never looks like a second search. Events carry ids, timings, statuses and short summaries built from an
 * allowlist: never prompt text, reply text, tool arguments, file contents or credentials.
 */
export type ActivityPath = "chat" | "app-build" | "revision" | "image-search" | "video-search" | "clock" | "table" | "chart"
  | "starter" | "tested-layout" | "transform" | "job" | "map" | "forecast";
export type TaskTool = "read_plan" | "propose_items" | "record_checkpoint" | "record_verification" | "queue_job";
export type ActivityTool = "web_search" | "image_search" | "video_search" | "current_datetime" | TaskTool;
/** Background job progress (M10): status changes, committed steps (`checkpoint`) and reclaimed leases (`requeued`). */
export type JobProgress = "queued" | "waiting" | "blocked" | "running" | "checkpoint" | "requeued" | "succeeded" | "failed" | "cancelled";

export type ActivityEvent = { requestId: string; seq: number; ms: number } & (
  | { type: "request"; path: ActivityPath; model: string }
  | { type: "attempt-start"; attempt: number }
  | { type: "attempt-end"; attempt: number; outcome: "answer" | "retry" | "gave-up"; reason?: string }
  | { type: "tool-start"; toolCallId: string; tool: ActivityTool }
  | { type: "tool-end"; toolCallId: string; tool: ActivityTool; elapsedMs: number; status: "ok" | "error"; summary: string }
  | { type: "check"; attempt: number; passed: boolean; reason?: string }
  | { type: "recovery"; method: "sources-synthesis" | "sources-only" | "clock" | "media" | "requested-search" }
  | { type: "core-recovery"; event: ReturnType<typeof recoveryEvent> }
  /** The Laya component gate (M3): which slices it chose, how sure it was, and which prompt the reply used. */
  | { type: "gate"; outcome: GateDecision["outcome"]; slices: PromptSlice[]; confidence?: number; elapsedMs: number; prompt: GatePrompt;
      reason?: string }
  | { type: "reply"; status: "done" | "failed" | "cancelled" }
  | { type: "job"; jobId: string; status: JobProgress; step?: number; steps?: number; reason?: string }
  /** Only in a chat the person switched to debugging: full text (their message, prompts, tool input and output, drafts). */
  | { type: "detail"; stage: string; text: string }
);

type Payload<T> = T extends unknown ? Omit<T, "requestId" | "seq" | "ms"> : never;
export type ActivityInput = Payload<ActivityEvent>;

/** Reasons are the app's own fixed sentences; cap them so nothing long can ride along. */
const short = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 200);

/** Detail text is capped so one request can't fill the browser's store or the debug file. */
const detailLimit = 40000;

/**
 * `log` receives the data-free events. With `debug` (the person switched "Debug this chat" on), `detail()` also
 * records full text: it streams to that person's browser and goes to `logDetail`, never to `log`.
 */
export function createActivity(log: (event: ActivityEvent) => void = () => {},
  { debug = false, logDetail = () => {} }: { debug?: boolean; logDetail?: (event: ActivityEvent) => void } = {}) {
  const requestId = crypto.randomUUID();
  const started = performance.now();
  const pending: ActivityEvent[] = [];
  let writer: UIMessageStreamWriter | undefined;
  let seq = 0;
  const send = (event: ActivityEvent) => writer?.write({ type: "data-activity", data: event, transient: true });
  return {
    requestId,
    record(input: ActivityInput) {
      const event = { ...input, requestId, seq: seq++, ms: Math.round(performance.now() - started) } as ActivityEvent;
      if ("reason" in event && event.reason) event.reason = short(event.reason);
      if ("summary" in event) event.summary = short(event.summary);
      // A check's reason can quote labels from the request, so the server log keeps only whether it passed.
      const logged = event.type === "check" ? { ...event, reason: undefined } : event;
      try { (event.type === "detail" ? logDetail : log)(logged); } catch { /* logging never breaks a reply */ }
      if (writer) send(event); else pending.push(event);
    },
    core(input: Omit<RecoveryEvent, "requestId">) {
      this.record({ type: "core-recovery", event: recoveryEvent({ ...input, requestId }) });
    },
    debug,
    /** Full text for debugging; does nothing unless this request is in debug mode. */
    detail(stage: string, text: string) {
      if (!debug) return;
      this.record({ type: "detail", stage: stage.slice(0, 80), text: text.length > detailLimit ? text.slice(0, detailLimit) + "\n[cut at 40,000 characters]" : text });
    },
    /** Stream buffered and later events to the browser with the reply. */
    attach(next: UIMessageStreamWriter) {
      writer = next;
      for (const event of pending.splice(0)) send(event);
    },
  };
}
export type Activity = ReturnType<typeof createActivity>;

const taskTools = new Set<ActivityTool>(["read_plan", "propose_items", "record_checkpoint", "record_verification", "queue_job"]);

/** A one-line, data-free summary of a tool result for the Activity panel. Task tools write their own short summary. */
export function toolSummary(tool: ActivityTool, result: unknown): { status: "ok" | "error"; summary: string } {
  const value = (result ?? {}) as { error?: unknown; untrustedSources?: { url: string }[]; count?: unknown; timeZone?: unknown;
    images?: unknown[]; videos?: unknown[]; summary?: unknown };
  if (typeof value.error === "string") return { status: "error", summary: value.error };
  if (taskTools.has(tool)) return { status: "ok", summary: typeof value.summary === "string" ? value.summary : "Updated the plan" };
  if (tool === "web_search") {
    const sources = value.untrustedSources ?? [];
    const sites = new Set(sources.map(source => { try { return new URL(source.url).hostname; } catch { return ""; } }).filter(Boolean));
    return { status: "ok", summary: `${sources.length} source${sources.length === 1 ? "" : "s"} from ${sites.size} site${sites.size === 1 ? "" : "s"}` };
  }
  if (tool === "image_search" || tool === "video_search") {
    const count = typeof value.count === "number" ? value.count : (value.images ?? value.videos ?? []).length;
    return { status: "ok", summary: `${count} ${tool === "image_search" ? "picture" : "video"}${count === 1 ? "" : "s"}` };
  }
  return { status: "ok", summary: typeof value.timeZone === "string" ? `Time zone ${value.timeZone}` : "Read the clock" };
}
