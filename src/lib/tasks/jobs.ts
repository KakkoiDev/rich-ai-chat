import { randomUUID } from "node:crypto";
import { operationKey } from "../../../coding-core/js/receipts.mjs";
import { defineTransitions, hasReason, transition } from "../../../coding-core/js/task-states.mjs";
import type { ActivityEvent, JobProgress } from "../activity";
import type { Actor, TaskStore } from "./store";

/**
 * Background jobs (M10). A job is an ordered list of generation steps attached to a chat's task. A worker process
 * (scripts/task-worker.mjs) claims a job by taking a lease, which it keeps alive with heartbeats; each finished step is
 * committed as a checkpoint under a receipt, so a resumed or duplicated delivery never repeats it. A lease that expires
 * (the worker died or hung) is reclaimed and the job continues from its last committed step. Statuses follow a guarded
 * transition table; waiting and blocked jobs carry the reason the Tasks panel shows.
 */

export type JobStatus = "queued" | "waiting" | "blocked" | "running" | "succeeded" | "failed" | "cancelled";
export type Job = {
  id: string; profileId: string; taskId: string; itemId: string | null; title: string; model: string; steps: string[];
  nextStep: number; status: JobStatus; waitingReason: string | null; dependsOn: string | null; cancelRequested: boolean;
  version: number; createdAt: string; updatedAt: string;
};
export type Run = { id: string; jobId: string; workerId: string; fromStep: number };
export type Claim = { job: Job; run: Run };
export type JobView = Job & {
  outcome: { status: string; summary: string; receiptKey: string; at: string } | null;
  events: ActivityEvent[]; runs: number;
};

export const jobTransitions = defineTransitions({
  queued: {
    claim: { to: "running" }, wait: { to: "waiting", guard: hasReason }, block: { to: "blocked", guard: hasReason },
    cancel: { to: "cancelled" }, fail: { to: "failed" },
  },
  waiting: {
    claim: { to: "running" }, wait: { to: "waiting", guard: hasReason }, block: { to: "blocked", guard: hasReason },
    requeue: { to: "queued" }, cancel: { to: "cancelled" }, fail: { to: "failed" },
  },
  blocked: {
    requeue: { to: "queued" }, wait: { to: "waiting", guard: hasReason }, block: { to: "blocked", guard: hasReason },
    cancel: { to: "cancelled" }, fail: { to: "failed" },
  },
  running: { succeed: { to: "succeeded" }, fail: { to: "failed" }, cancel: { to: "cancelled" }, requeue: { to: "queued" } },
  succeeded: {},
  failed: {},
  cancelled: {},
});

/** Hosted models take several generations at once; every local model takes one at a time by default. */
const hostedModels = new Set(["deepseek-flash"]);
export const isConstrainedModel = (model: string) => !hostedModels.has(model);
const finalStatuses = new Set<JobStatus>(["succeeded", "failed", "cancelled"]);
const limits = { title: 160, step: 2000, steps: 8, output: 20000 };

type Row = Record<string, string | number | null>;

