import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { migrate, openDatabase, transaction } from "../../../coding-core/js/sqlite.mjs";
import { createReceipts, operationKey, receiptsSchema } from "../../../coding-core/js/receipts.mjs";
import { allowedEvents, taskTransitions, transition } from "../../../coding-core/js/task-states.mjs";

/**
 * Persistent tasks (M9): one plan per chat per browser profile, kept in SQLite beside the server, never in the browser.
 * Every read and write is scoped to the profile; another profile's ids answer "not found". Every change appends a row
 * to an append-only change log (triggers refuse UPDATE and DELETE on it). Item states follow coding-core's guarded
 * transition table: done only through `verify` with evidence, `start` waits for dependencies, `block` needs a reason.
 * Writers pass the version they read; a stale version is refused (409) instead of overwriting someone else's edit.
 *
 * This module runs in the Next server and in the worker script (Node strips the types), so its runtime imports are
 * Node built-ins and the pinned coding-core modules only.
 */

export type ItemStatus = "pending" | "in_progress" | "blocked" | "done" | "cancelled";
export type ItemEvent = "start" | "pause" | "block" | "unblock" | "verify" | "cancel" | "reopen";
export type Actor = "user" | "agent" | "worker";
export type Evidence = { kind: "test" | "artifact" | "receipt"; ref: string };
export type Task = { id: string; chatId: string; objective: string; version: number; createdAt: string; updatedAt: string };
export type Item = {
  id: string; taskId: string; position: number; title: string; status: ItemStatus; dependsOn: string | null;
  blockedReason: string | null; evidence: Evidence[]; version: number; updatedAt: string; allowed: ItemEvent[];
};
export type Checkpoint = { id: string; itemId: string | null; note: string; actor: Actor; createdAt: string };
export type Plan = { task: Task; items: Item[]; checkpoints: Checkpoint[] };
export type Change = { seq: number; entity: string; entityId: string; action: string; actor: Actor; data: Record<string, unknown>; at: string };

/** A refusal the caller can show as is: 400 invalid, 404 not found (or another profile's), 409 conflict or illegal. */
export class PlanError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export const itemEvents: ItemEvent[] = ["start", "pause", "block", "unblock", "verify", "cancel", "reopen"];
const limits = { objective: 500, title: 200, note: 1000, reason: 300, ref: 300, items: 50 };

const planMigration = `
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  objective TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (profile_id, chat_id)
);
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'blocked', 'done', 'cancelled')),
  depends_on TEXT REFERENCES items(id),
  blocked_reason TEXT,
  evidence TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX items_task ON items (task_id, position);
CREATE TABLE checkpoints (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  item_id TEXT REFERENCES items(id),
  note TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX checkpoints_task ON checkpoints (task_id, created_at);
CREATE TABLE changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL,
  task_id TEXT,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  data TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX changes_task ON changes (profile_id, task_id, seq);
CREATE TRIGGER changes_append_only_update BEFORE UPDATE ON changes BEGIN SELECT RAISE(ABORT, 'the change log is append-only'); END;
CREATE TRIGGER changes_append_only_delete BEFORE DELETE ON changes BEGIN SELECT RAISE(ABORT, 'the change log is append-only'); END;
${receiptsSchema};
`;

