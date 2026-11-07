/**
 * SQLite with node:sqlite (Node 22.13+; no package). Synchronous by design: a transaction body cannot await, so no
 * other work interleaves with it in this process, and BEGIN IMMEDIATE plus busy_timeout serializes writers across
 * processes. Keep network calls and model generations outside transactions; record their results inside one.
 */
import { DatabaseSync } from "node:sqlite";

/** Open (or create) a database for several connections: WAL, foreign keys on, wait instead of failing when busy. */
export function openDatabase(path, { busyTimeoutMs = 5000 } = {}) {
  if (
    !Number.isInteger(busyTimeoutMs) ||
    busyTimeoutMs < 0 ||
    busyTimeoutMs > 60000
  )
    throw new RangeError("busyTimeoutMs must be 0..60000");
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

const depth = new WeakMap();

/**
 * Run `body(db)` atomically and return its result. The outermost call takes the write lock (BEGIN IMMEDIATE); a nested
 * call uses a savepoint, so an inner failure the caller catches rolls back only the inner work. A thrown error rolls
 * back and is rethrown. A body that returns a promise is refused: it would commit before its awaited work ran.
 */
export function transaction(db, body) {
  const level = depth.get(db) ?? 0;
  const savepoint = `sp_${level}`;
  db.exec(level ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
  depth.set(db, level + 1);
  try {
    const result = body(db);
    if (result && typeof result.then === "function")
      throw new TypeError(
        "A transaction body must be synchronous; await outside it",
      );
    db.exec(level ? `RELEASE ${savepoint}` : "COMMIT");
    return result;
  } catch (error) {
    db.exec(
      level ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : "ROLLBACK",
    );
    throw error;
  } finally {
    depth.set(db, level);
  }
}

/**
 * Bring the schema up to date. `migrations` is the full ordered list (SQL text or `(db) => void`); the database's
 * `user_version` says how many already ran. Each pending one runs in its own transaction with the version bump, so a
 * failure leaves the last good version. A database newer than this code is refused rather than guessed at.
 */
export function migrate(db, migrations) {
  if (!Array.isArray(migrations))
    throw new TypeError("migrations must be an ordered list");
  const from = db.prepare("PRAGMA user_version").get().user_version;
  if (from > migrations.length)
    throw new Error(
      `Database schema ${from} is newer than this code (knows ${migrations.length})`,
    );
  for (let index = from; index < migrations.length; index++) {
    transaction(db, () => {
      const step = migrations[index];
      if (typeof step === "function") step(db);
      else db.exec(step);
      db.exec(`PRAGMA user_version = ${index + 1}`);
    });
  }
  return { from, to: migrations.length };
}