export function createJobs(store: TaskStore, { leaseMs = 30000 } = {}) {
  const { db, receipts, atomic, iso, clock, logChange, PlanError } = store;

  const toJob = (row: Row): Job => ({
    id: String(row.id), profileId: String(row.profile_id), taskId: String(row.task_id),
    itemId: row.item_id === null ? null : String(row.item_id), title: String(row.title), model: String(row.model),
    steps: JSON.parse(String(row.steps)), nextStep: Number(row.next_step), status: row.status as JobStatus,
    waitingReason: row.waiting_reason === null ? null : String(row.waiting_reason),
    dependsOn: row.depends_on === null ? null : String(row.depends_on), cancelRequested: Number(row.cancel_requested) === 1,
    version: Number(row.version), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  });
  const jobRow = (jobId: string) => db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as Row | undefined;
  const ownJob = (profileId: string, jobId: string) => {
    const row = db.prepare("SELECT * FROM jobs WHERE id = ? AND profile_id = ?").get(jobId, profileId) as Row | undefined;
    if (!row) throw new PlanError("Job not found", 404);
    return toJob(row);
  };

  /** Job progress is stored as Activity events (the M2 model), so the panel reads it like a reply's Activity line. */
  const recordEvent = (job: Pick<Job, "id" | "profileId">, event: ActivityEvent) => {
    db.prepare("INSERT INTO job_events (job_id, profile_id, event, at) VALUES (?, ?, ?, ?)")
      .run(job.id, job.profileId, JSON.stringify(event), iso());
  };
  const schedulerEvent = (job: Job, status: string, reason?: string, requestId = "scheduler") =>
    recordEvent(job, {
      requestId, seq: 0, ms: 0, type: "job", jobId: job.id, status: status as JobProgress,
      step: Math.min(job.nextStep + 1, job.steps.length), steps: job.steps.length, ...(reason ? { reason: reason.slice(0, 200) } : {}),
    });

  /** Move a job through the table and persist it; illegal moves throw, so a bug cannot corrupt a status. */
  const move = (job: Job, event: string, reason: string | null, actor: Actor) => {
    const result = transition(jobTransitions, job.status, event, { reason: reason ?? undefined });
    if (!result.ok) throw new PlanError(result.error ?? "That change is not allowed", 409);
    db.prepare("UPDATE jobs SET status = ?, waiting_reason = ?, version = version + 1, updated_at = ? WHERE id = ?")
      .run(result.to, reason, iso(), job.id);
    logChange(job.profileId, job.taskId, "job", job.id, event, actor, { from: result.from, to: result.to, ...(reason ? { reason } : {}) });
    return { ...job, status: result.to as JobStatus, waitingReason: reason };
  };

  /** Record the final outcome once (receipt-backed), release the lease and model slot, and close the run. */
  const settle = (job: Job, runId: string | null, event: "succeed" | "fail" | "cancel", summary: string, actor: Actor) => {
    const key = operationKey("job", job.id, "outcome");
    return receipts.once(key, "job-outcome", () => {
      const moved = move(job, event, null, actor);
      db.prepare("INSERT INTO outcomes (job_id, status, summary, receipt_key, at) VALUES (?, ?, ?, ?, ?)")
        .run(job.id, moved.status, summary, key, iso());
      if (runId) {
        db.prepare("UPDATE runs SET ended_at = ?, outcome = ? WHERE id = ?").run(iso(), moved.status, runId);
        db.prepare("DELETE FROM leases WHERE job_id = ? AND run_id = ?").run(job.id, runId);
        db.prepare("DELETE FROM model_slots WHERE run_id = ?").run(runId);
      }
      if (job.itemId) store.addCheckpoint(job.profileId, job.taskId, job.itemId,
        `Background job “${job.title}” ${moved.status}: ${summary} (receipt ${key})`, actor);
      schedulerEvent(moved, moved.status, summary, runId ?? "scheduler");
      return { status: moved.status, receiptKey: key };
    });
  };

  /** Leases whose worker stopped heartbeating go back to the queue; the job keeps its committed steps. */
  const reclaimExpired = () => {
    const now = clock();
    for (const lease of db.prepare("SELECT * FROM leases WHERE expires_at <= ?").all(now) as Row[]) {
      const row = jobRow(String(lease.job_id));
      db.prepare("DELETE FROM leases WHERE job_id = ?").run(lease.job_id);
      db.prepare("DELETE FROM model_slots WHERE run_id = ?").run(lease.run_id);
      db.prepare("UPDATE runs SET ended_at = ?, outcome = 'lease-expired' WHERE id = ? AND ended_at IS NULL").run(iso(), lease.run_id);
      if (!row || row.status !== "running") continue;
      const job = move(toJob(row), "requeue", null, "worker");
      schedulerEvent(job, "requeued", `The worker stopped responding; resuming from step ${job.nextStep + 1} (last checkpoint)`,
        String(lease.run_id));
    }
  };

  /** Park a job with a visible reason; repeated polls with the same reason write nothing. */
  const park = (job: Job, event: "wait" | "block", reason: string) => {
    if (job.status === (event === "wait" ? "waiting" : "blocked") && job.waitingReason === reason) return;
    schedulerEvent(move(job, event, reason, "worker"), event === "wait" ? "waiting" : "blocked", reason);
  };

  return {
    recordEvent,

    /**
     * Queue a job on the chat's task. `key` makes a repeated request (the same tool call delivered twice) return the
     * first job instead of queueing another.
     */
    enqueue(profileId: string, chatId: string, input: { title: string; steps: string[]; model: string; itemId?: string | null;
      dependsOn?: string | null; key?: string }, actor: Actor): { job: Job; replayed: boolean } {
      const title = String(input.title ?? "").replace(/\s+/g, " ").trim();
      if (!title || title.length > limits.title) throw new PlanError(`A job needs a title of 1..${limits.title} characters`);
      if (!Array.isArray(input.steps) || !input.steps.length || input.steps.length > limits.steps)
        throw new PlanError(`A job needs 1..${limits.steps} steps`);
      const steps = input.steps.map(step => String(step ?? "").trim());
      if (steps.some(step => !step || step.length > limits.step)) throw new PlanError(`Each step needs 1..${limits.step} characters`);
      return atomic(() => {
        if (input.key) {
          const existing = db.prepare("SELECT * FROM jobs WHERE idempotency_key = ? AND profile_id = ?").get(input.key, profileId) as Row | undefined;
          if (existing) return { job: toJob(existing), replayed: true };
        }
        const task = db.prepare("SELECT id FROM tasks WHERE profile_id = ? AND chat_id = ?").get(profileId, chatId) as Row | undefined;
        if (!task) throw new PlanError("This chat has no plan yet: propose its items first", 409);
        if (input.itemId) {
          const item = db.prepare("SELECT task_id FROM items WHERE id = ?").get(input.itemId) as Row | undefined;
          if (!item || item.task_id !== task.id) throw new PlanError("Item not found", 404);
        }
        if (input.dependsOn) ownJob(profileId, input.dependsOn);
        const id = randomUUID();
        const at = iso();
        db.prepare(`INSERT INTO jobs (id, profile_id, task_id, item_id, title, model, steps, status, depends_on, idempotency_key, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`)
          .run(id, profileId, task.id, input.itemId ?? null, title, input.model, JSON.stringify(steps), input.dependsOn ?? null,
            input.key ?? null, at, at);
        logChange(profileId, String(task.id), "job", id, "queue", actor, { title, steps: steps.length, model: input.model });
        const job = toJob(jobRow(id)!);
        schedulerEvent(job, "queued");
        return { job, replayed: false };
      });
    },

    get: (profileId: string, jobId: string) => ownJob(profileId, jobId),

    /** Jobs of one task with their outcome, run count and latest Activity events, newest first. */
    forTask(profileId: string, taskId: string, eventLimit = 12): JobView[] {
      return (db.prepare("SELECT * FROM jobs WHERE profile_id = ? AND task_id = ? ORDER BY created_at DESC, rowid DESC")
        .all(profileId, taskId) as Row[]).map(row => {
        const job = toJob(row);
        const outcome = db.prepare("SELECT * FROM outcomes WHERE job_id = ?").get(job.id) as Row | undefined;
        const events = (db.prepare("SELECT event FROM job_events WHERE job_id = ? ORDER BY seq DESC LIMIT ?")
          .all(job.id, eventLimit) as Row[]).map(e => JSON.parse(String(e.event)) as ActivityEvent).reverse();
        const runs = Number((db.prepare("SELECT count(*) AS n FROM runs WHERE job_id = ?").get(job.id) as Row).n);
        return {
          ...job, events, runs,
          outcome: outcome ? { status: String(outcome.status), summary: String(outcome.summary), receiptKey: String(outcome.receipt_key), at: String(outcome.at) } : null,
        };
      });
    },

    /** The person cancels: a job that is not running ends now; a running one is told to stop at its next heartbeat. */
    cancel(profileId: string, jobId: string, actor: Actor): Job {
      return atomic(() => {
        const job = ownJob(profileId, jobId);
        if (finalStatuses.has(job.status)) throw new PlanError(`The job already ${job.status}`, 409);
        if (job.status !== "running") {
          settle(job, null, "cancel", "Cancelled before it ran", actor);
        } else {
          db.prepare("UPDATE jobs SET cancel_requested = 1, waiting_reason = ?, version = version + 1, updated_at = ? WHERE id = ?")
            .run("Cancelling: the worker stops the current generation", iso(), jobId);
          logChange(profileId, job.taskId, "job", jobId, "cancel-request", actor);
        }
        return ownJob(profileId, jobId);
      });
    },

    /**
     * Reclaim expired leases, then claim the oldest job that can run: its dependency succeeded and, for a local model,
     * no other run holds the model's generation slot. Jobs that cannot run get a visible reason instead.
     */
    claimNext(workerId: string): Claim | null {
      return atomic(() => {
        reclaimExpired();
        const now = clock();
        const candidates = (db.prepare("SELECT * FROM jobs WHERE status IN ('queued', 'waiting', 'blocked') ORDER BY created_at, rowid")
          .all() as Row[]).map(toJob);
        for (let job of candidates) {
          if (job.cancelRequested) { settle(job, null, "cancel", "Cancelled before it ran", "worker"); continue; }
          if (job.dependsOn) {
            const dependency = toJob(jobRow(job.dependsOn)!);
            if (dependency.status === "failed" || dependency.status === "cancelled") {
              settle(job, null, "fail", `Its dependency “${dependency.title}” ${dependency.status}`, "worker");
              continue;
            }
            if (dependency.status !== "succeeded") {
              park(job, "block", `Waits for “${dependency.title}” (${dependency.status})`);
              continue;
            }
          }
          if (isConstrainedModel(job.model)) {
            const slot = db.prepare("SELECT * FROM model_slots WHERE model = ? AND expires_at > ?").get(job.model, now) as Row | undefined;
            if (slot) {
              park(job, "wait", `Waiting for ${job.model}: one generation at a time on this local model`);
              continue;
            }
          }
          if (job.status === "blocked") job = move(job, "requeue", null, "worker");
          const run: Run = { id: randomUUID(), jobId: job.id, workerId, fromStep: job.nextStep };
          db.prepare("INSERT INTO runs (id, job_id, worker_id, from_step, started_at, last_heartbeat_at) VALUES (?, ?, ?, ?, ?, ?)")
            .run(run.id, job.id, workerId, run.fromStep, iso(), iso());
          db.prepare("INSERT INTO leases (job_id, run_id, worker_id, acquired_at, heartbeat_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
            .run(job.id, run.id, workerId, now, now, now + leaseMs);
          if (isConstrainedModel(job.model))
            db.prepare("INSERT INTO model_slots (model, run_id, expires_at) VALUES (?, ?, ?) ON CONFLICT (model) DO UPDATE SET run_id = excluded.run_id, expires_at = excluded.expires_at")
              .run(job.model, run.id, now + leaseMs);
          job = move(job, "claim", null, "worker");
          return { job, run };
        }
        return null;
      });
    },

    /** Keep the lease alive. `ok: false` means another run owns the job now; `cancel: true` means the person cancelled. */
    heartbeat(runId: string): { ok: boolean; cancel: boolean } {
      return atomic(() => {
        const now = clock();
        const lease = db.prepare("SELECT * FROM leases WHERE run_id = ?").get(runId) as Row | undefined;
        if (!lease) return { ok: false, cancel: false };
        db.prepare("UPDATE leases SET heartbeat_at = ?, expires_at = ? WHERE run_id = ?").run(now, now + leaseMs, runId);
        db.prepare("UPDATE model_slots SET expires_at = ? WHERE run_id = ?").run(now + leaseMs, runId);
        db.prepare("UPDATE runs SET last_heartbeat_at = ?, heartbeats = heartbeats + 1 WHERE id = ?").run(iso(), runId);
        const job = jobRow(String(lease.job_id));
        return { ok: true, cancel: Number(job?.cancel_requested) === 1 };
      });
    },

    holdsLease: (runId: string) => Boolean(db.prepare("SELECT 1 FROM leases WHERE run_id = ?").get(runId)),
    cancelRequested: (jobId: string) => Number(jobRow(jobId)?.cancel_requested) === 1,
    outputs: (jobId: string) => (db.prepare("SELECT step, output FROM job_steps WHERE job_id = ? ORDER BY step").all(jobId) as Row[])
      .map(row => ({ step: Number(row.step), output: String(row.output) })),

    startAttempt(run: Run, step: number, attempt: number) {
      const id = randomUUID();
      db.prepare("INSERT INTO attempts (id, run_id, job_id, step, attempt, started_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, run.id, run.jobId, step, attempt, iso());
      return id;
    },
    endAttempt(attemptId: string, outcome: "answer" | "error" | "aborted", reason?: string) {
      db.prepare("UPDATE attempts SET ended_at = ?, outcome = ?, reason = ? WHERE id = ?").run(iso(), outcome, reason ?? null, attemptId);
    },

    /**
     * Commit one finished step: its output, the job's next step and a task checkpoint, all under the step's receipt.
     * A second delivery of the same step (a reclaimed lease racing the old worker) is replayed, not repeated.
     */
    commitStep(run: Run, step: number, output: string): { replayed: boolean; key: string } {
      const key = operationKey("job", run.jobId, "step", step);
      const { replayed } = atomic(() => receipts.once(key, "job-step", () => {
        const job = toJob(jobRow(run.jobId)!);
        db.prepare("INSERT INTO job_steps (job_id, step, run_id, output, receipt_key, committed_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(job.id, step, run.id, output.slice(0, limits.output), key, iso());
        db.prepare("UPDATE jobs SET next_step = max(next_step, ?), version = version + 1, updated_at = ? WHERE id = ?").run(step + 1, iso(), job.id);
        store.addCheckpoint(job.profileId, job.taskId, job.itemId,
          `Job “${job.title}”: step ${step + 1} of ${job.steps.length} done`, "worker");
        return { step };
      }));
      return { replayed, key };
    },

    /** End a run that still holds its lease. Returns null when the lease was lost (another run owns the job). */
    finish(run: Run, event: "succeed" | "fail" | "cancel", summary: string) {
      return atomic(() => {
        if (!db.prepare("SELECT 1 FROM leases WHERE run_id = ?").get(run.id)) return null;
        return settle(toJob(jobRow(run.jobId)!), run.id, event, summary, "worker").result as { status: JobStatus; receiptKey: string };
      });
    },

    /** Close a run that lost its lease without touching the job, which another run now owns. */
    abandon(run: Run, outcome: string) {
      db.prepare("UPDATE runs SET ended_at = ?, outcome = ? WHERE id = ? AND ended_at IS NULL").run(iso(), outcome, run.id);
    },
  };
}

export type Jobs = ReturnType<typeof createJobs>;
