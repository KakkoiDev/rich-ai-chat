"use client";

import { useSyncExternalStore } from "react";
import type { ActivityEvent, ActivityTool } from "@/lib/activity";
import { activityStore, type ActivityEntry } from "@/lib/activity-store";

const pathWords: Record<string, string> = {
  chat: "Answered in chat", "app-build": "Built an app", revision: "Revised the app", "image-search": "Searched for pictures",
  "video-search": "Searched for videos", clock: "Read the clock", table: "Made a table", chart: "Made a chart",
  starter: "Opened a tested starter app", "tested-layout": "Used a tested app layout", transform: "Transformed the quoted text",
  page: "Read a linked page", job: "Background job run", map: "Looked up a map", forecast: "Looked up a temperature forecast",
};
const toolWords: Record<ActivityTool, [string, string]> = {
  read_page: ["Opening the linked page", "Read the linked page"],
  web_search: ["Searching the web", "Searched the web"],
  image_search: ["Searching for pictures", "Searched for pictures"],
  video_search: ["Searching for videos", "Searched for videos"],
  current_datetime: ["Reading the clock", "Read the clock"],
  read_plan: ["Reading the plan", "Read the plan"],
  propose_items: ["Proposing todos", "Proposed todos"],
  record_checkpoint: ["Recording a checkpoint", "Recorded a checkpoint"],
  record_verification: ["Recording a verification", "Recorded a verification"],
  queue_job: ["Queueing a background job", "Queued a background job"],
};
const reasonWords: Record<string, string> = {
  "empty-answer": "the model finished without writing an answer", "undisplayable-answer": "the response had nothing the chat could display",
  "stale-opening": "no reply started in time", "stale-answer": "the answer stalled", "stale-tool": "the step after the tool stalled",
  "provider-interrupted": "the model's connection ended", "repeated-reasoning": "the model kept repeating itself",
  "check-failed": "the app failed a check", "syntax-error": "the app's script had a syntax error",
  "incomplete-response": "the reply was incomplete", length: "the model hit its output limit", cancelled: "cancelled",
  "incomplete-stream": "the reply stream ended early", "stream-error": "the reply stream failed",
};
const recoveryWords = {
  "sources-synthesis": "Answered from the sources already found, without searching again",
  "sources-only": "Showed the sources found; the answer did not finish",
  clock: "Answered with the clock reading already taken",
  media: "Showed the results already found",
  "requested-search": "Searched the web because you asked; the model had answered without searching",
};
const toolNouns: Record<ActivityTool, [string, string]> = {
  read_page: ["page read", "page reads"],
  web_search: ["search", "searches"], image_search: ["picture search", "picture searches"],
  video_search: ["video search", "video searches"], current_datetime: ["clock reading", "clock readings"],
  read_plan: ["plan read", "plan reads"], propose_items: ["proposal", "proposals"],
  record_checkpoint: ["checkpoint", "checkpoints"], record_verification: ["verification", "verifications"],
  queue_job: ["queued job", "queued jobs"],
};
const jobWords: Record<string, string> = {
  queued: "Queued", waiting: "Waiting", blocked: "Blocked", running: "Running", checkpoint: "Checkpoint",
  requeued: "Requeued", succeeded: "Succeeded", failed: "Failed", cancelled: "Cancelled",
};
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

const gateWords = {
  abstained: "the classifier wasn't sure", unavailable: "the classifier isn't available", timeout: "the classifier was too slow",
  error: "the classifier failed",
};
const promptWords = { concise: "a plain-text prompt", sliced: "only those components", general: "the general prompt" };
const milliseconds = (ms: number) => `${Math.round(ms)} ms`;
const confidence = (value?: number) => value === undefined ? "" : ` (confidence ${value.toFixed(2)})`;

function gateLine(event: Extract<ActivityEvent, { type: "gate" }>) {
  if (event.outcome === "chosen")
    return `Chose ${event.slices.join(", ")} components${confidence(event.confidence)}; used ${promptWords[event.prompt]} · ${milliseconds(event.elapsedMs)}`;
  return `Component choice skipped: ${gateWords[event.outcome]}${confidence(event.confidence)}; used ${promptWords[event.prompt]} · ${milliseconds(event.elapsedMs)}`;
}

