import { appendFile, mkdir, readdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ActivityEvent } from "@/lib/activity";

/**
 * The server's complete event log: one JSON line per Activity event, one file per UTC day, kept for `retentionDays`.
 * Events hold ids, timings, statuses and allowlisted summaries only (see activity.ts), so the log can be read for
 * debugging without exposing what anyone asked. RICH_CHAT_LOG_DIR moves it; RICH_CHAT_LOG_DIR=off turns it off.
 */
const retentionDays = 30;
/** Debug files hold what was asked, so they are kept for a week only. */
const debugRetentionDays = 7;
const configured = process.env.RICH_CHAT_LOG_DIR;
const directory = configured === "off" ? undefined
  : configured || join(homedir(), "Library", "Application Support", "Rich AI Chat", "logs");

let ready: Promise<boolean> | undefined;
let prunedOn = "";
let queue = Promise.resolve();

async function prepare(day: string) {
  if (!directory) return false;
  ready ??= mkdir(directory, { recursive: true }).then(() => true, () => false);
  if (!(await ready)) return false;
  if (prunedOn !== day) {
    prunedOn = day;
    const oldest = new Date(Date.now() - retentionDays * 86400000).toISOString().slice(0, 10);
    const debugOldest = new Date(Date.now() - debugRetentionDays * 86400000).toISOString().slice(0, 10);
    for (const name of await readdir(directory).catch(() => [])) {
      const match = /^(activity|debug)-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
      const date = match?.[2];
      if (date && date < (match![1] === "debug" ? debugOldest : oldest)) await unlink(join(directory, name)).catch(() => {});
    }
  }
  return true;
}

export function logActivity(event: ActivityEvent) {
  const at = new Date();
  const day = at.toISOString().slice(0, 10);
  const line = JSON.stringify({ at: at.toISOString(), ...event }) + "\n";
  // One writer at a time keeps lines whole; failures are dropped, never thrown into a reply.
  queue = queue.then(async () => {
    if (await prepare(day)) await appendFile(join(directory!, `activity-${day}.jsonl`), line);
  }).catch(() => {});
}

function append(file: (day: string) => string, line: string) {
  const day = new Date().toISOString().slice(0, 10);
  queue = queue.then(async () => {
    if (await prepare(day)) await appendFile(join(directory!, file(day)), line);
  }).catch(() => {});
}

/**
 * Full-text detail from a chat someone switched to debugging (their message, prompts, tool input and output,
 * drafts), in debug-<day>.jsonl beside the activity log, kept 7 days. Nothing is written for other chats.
 */
export function logDetail(event: ActivityEvent) {
  append(day => `debug-${day}.jsonl`, JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n");
}

/**
 * Benchmark diagnosis only: with RICH_CHAT_DEBUG_CAPTURE=1 the server also saves each rejected app draft (full text)
 * beside the log, so a failing synthetic case can be read. Never set it on a server people use: drafts contain what
 * was asked.
 */
export function debugCapture(requestId: string, step: string, problem: string, draft: string) {
  if (process.env.RICH_CHAT_DEBUG_CAPTURE !== "1" || !directory) return;
  const line = JSON.stringify({ at: new Date().toISOString(), requestId, step, problem, draft: draft.slice(0, 40000) }) + "\n";
  queue = queue.then(async () => {
    if (await prepare(new Date().toISOString().slice(0, 10))) await appendFile(join(directory!, "debug-drafts.jsonl"), line);
  }).catch(() => {});
}
