"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useThreadList } from "@openuidev/react-headless";
import type { Evidence, Item, ItemEvent, Plan } from "@/lib/tasks/store";
import type { JobView } from "@/lib/tasks/jobs";
import { activityLine } from "@/reply-activity";
import styles from "./tasks-panel.module.css";

/**
 * The Tasks panel (M9/M10): this chat's objective, todos, latest checkpoint and background jobs, stored on the server
 * per browser profile. The profile is a random id kept in this browser (no accounts); it is sent as a header to the
 * tasks API and as a cookie so the chat route can offer the plan tools for the same profile.
 */

const profileKey = "rich-ai-chat:profile";
let memoryProfile = "";

function readProfile() {
  try {
    let id = localStorage.getItem(profileKey) ?? "";
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
      id = crypto.randomUUID();
      localStorage.setItem(profileKey, id);
    }
    return id;
  } catch {
    memoryProfile ||= crypto.randomUUID();
    return memoryProfile;
  }
}
const noSubscribe = () => () => {};

type Snapshot = { chat: string | null; plan: Plan | null; jobs: JobView[] };
const eventLabels: Record<ItemEvent, string> = {
  start: "Start", pause: "Pause", block: "Block…", unblock: "Unblock", verify: "Mark done…", cancel: "Cancel", reopen: "Reopen",
};
const statusLabels: Record<string, string> = {
  pending: "To do", in_progress: "In progress", blocked: "Blocked", done: "Done", cancelled: "Cancelled",
  queued: "Queued", waiting: "Waiting", running: "Running", succeeded: "Succeeded", failed: "Failed",
};
const finalJob = new Set(["succeeded", "failed", "cancelled"]);

function ItemRow({ item, titles, act }: { item: Item; titles: Map<string, string>; act: (body: object) => Promise<void> }) {
  const [asking, setAsking] = useState<"block" | "verify" | null>(null);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<Evidence["kind"]>("test");
  const send = (event: ItemEvent, extra: object = {}) => act({ action: "event", itemId: item.id, event, version: item.version, ...extra })
    .then(() => { setAsking(null); setText(""); });
  return (
    <li className={styles.item} data-status={item.status} data-testid="task-item">
      <div className={styles.itemHead}>
        <span className={styles.check} aria-hidden>{item.status === "done" ? "☑" : "☐"}</span>
        <span className={styles.title}>{item.title}</span>
        <span className={styles.chip}>{statusLabels[item.status]}</span>
      </div>
      {item.dependsOn && item.status !== "done" ? <p className={styles.note}>After: {titles.get(item.dependsOn) ?? "another todo"}</p> : null}
      {item.blockedReason ? <p className={styles.note}>Blocked: {item.blockedReason}</p> : null}
      {item.evidence.map(evidence => <p key={evidence.ref} className={styles.note}>Evidence ({evidence.kind}): {evidence.ref}</p>)}
      <div className={styles.actions}>
        {item.allowed.map(event => (
          <button key={event} type="button" onClick={() => event === "block" || event === "verify" ? setAsking(event) : send(event)}>
            {eventLabels[event]}
          </button>
        ))}
      </div>
      {asking ? (
        <form className={styles.inline} onSubmit={event => {
          event.preventDefault();
          void send(asking, asking === "block" ? { reason: text } : { evidence: text.trim() ? [{ kind, ref: text }] : [] });
        }}>
          {asking === "verify" ? (
            <select aria-label="Evidence kind" value={kind} onChange={event => setKind(event.target.value as Evidence["kind"])}>
              <option value="test">Test</option><option value="artifact">Artifact</option><option value="receipt">Receipt</option>
            </select>
          ) : null}
          <input aria-label={asking === "block" ? "Why is it blocked?" : "Evidence"} value={text} onChange={event => setText(event.target.value)}
            placeholder={asking === "block" ? "Why is it blocked?" : "Test name, artifact or receipt id"} />
          <button type="submit">{asking === "block" ? "Block" : "Mark done"}</button>
          <button type="button" onClick={() => setAsking(null)}>Back</button>
        </form>
      ) : null}
    </li>
  );
}

function JobRow({ job, act }: { job: JobView; act: (body: object) => Promise<void> }) {
  const done = Math.min(job.nextStep, job.steps.length);
  const lines = job.events.map(event => ({ seq: `${event.requestId}-${event.seq}-${event.type}`, text: activityLine(event) }))
    .filter(row => row.text).slice(-5);
  return (
    <li className={styles.item} data-status={job.status} data-testid="task-job">
      <div className={styles.itemHead}>
        <span className={styles.title}>{job.title}</span>
        <span className={styles.chip}>{statusLabels[job.status]}</span>
      </div>
      <p className={styles.note}>Step {done} of {job.steps.length} committed · {job.model}{job.runs > 1 ? ` · ${job.runs} runs` : ""}</p>
      {job.waitingReason ? <p className={styles.reason} data-testid="job-reason">{job.waitingReason}</p> : null}
      {job.outcome ? <p className={styles.note}>{job.outcome.summary} · receipt {job.outcome.receiptKey}</p> : null}
      {lines.length ? <ul className={styles.events}>{lines.map((row, index) => <li key={row.seq + index}>{row.text}</li>)}</ul> : null}
      {!finalJob.has(job.status) && !job.cancelRequested ? (
        <div className={styles.actions}><button type="button" onClick={() => act({ action: "cancel-job", jobId: job.id })}>Cancel job</button></div>
      ) : null}
    </li>
  );
}

