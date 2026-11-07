"use client";

import { useEffect, useState } from "react";
import type { ActivityEvent } from "@/lib/activity";
import { activityStore, type ActivityEntry } from "@/lib/activity-store";
import { DebugDetails, line, summary } from "@/reply-activity";

type StoredMessage = { id: string; role: string; content: unknown };
type Filter = "all" | "problems" | "debug";

const chatKey = "rich-ai-chat";

function readJson<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? "") as T; } catch { return fallback; }
}

/** Text of a stored chat message: a string, or the text parts of a multi-part message. */
function text(content: unknown) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.flatMap(part => part?.type === "text" ? [String(part.text ?? "")] : part?.filename ? [`[file ${part.filename}]`] : []).join("\n");
  return "";
}

/** The question that started a request and the reply that followed it, from this browser's saved chat. */
function exchange(entry: ActivityEntry) {
  const messages = readJson<StoredMessage[]>(`${chatKey}:messages:${entry.threadId}`, []);
  const at = messages.findIndex(message => message.id === entry.userMessageId);
  if (at < 0) return { asked: undefined, reply: undefined };
  const next = messages.findIndex((message, index) => index > at && message.role === "user");
  const replies = messages.slice(at + 1, next < 0 ? undefined : next).filter(message => message.role === "assistant");
  return { asked: text(messages[at].content), reply: replies.map(message => text(message.content)).join("\n\n") || undefined };
}

/** A request had a problem when anything other than a clean first answer happened. */
export function hadProblem(entry: ActivityEntry) {
  return entry.ended !== "done" && !entry.events.some(event => event.type === "reply") || entry.events.some(event =>
    event.type === "attempt-end" && event.outcome !== "answer" || event.type === "check" && !event.passed
    || event.type === "tool-end" && event.status === "error" || event.type === "recovery"
    || event.type === "reply" && event.status !== "done");
}

const debugged = (entry: ActivityEntry) => entry.events.some(event => event.type === "detail");
const request = (entry: ActivityEntry) => entry.events.find(event => event.type === "request") as Extract<ActivityEvent, { type: "request" }> | undefined;

function download(name: string, body: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([body], { type: "application/x-ndjson" }));
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

export function ActivityLog() {
  const [entries, setEntries] = useState<ActivityEntry[] | undefined>();
  const [filter, setFilter] = useState<Filter>("all");
  const [titles, setTitles] = useState(new Map<string, string>());

  const reload = () => void activityStore.all().then(all => {
    setTitles(new Map(readJson<{ id: string; title?: string }[]>(`${chatKey}:threads`, []).map(thread => [thread.id, thread.title ?? "Chat"])));
    setEntries(all);
  });
  useEffect(reload, []);

  const shown = (entries ?? []).filter(entry => filter === "all" || (filter === "problems" ? hadProblem(entry) : debugged(entry)));
  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <main className="activity-log">
      <h1>Log</h1>
      <p>Every request this browser sent, with what happened behind each reply. It is stored in this browser only; the server keeps its own log without chat text.</p>
      <div className="activity-log__bar">
        <label>Show{" "}
          <select value={filter} onChange={event => setFilter(event.target.value as Filter)}>
            <option value="all">All requests</option>
            <option value="problems">Requests with problems</option>
            <option value="debug">Debugged chats</option>
          </select>
        </label>
        <button type="button" onClick={reload}>Refresh</button>
        <button type="button" disabled={!shown.length}
          onClick={() => download(`chat-log-${stamp}.jsonl`, shown.map(entry => JSON.stringify(entry)).join("\n") + "\n")}>
          Export without chat text
        </button>
        <button type="button" disabled={!shown.length}
          onClick={() => download(`chat-log-with-text-${stamp}.jsonl`, shown.map(entry => JSON.stringify({ ...entry, ...exchange(entry) })).join("\n") + "\n")}>
          Export with chat text
        </button>
        <button type="button" disabled={!entries?.length} onClick={() => {
          if (window.confirm("Delete the whole log in this browser? Your chats stay. This can't be undone.")) void activityStore.clear().then(reload);
        }}>Delete log</button>
      </div>
      {!entries ? <p>Loading…</p> : !shown.length ? <p>Nothing to show.</p> : (
        <ol aria-label="Requests">
          {shown.map(entry => {
            const { asked, reply } = exchange(entry);
            const ended = new Set(entry.events.flatMap(event => event.type === "tool-end" ? [event.toolCallId] : []));
            return (
              <li key={entry.userMessageId}>
                <details>
                  <summary>
                    {new Date(entry.startedAt).toLocaleString()} · {titles.get(entry.threadId) ?? "Deleted chat"} · {request(entry)?.model ?? "unknown model"} · {summary(entry, "no end recorded")}
                    {hadProblem(entry) && <span className="activity-log__flag">problem</span>}
                    {debugged(entry) && <span className="activity-log__flag">debug</span>}
                  </summary>
                  <h3>Asked</h3>
                  <pre>{asked ?? "Not in this browser's saved chats."}</pre>
                  <h3>Reply</h3>
                  <pre>{reply ?? "No saved reply."}</pre>
                  <h3>Events</h3>
                  <table>
                    <thead><tr><th scope="col">#</th><th scope="col">At</th><th scope="col">Event</th><th scope="col">What happened</th></tr></thead>
                    <tbody>
                      {entry.events.filter(event => event.type !== "detail").map(event => (
                        <tr key={event.seq}>
                          <td>{event.seq}</td>
                          <td>{(event.ms / 1000).toFixed(2)} s</td>
                          <td>{event.type}</td>
                          <td>{line(event, ended) ?? ""}<details><summary>Raw</summary><pre>{JSON.stringify(event, null, 2)}</pre></details></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <DebugDetails events={entry.events} />
                  <p>Request {entry.events[0]?.requestId ?? "unknown"} · chat {entry.threadId}</p>
                </details>
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