/** Background jobs (M10): job, run, attempt, lease, heartbeat, outcome, per-step checkpoints, model slots, events. */
const jobsMigration = `
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  item_id TEXT REFERENCES items(id),
  title TEXT NOT NULL,
  model TEXT NOT NULL,
  steps TEXT NOT NULL,
  next_step INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('queued', 'waiting', 'blocked', 'running', 'succeeded', 'failed', 'cancelled')),
  waiting_reason TEXT,
  depends_on TEXT REFERENCES jobs(id),
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT UNIQUE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX jobs_status ON jobs (status, created_at);
CREATE INDEX jobs_task ON jobs (profile_id, task_id);
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  worker_id TEXT NOT NULL,
  from_step INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  last_heartbeat_at TEXT NOT NULL,
  heartbeats INTEGER NOT NULL DEFAULT 0,
  ended_at TEXT,
  outcome TEXT
);
CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  job_id TEXT NOT NULL REFERENCES jobs(id),
  step INTEGER NOT NULL,
  attempt INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  outcome TEXT,
  reason TEXT
);
CREATE TABLE leases (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id),
  run_id TEXT NOT NULL REFERENCES runs(id),
  worker_id TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  heartbeat_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE job_steps (
  job_id TEXT NOT NULL REFERENCES jobs(id),
  step INTEGER NOT NULL,
  run_id TEXT NOT NULL,
  output TEXT NOT NULL,
  receipt_key TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  PRIMARY KEY (job_id, step)
);
CREATE TABLE outcomes (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id),
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  receipt_key TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE TABLE model_slots (
  model TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE job_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  profile_id TEXT NOT NULL,
  event TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX job_events_job ON job_events (job_id, seq);
`;

export const migrations = [planMigration, jobsMigration];

/** Where the database lives: RICH_CHAT_DATA_DIR, else the app's folder in Application Support. */
export function taskDatabasePath(directory = process.env.RICH_CHAT_DATA_DIR) {
  const folder = directory || join(homedir(), "Library", "Application Support", "Rich AI Chat", "data");
  mkdirSync(folder, { recursive: true });
  return join(folder, "tasks.sqlite");
}

/** A browser profile id: random, kept in the browser, sent with each request. No accounts. */
export function validProfileId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(value);
}

type Row = Record<string, string | number | null>;
const text = (value: unknown, name: string, max: number) => {
  if (typeof value !== "string" || !value.trim()) throw new PlanError(`${name} is required`);
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length > max) throw new PlanError(`${name} is longer than ${max} characters`);
  return trimmed;
};