export function TasksPanel() {
  const chatId = useThreadList(state => state.selectedThreadId);
  const profile = useSyncExternalStore(noSubscribe, readProfile, () => "");
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot>({ chat: null, plan: null, jobs: [] });
  const [failure, setFailure] = useState({ chat: "", text: "" });
  const [draft, setDraft] = useState("");
  const [objective, setObjective] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (profile) document.cookie = `rich_chat_profile=${profile}; path=/; max-age=31536000; SameSite=Strict`;
  }, [profile]);

  const load = useCallback(() => {
    if (!profile || !chatId) return;
    fetch(`/api/tasks?chat=${encodeURIComponent(chatId)}`, { headers: { "x-rich-chat-profile": profile }, cache: "no-store" })
      .then(response => response.ok ? response.json() : undefined)
      .then(next => { if (next) setSnapshot({ chat: chatId, plan: next.plan, jobs: next.jobs }); })
      .catch(() => {});
  }, [chatId, profile]);

  const act = useCallback(async (body: object) => {
    if (!profile || !chatId) return;
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", "x-rich-chat-profile": profile },
      body: JSON.stringify({ chat: chatId, ...body }),
    });
    const next = await response.json().catch(() => ({ error: "The server did not answer" }));
    if (next.plan !== undefined) setSnapshot({ chat: chatId, plan: next.plan, jobs: next.jobs });
    setFailure({ chat: chatId, text: response.ok ? "" : next.error ?? "That change was refused" });
    if (!response.ok) throw new Error(next.error);
  }, [chatId, profile]);
  const tryAct = useCallback((body: object) => act(body).catch(() => {}), [act]);

  useEffect(load, [load]);
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(load, 2500);
    return () => clearInterval(timer);
  }, [open, load]);

  // Show only what was loaded for the chat on screen; switching chats never shows the previous chat's plan.
  const data = snapshot.chat === chatId ? snapshot : { chat: chatId, plan: null, jobs: [] as JobView[] };
  const error = failure.chat === chatId ? failure.text : "";
  const plan = data.plan;
  const openCount = plan?.items.filter(item => item.status !== "done" && item.status !== "cancelled").length ?? 0;
  const titles = new Map(plan?.items.map(item => [item.id, item.title]) ?? []);

  async function exportMarkdown() {
    if (!chatId) return;
    const response = await fetch(`/api/tasks/export?chat=${encodeURIComponent(chatId)}`, { headers: { "x-rich-chat-profile": profile } });
    if (!response.ok) { setFailure({ chat: chatId, text: "Nothing to export yet" }); return; }
    const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "plan.md";
    const url = URL.createObjectURL(await response.blob());
    const link = Object.assign(document.createElement("a"), { href: url, download: name });
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => { setOpen(!open); load(); }}>
        Tasks{openCount ? <span className={styles.badge}>{openCount}</span> : null}
      </button>
      {open ? (
        <aside className={styles.panel} aria-label="Tasks">
          <header className={styles.header}>
            <h2>Tasks</h2>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close tasks">×</button>
          </header>
          {!chatId ? <p className={styles.note}>Send a message first: each chat keeps its own plan.</p> : !plan ? (
            <form className={styles.inline} onSubmit={event => { event.preventDefault(); void tryAct({ action: "open", objective }).then(() => setObjective("")); }}>
              <input aria-label="Objective" value={objective} onChange={event => setObjective(event.target.value)} placeholder="What should this chat achieve?" />
              <button type="submit" disabled={!objective.trim()}>Start a plan</button>
            </form>
          ) : (
            <>
              <section>
                <h3>Objective</h3>
                <form className={styles.inline} onSubmit={event => {
                  event.preventDefault();
                  void tryAct({ action: "objective", taskId: plan.task.id, objective, version: plan.task.version }).then(() => setObjective(""));
                }}>
                  <p className={styles.objective} data-testid="task-objective">{plan.task.objective}</p>
                  <input aria-label="New objective" value={objective} onChange={event => setObjective(event.target.value)} placeholder="Change the objective" />
                  <button type="submit" disabled={!objective.trim()}>Save</button>
                </form>
              </section>
              <section>
                <h3>Todos</h3>
                <ul className={styles.list}>{plan.items.map(item => <ItemRow key={item.id} item={item} titles={titles} act={act} />)}</ul>
                <form className={styles.inline} onSubmit={event => { event.preventDefault(); void tryAct({ action: "add", title: draft }).then(() => setDraft("")); }}>
                  <input aria-label="New todo" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Add a todo" />
                  <button type="submit" disabled={!draft.trim()}>Add</button>
                </form>
              </section>
              <section>
                <h3>Latest checkpoint</h3>
                <p className={styles.note} data-testid="task-checkpoint">{plan.checkpoints[0] ? `${plan.checkpoints[0].note} (${plan.checkpoints[0].actor})` : "None yet."}</p>
                <form className={styles.inline} onSubmit={event => { event.preventDefault(); void tryAct({ action: "checkpoint", taskId: plan.task.id, note }).then(() => setNote("")); }}>
                  <input aria-label="New checkpoint" value={note} onChange={event => setNote(event.target.value)} placeholder="Where things stand" />
                  <button type="submit" disabled={!note.trim()}>Record</button>
                </form>
              </section>
              {data.jobs.length ? (
                <section>
                  <h3>Background jobs</h3>
                  <ul className={styles.list}>{data.jobs.map(job => <JobRow key={job.id} job={job} act={tryAct} />)}</ul>
                </section>
              ) : null}
              <footer className={styles.footer}><button type="button" onClick={() => void exportMarkdown()}>Export Markdown</button></footer>
            </>
          )}
          {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        </aside>
      ) : null}
    </>
  );
}
