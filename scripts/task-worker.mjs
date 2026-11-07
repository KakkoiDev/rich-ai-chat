#!/usr/bin/env node
// The background job worker (M10): a Node process beside the Next server, sharing its SQLite database.
//   RICH_CHAT_DATA_DIR=<same folder as the server> node scripts/task-worker.mjs      (or: npm run worker)
// Settings (environment): RICH_CHAT_WORKER_LEASE_MS (30000), RICH_CHAT_WORKER_HEARTBEAT_MS (5000),
// RICH_CHAT_WORKER_POLL_MS (1000), RICH_CHAT_WORKER_CONCURRENCY (2), RICH_CHAT_WORKER_ID (host-pid),
// RICH_CHAT_WORKER_MODEL_BASE_URL (send every job to one OpenAI-compatible server, e.g. a stub in tests).
// Several workers may run at once: leases decide who runs a job. SIGTERM/SIGINT stop claiming and wait for the
// current steps; a killed worker's jobs are reclaimed when its lease expires and resume from their last checkpoint.
import { hostname } from "node:os";
import { createActivity } from "../src/lib/activity.ts";
import { logActivity } from "../src/lib/activity-log.ts";
import { createJobs } from "../src/lib/tasks/jobs.ts";
import { createTaskStore, taskDatabasePath } from "../src/lib/tasks/store.ts";
import { createWorker } from "../src/lib/tasks/worker.ts";
import { workerGenerate } from "../src/lib/tasks/worker-model.ts";

const number = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
};
const leaseMs = number("RICH_CHAT_WORKER_LEASE_MS", 30000);
const heartbeatMs = number("RICH_CHAT_WORKER_HEARTBEAT_MS", 5000);
if (heartbeatMs * 2 > leaseMs) throw new Error("The heartbeat must be at most half the lease");

const path = taskDatabasePath();
const store = createTaskStore(path);
const jobs = createJobs(store, { leaseMs });
const worker = createWorker({
  jobs,
  generate: workerGenerate(),
  createActivity,
  log: logActivity,
  workerId: process.env.RICH_CHAT_WORKER_ID || `${hostname()}-${process.pid}`,
  heartbeatMs,
  pollMs: number("RICH_CHAT_WORKER_POLL_MS", 1000),
  concurrency: number("RICH_CHAT_WORKER_CONCURRENCY", 2),
});

const stop = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => stop.abort(signal));
console.log(`[worker] ${process.pid} watching ${path}`);
await worker.run(stop.signal);
store.close();
console.log("[worker] stopped");
