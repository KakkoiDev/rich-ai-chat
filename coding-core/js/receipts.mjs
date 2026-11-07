/**
 * Idempotent operation receipts. Give every side-effecting operation a stable key (the same request delivered twice
 * gets the same key), keep a receipt per key, and a second delivery returns the first result instead of acting again.
 *
 * - `once(key, run)`: for work inside this database. The effect and its receipt commit in one transaction, so either
 *   both exist or neither does, and a failure leaves no receipt (the operation may be tried again).
 * - `reserve(key)` then `settle(key, result)`: for an external effect (a network call, a model generation) that cannot
 *   share the transaction. A reservation that was never settled means the effect may or may not have happened: the
 *   host must reconcile it (look the effect up) before replaying, never blindly repeat it.
 */
import { createHash } from "node:crypto";
import { transaction } from "./sqlite.mjs";

/** A stable key from the parts that identify one operation, e.g. ("job", jobId, "step", 2). */
export function operationKey(...parts) {
  if (!parts.length)
    throw new TypeError("An operation key needs at least one part");
  return (
    "op_" +
    createHash("sha256")
      .update(JSON.stringify(parts))
      .digest("hex")
      .slice(0, 32)
  );
}

export const receiptsSchema = `CREATE TABLE IF NOT EXISTS receipts (
  key TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'done')),
  result TEXT,
  created_at TEXT NOT NULL,
  settled_at TEXT
)`;

/** Receipts over a node:sqlite database. `now` is injected so tests control time. */
export function createReceipts(
  db,
  { now = () => new Date().toISOString() } = {},
) {
  db.exec(receiptsSchema);
  const read = db.prepare(
    "SELECT key, operation, state, result, created_at, settled_at FROM receipts WHERE key = ?",
  );
  const insert = db.prepare(
    "INSERT INTO receipts (key, operation, state, result, created_at, settled_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const finish = db.prepare(
    "UPDATE receipts SET state = 'done', result = ?, settled_at = ? WHERE key = ? AND state = 'pending'",
  );
  const shape = (row) =>
    row && {
      key: row.key,
      operation: row.operation,
      state: row.state,
      result: row.result === null ? undefined : JSON.parse(row.result),
      createdAt: row.created_at,
      settledAt: row.settled_at ?? undefined,
    };

  return {
    get: (key) => shape(read.get(key)),

    /** Run `run(db)` once per key, atomically with its receipt. Returns `{ result, replayed }`. */
    once(key, operation, run) {
      return transaction(db, () => {
        const existing = read.get(key);
        if (existing?.state === "done")
          return { result: JSON.parse(existing.result), replayed: true };
        if (existing)
          throw new Error(
            `Receipt ${key} is pending: reconcile the external effect first`,
          );
        const result = run(db) ?? null;
        const at = now();
        insert.run(key, operation, "done", JSON.stringify(result), at, at);
        return { result, replayed: false };
      });
    },

    /** Claim a key before an external effect: `{ state: "new" }`, or the existing `pending` / `done` receipt. */
    reserve(key, operation) {
      return transaction(db, () => {
        const existing = read.get(key);
        if (existing) return shape(existing);
        insert.run(key, operation, "pending", null, now(), null);
        return { key, operation, state: "new" };
      });
    },

    /** Record the external effect's result. Settling twice keeps the first result. */
    settle(key, result) {
      return transaction(db, () => {
        const changed = finish.run(
          JSON.stringify(result ?? null),
          now(),
          key,
        ).changes;
        const row = read.get(key);
        if (!row) throw new Error(`No reservation for ${key}`);
        return { ...shape(row), replayed: changed === 0 };
      });
    },
  };
}