export function createTaskStore(path = taskDatabasePath(), { clock = () => Date.now() } = {}) {
  const db = openDatabase(path, { busyTimeoutMs: 10000 });
  migrate(db, migrations);
  const iso = () => new Date(clock()).toISOString();
  const receipts = createReceipts(db, { now: iso });
  const atomic = <T>(body: () => T): T => transaction(db, body);

  const logChange = (profileId: string, taskId: string | null, entity: string, entityId: string, action: string,
    actor: Actor, data: Record<string, unknown> = {}) => {
    db.prepare("INSERT INTO changes (profile_id, task_id, entity, entity_id, action, actor, data, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(profileId, taskId, entity, entityId, action, actor, JSON.stringify(data), iso());
  };
  const bumpTask = (taskId: string) =>
    db.prepare("UPDATE tasks SET version = version + 1, updated_at = ? WHERE id = ?").run(iso(), taskId);

  const taskRow = (profileId: string, taskId: string) => {
    const row = db.prepare("SELECT * FROM tasks WHERE id = ? AND profile_id = ?").get(taskId, profileId) as Row | undefined;
    if (!row) throw new PlanError("Task not found", 404);
    return row;
  };
  const itemRow = (profileId: string, itemId: string) => {
    const row = db.prepare("SELECT items.* FROM items JOIN tasks ON tasks.id = items.task_id WHERE items.id = ? AND tasks.profile_id = ?")
      .get(itemId, profileId) as Row | undefined;
    if (!row) throw new PlanError("Item not found", 404);
    return row;
  };
  const toTask = (row: Row): Task => ({
    id: String(row.id), chatId: String(row.chat_id), objective: String(row.objective), version: Number(row.version),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  });
  /** Dependencies of an item that are not done yet, by title. */
  const openDependencies = (row: Row) => {
    if (!row.depends_on) return [];
    const dependency = db.prepare("SELECT title, status FROM items WHERE id = ?").get(row.depends_on) as Row | undefined;
    return dependency && dependency.status !== "done" ? [String(dependency.title)] : [];
  };
  const toItem = (row: Row): Item => {
    const status = row.status as ItemStatus;
    // Offer what the table allows; verify and block are offered and then checked against the evidence or reason given.
    const allowed = allowedEvents(taskTransitions, status, {
      blockedBy: openDependencies(row), reason: "offered", evidence: [{ kind: "test", ref: "offered" }],
    }) as ItemEvent[];
    return {
      id: String(row.id), taskId: String(row.task_id), position: Number(row.position), title: String(row.title), status,
      dependsOn: row.depends_on === null ? null : String(row.depends_on),
      blockedReason: row.blocked_reason === null ? null : String(row.blocked_reason),
      evidence: JSON.parse(String(row.evidence)), version: Number(row.version), updatedAt: String(row.updated_at), allowed,
    };
  };
  const planFor = (row: Row): Plan => ({
    task: toTask(row),
    items: (db.prepare("SELECT * FROM items WHERE task_id = ? ORDER BY position").all(row.id) as Row[]).map(toItem),
    checkpoints: (db.prepare("SELECT * FROM checkpoints WHERE task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 20")
      .all(row.id) as Row[]).map(c => ({
      id: String(c.id), itemId: c.item_id === null ? null : String(c.item_id), note: String(c.note), actor: c.actor as Actor,
      createdAt: String(c.created_at),
    })),
  });
  const checkVersion = (row: Row, expectedVersion: number | undefined, what: string) => {
    if (expectedVersion !== undefined && Number(row.version) !== expectedVersion)
      throw new PlanError(`This ${what} changed since it was read (version ${expectedVersion}, now ${row.version}). Read the plan again.`, 409);
  };

  /** Evidence the host can stand behind: a known kind with a ref, and a cited receipt must exist and be settled. */
  const checkEvidence = (evidence: unknown): Evidence[] => {
    if (!Array.isArray(evidence) || evidence.length === 0)
      throw new PlanError("A verification needs evidence: a test, an artifact or a receipt", 409);
    return evidence.slice(0, 5).map(entry => {
      const { kind, ref } = (entry ?? {}) as { kind?: unknown; ref?: unknown };
      if (kind !== "test" && kind !== "artifact" && kind !== "receipt")
        throw new PlanError("Evidence kind must be test, artifact or receipt", 409);
      const cited = text(ref, "Evidence ref", limits.ref);
      if (kind === "receipt" && receipts.get(cited)?.state !== "done")
        throw new PlanError(`Receipt ${cited} does not exist or is not settled`, 409);
      return { kind, ref: cited };
    });
  };

  const findTask = (profileId: string, chatId: string) =>
    db.prepare("SELECT * FROM tasks WHERE profile_id = ? AND chat_id = ?").get(profileId, chatId) as Row | undefined;
  const ensureTask = (profileId: string, chatId: string, objective: string | undefined, actor: Actor) => {
    const existing = findTask(profileId, chatId);
    if (existing) return existing;
    const id = randomUUID();
    const at = iso();
    const goal = text(objective, "Objective", limits.objective);
    db.prepare("INSERT INTO tasks (id, profile_id, chat_id, objective, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, profileId, text(chatId, "Chat id", 100), goal, at, at);
    logChange(profileId, id, "task", id, "create", actor, { objective: goal });
    return findTask(profileId, chatId)!;
  };

  const applyEvent = (profileId: string, row: Row, event: ItemEvent, context: { reason?: string; evidence?: Evidence[] }, actor: Actor) => {
    const result = transition(taskTransitions, String(row.status), event, { ...context, blockedBy: openDependencies(row) });
    if (!result.ok) throw new PlanError(result.error ?? "That change is not allowed", 409);
    db.prepare("UPDATE items SET status = ?, blocked_reason = ?, evidence = ?, version = version + 1, updated_at = ? WHERE id = ?")
      .run(result.to, event === "block" ? context.reason ?? null : null,
        JSON.stringify(event === "verify" ? context.evidence ?? [] : event === "reopen" ? [] : JSON.parse(String(row.evidence))),
        iso(), row.id);
    bumpTask(String(row.task_id));
    logChange(profileId, String(row.task_id), "item", String(row.id), event, actor, {
      from: result.from, to: result.to, ...(context.reason ? { reason: context.reason } : {}),
      ...(event === "verify" ? { evidence: context.evidence } : {}),
    });
    return itemRow(profileId, String(row.id));
  };

  const addCheckpoint = (profileId: string, taskId: string, itemId: string | null, note: string, actor: Actor) => {
    const id = randomUUID();
    db.prepare("INSERT INTO checkpoints (id, task_id, item_id, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, taskId, itemId, text(note, "Checkpoint note", limits.note), actor, iso());
    bumpTask(taskId);
    logChange(profileId, taskId, "checkpoint", id, "record", actor, { itemId, note: text(note, "Checkpoint note", limits.note) });
    return id;
  };

  return {
    db, receipts, clock, iso, atomic, logChange, addCheckpoint, PlanError,
    close: () => db.close(),

    readPlan(profileId: string, chatId: string): Plan | null {
      const row = findTask(profileId, chatId);
      return row ? planFor(row) : null;
    },
    planById(profileId: string, taskId: string): Plan {
      return planFor(taskRow(profileId, taskId));
    },

    /** Create the chat's task (one per chat), or return the existing one unchanged. */
    openTask(profileId: string, chatId: string, objective: string, actor: Actor): Plan {
      return atomic(() => planFor(ensureTask(profileId, chatId, objective, actor)));
    },

    setObjective(profileId: string, taskId: string, objective: string, expectedVersion: number | undefined, actor: Actor): Plan {
      return atomic(() => {
        const row = taskRow(profileId, taskId);
        checkVersion(row, expectedVersion, "task");
        const goal = text(objective, "Objective", limits.objective);
        db.prepare("UPDATE tasks SET objective = ?, version = version + 1, updated_at = ? WHERE id = ?").run(goal, iso(), taskId);
        logChange(profileId, taskId, "task", taskId, "objective", actor, { objective: goal });
        return planFor(taskRow(profileId, taskId));
      });
    },

    /**
     * Append items to the chat's plan, creating the task with `objective` when there is none. `dependsOnPrevious` makes
     * each new item wait for the one before it. With `key`, the same proposal delivered twice adds the items once.
     */
    addItems(profileId: string, chatId: string, input: { objective?: string; titles: string[]; dependsOnPrevious?: boolean; key?: string },
      actor: Actor): { plan: Plan; replayed: boolean } {
      if (!Array.isArray(input.titles) || input.titles.length === 0) throw new PlanError("Propose at least one item");
      const titles = input.titles.map(title => text(title, "Item title", limits.title));
      const add = () => {
        const task = ensureTask(profileId, chatId, input.objective, actor);
        const count = Number((db.prepare("SELECT count(*) AS n FROM items WHERE task_id = ?").get(task.id) as Row).n);
        if (count + titles.length > limits.items) throw new PlanError(`A plan holds at most ${limits.items} items`);
        let previous = input.dependsOnPrevious
          ? (db.prepare("SELECT id FROM items WHERE task_id = ? ORDER BY position DESC LIMIT 1").get(task.id) as Row | undefined)?.id ?? null
          : null;
        titles.forEach((title, index) => {
          const id = randomUUID();
          const at = iso();
          db.prepare("INSERT INTO items (id, task_id, position, title, status, depends_on, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)")
            .run(id, task.id, count + index + 1, title, previous, at, at);
          logChange(profileId, String(task.id), "item", id, "add", actor, { title, dependsOn: previous });
          if (input.dependsOnPrevious) previous = id;
        });
        bumpTask(String(task.id));
        return String(task.id);
      };
      return atomic(() => {
        if (!input.key) return { plan: planById(add()), replayed: false };
        const { result, replayed } = receipts.once(input.key, "add-items", () => ({ taskId: add() }));
        return { plan: planById((result as { taskId: string }).taskId), replayed };
      });
      function planById(taskId: string) {
        return planFor(taskRow(profileId, taskId));
      }
    },

    editItem(profileId: string, itemId: string, title: string, expectedVersion: number | undefined, actor: Actor): Item {
      return atomic(() => {
        const row = itemRow(profileId, itemId);
        checkVersion(row, expectedVersion, "item");
        const next = text(title, "Item title", limits.title);
        db.prepare("UPDATE items SET title = ?, version = version + 1, updated_at = ? WHERE id = ?").run(next, iso(), itemId);
        bumpTask(String(row.task_id));
        logChange(profileId, String(row.task_id), "item", itemId, "edit", actor, { from: row.title, to: next });
        return toItem(itemRow(profileId, itemId));
      });
    },

    /** Apply one guarded event to an item. Illegal changes, stale versions and missing evidence are refused (409). */
    changeItem(profileId: string, itemId: string, event: ItemEvent,
      options: { expectedVersion?: number; reason?: string; evidence?: unknown }, actor: Actor): Item {
      if (!itemEvents.includes(event)) throw new PlanError(`Unknown event ${String(event)}`);
      return atomic(() => {
        const row = itemRow(profileId, itemId);
        checkVersion(row, options.expectedVersion, "item");
        const reason = options.reason === undefined ? undefined : text(options.reason, "Reason", limits.reason);
        const evidence = event === "verify" ? checkEvidence(options.evidence) : undefined;
        return toItem(applyEvent(profileId, row, event, { reason, evidence }, actor));
      });
    },

    /** Record a verification: the item is done only with evidence. A pending item is started first (both guarded). */
    recordVerification(profileId: string, itemId: string, evidence: unknown, expectedVersion: number | undefined, actor: Actor): Item {
      return atomic(() => {
        let row = itemRow(profileId, itemId);
        checkVersion(row, expectedVersion, "item");
        const checked = checkEvidence(evidence);
        if (row.status === "pending") row = applyEvent(profileId, row, "start", {}, actor);
        return toItem(applyEvent(profileId, row, "verify", { evidence: checked }, actor));
      });
    },

    /** Append a checkpoint to the task (optionally about one item). With `key`, a repeated delivery records it once. */
    recordCheckpoint(profileId: string, taskId: string, input: { itemId?: string | null; note: string; key?: string }, actor: Actor) {
      return atomic(() => {
        taskRow(profileId, taskId);
        if (input.itemId && String(itemRow(profileId, input.itemId).task_id) !== taskId) throw new PlanError("Item not found", 404);
        const record = () => ({ checkpointId: addCheckpoint(profileId, taskId, input.itemId ?? null, input.note, actor) });
        if (!input.key) return { ...record(), replayed: false };
        const { result, replayed } = receipts.once(input.key, "checkpoint", record);
        return { ...(result as { checkpointId: string }), replayed };
      });
    },

    changes(profileId: string, taskId: string): Change[] {
      taskRow(profileId, taskId);
      return (db.prepare("SELECT * FROM changes WHERE profile_id = ? AND task_id = ? ORDER BY seq").all(profileId, taskId) as Row[])
        .map(row => ({
          seq: Number(row.seq), entity: String(row.entity), entityId: String(row.entity_id), action: String(row.action),
          actor: row.actor as Actor, data: JSON.parse(String(row.data)), at: String(row.at),
        }));
    },

    /** A stable key for an agent operation, so a repeated tool call is recognised. */
    operationKey,
  };
}

export type TaskStore = ReturnType<typeof createTaskStore>;