/** One readable line per Activity event (null for events that add nothing); the Tasks panel reuses it for jobs. */
export function activityLine(event: ActivityEvent, ended: Set<string> = new Set()) {
  switch (event.type) {
    case "request": return `${pathWords[event.path] ?? "Replied"} · model ${event.model}`;
    case "attempt-start": return event.attempt > 1 ? `Attempt ${event.attempt} started` : null;
    case "attempt-end":
      if (event.outcome === "answer") return null;
      return `Attempt ${event.attempt} stopped: ${reasonWords[event.reason ?? ""] ?? event.reason ?? "no reason given"}`
        + (event.outcome === "retry" ? ". Trying again." : ".");
    case "tool-start": return ended.has(event.toolCallId) ? null : `${toolWords[event.tool][0]}…`;
    case "tool-end": return event.status === "ok"
      ? `${toolWords[event.tool][1]} · ${event.summary} · ${seconds(event.elapsedMs)}`
      : `${toolWords[event.tool][1]}, but it failed: ${event.summary} · ${seconds(event.elapsedMs)}`;
    case "check": return event.passed ? event.reason || null : `Check failed: ${event.reason ?? "the app did not pass"}`;
    case "recovery": return recoveryWords[event.method];
    case "core-recovery":
      switch (event.event.type) {
        case "receipt-replay": return "Reused a completed tool result";
        case "receipt-reconcile": return "Skipped a tool whose earlier outcome is unknown";
        case "repair": return "Trying a different approach to repair the app";
        case "resume": return "Resumed saved work";
        case "stall": return event.event.reason === "total-timeout" && event.event.attempt === undefined
          ? "The revision reached its time limit" : null;
        default: return null; // The existing attempt and checkpoint lines already explain these.
      }
    case "gate": return gateLine(event);
    case "detail": return null;
    case "reply": return event.status === "done" ? `Finished in ${seconds(event.ms)}`
      : event.status === "cancelled" ? "Cancelled" : `Stopped without a complete answer after ${seconds(event.ms)}`;
    case "job": return `${jobWords[event.status] ?? event.status}`
      + (event.step && event.steps ? ` · step ${event.step} of ${event.steps}` : "")
      + (event.reason ? ` · ${event.reason}` : "");
  }
}

/** `unfinished` is what to say when no end was recorded: "working…" while this page is following the request. */
/** The name the log view uses. */
export const line = activityLine;

export function summary(entry: ActivityEntry, unfinished = "working…") {
  const counts = new Map<ActivityTool, number>();
  for (const event of entry.events) if (event.type === "tool-end") counts.set(event.tool, (counts.get(event.tool) ?? 0) + 1);
  const attempts = Math.max(0, ...entry.events.map(event => event.type === "attempt-start" ? event.attempt : 0));
  const reply = entry.events.find(event => event.type === "reply");
  const parts = [
    ...(counts.size ? [...counts].map(([tool, n]) => `${n} ${toolNouns[tool][n === 1 ? 0 : 1]}`) : ["no tools"]),
    ...(attempts > 1 ? [`${attempts} attempts`] : []),
    reply ? seconds(reply.ms) : entry.ended === "cancelled" ? "cancelled" : entry.ended ? "interrupted" : unfinished,
  ];
  return parts.join(" · ");
}

async function exportLog(threadId: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([await activityStore.exportThread(threadId)], { type: "application/x-ndjson" }));
  link.download = `chat-activity-${threadId.slice(0, 8)}.jsonl`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

/** Full-text records from a chat in debug mode: one collapsed block per stage. */
export function DebugDetails({ events }: { events: ActivityEvent[] }) {
  const details = events.flatMap(event => event.type === "detail" ? [event] : []);
  if (!details.length) return null;
  return (
    <section className="debug-details" aria-label="Debug details">
      <h4>Debug details</h4>
      {details.map(event => (
        <details key={event.seq}>
          <summary>{event.stage} · {event.text.length.toLocaleString()} characters · {seconds(event.ms)}</summary>
          <pre>{event.text}</pre>
        </details>
      ))}
    </section>
  );
}

/** The collapsed Activity line for the request a user message started; nothing when there is no record. */
export function ReplyActivity({ userMessageId }: { userMessageId: string }) {
  const entry = useSyncExternalStore(
    listener => activityStore.subscribe(userMessageId, listener),
    () => activityStore.get(userMessageId),
    () => undefined,
  );
  if (!entry) return null;
  const ended = new Set(entry.events.flatMap(event => event.type === "tool-end" ? [event.toolCallId] : []));
  const lines = entry.events.map(event => ({ seq: event.seq, text: activityLine(event, ended) })).filter(row => row.text);
  if (entry.ended && entry.ended !== "done") lines.push({ seq: -1, text: entry.ended === "cancelled" ? "Cancelled" : "The connection ended before the reply finished" });
  return (
    <details className="reply-activity">
      <summary>Activity · {summary(entry)}</summary>
      <ol aria-label="What happened">
        {lines.map(row => <li key={row.seq}>{row.text}</li>)}
      </ol>
      <p className="reply-activity__note">Reasoning summary: not available for this model.</p>
      <DebugDetails events={entry.events} />
      <div className="reply-activity__actions">
        <button type="button" onClick={() => void exportLog(entry.threadId)}>Export this chat&apos;s log</button>
        <a href="/log" target="_blank" rel="noopener">Open the full log</a>
      </div>
    </details>
  );
}
