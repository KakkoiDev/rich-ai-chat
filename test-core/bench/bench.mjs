// A frozen, resumable benchmark runner. No dependencies: Node.js 22.13+ built-ins only.
// The host supplies the plan (tasks), the task body (run) and a gate that turns results into a verdict.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const SCHEMA = 1;
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const FINISHED = new Set(['stable-and-regression-passed', 'needs-investigation', 'complete', 'above-threshold',
  'below-threshold', 'inconclusive', 'secret-leak']);
const EXIT = { 'stable-and-regression-passed': 0, complete: 0, 'above-threshold': 0, 'needs-investigation': 1,
  'below-threshold': 1, inconclusive: 1, 'budget-reached': 1, interrupted: 130, 'runner-error': 2, 'secret-leak': 2 };

const sha256 = data => createHash('sha256').update(data).digest('hex');

let writes = 0;
async function atomic(path, value) {
  const temporary = `${path}.${process.pid}.${++writes}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n');
  await rename(temporary, path);
}

async function exists(path) {
  return stat(path).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
}

async function frozenFiles(freeze) {
  if (!freeze) return [];
  const files = [];
  for (const path of freeze.files) files.push({ path, sha256: sha256(await readFile(join(freeze.root, path))) });
  return files;
}

/** The process's start time as `ps` prints it in the C locale and UTC, or undefined when the process is gone or `ps` is missing. */
export function processStart(pid) {
  try {
    return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** True when `pid` runs and, if `started` is known, is the same process that recorded it (not a reused PID). */
export function sameProcess(pid, started) {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error.code !== 'EPERM') return false;
  }
  if (!started) return true;
  const now = processStart(pid);
  return now === undefined || now === started;
}

/** Take the folder's lock, reclaiming it only when the recorded process no longer exists and the lock still holds what was read. */
async function lock(dir) {
  const path = join(dir, 'run.lock');
  const mine = JSON.stringify({ pid: process.pid, started: processStart(process.pid) });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, 'wx');
      await handle.writeFile(mine);
      await handle.close();
      return async () => { await unlink(path).catch(() => {}); };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const text = await readFile(path, 'utf8').catch(() => '');
      const held = (() => { try { return JSON.parse(text); } catch { return {}; } })();
      const pid = Number(held?.pid ?? held);
      if (pid > 0 && pid !== process.pid && sameProcess(pid, held?.started)) throw new Error(`Run already active (PID ${pid})`);
      if (await readFile(path, 'utf8').catch(() => '') === text) await unlink(path).catch(() => {});
    }
  }
  throw new Error('Could not take the run lock');
}

/**
 * A streak: every task of a round must pass, `required` rounds in a row, then `regression` more rounds.
 * Tasks carry `round` (1-based). The first imperfect round stops the run.
 */
export function streakGate({ required, regression = 1 }) {
  return {
    name: 'streak', required, regression,
    evaluate(records, tasks) {
      const rounds = [];
      const checks = { passed: 0, expected: 0 };
      let stop = false;
      let failedRound;
      for (let round = 1; round <= required + regression; round++) {
        const planned = tasks.filter(task => task.round === round);
        const done = planned.filter(task => records.has(task.id)).map(task => records.get(task.id));
        for (const record of done) {
          checks.passed += record.result?.checks?.passed ?? (record.ok ? 1 : 0);
          checks.expected += record.result?.checks?.expected ?? 1;
        }
        if (!done.length) continue;
        const complete = done.length === planned.length;
        const perfect = done.every(record => record.ok);
        rounds.push({ round, regression: round > required, tasks: planned.length, done: done.length, perfect, complete });
        if (!perfect && failedRound === undefined) failedRound = round;
        if (!perfect && complete) stop = true;
      }
      const perfectRounds = rounds.findIndex(round => !round.perfect);
      const summary = { rounds, checks, perfectRounds: perfectRounds === -1 ? rounds.filter(r => r.complete).length : perfectRounds,
        ...(failedRound !== undefined ? { failedRound } : {}) };
      if (stop) return { stop, state: 'needs-investigation', summary };
      if (records.size === tasks.length) return { stop: true, state: 'stable-and-regression-passed', summary };
      return { stop: false, state: null, summary };
    },
  };
}

/** Wilson score interval for a proportion `p` of `n` trials. */
export function wilson(p, n, z = 1.96) {
  if (!n) return [0, 1];
  const z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const margin = (z / (1 + z2 / n)) * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n));
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}

/**
 * A match: each task returns `outcome` 'win' | 'draw' | 'loss' (draws score one half). The verdict compares the
 * Wilson interval of the score with `threshold`. A task that fails (ok false) stops the run. No early stopping.
 */
export function rateGate({ threshold, z = 1.96 }) {
  return {
    name: 'rate', threshold, z,
    evaluate(records, tasks) {
      const all = [...records.values()];
      const broken = all.find(record => !record.ok || !['win', 'draw', 'loss'].includes(record.result?.outcome));
      const count = outcome => all.filter(record => record.result?.outcome === outcome).length;
      const wins = count('win');
      const draws = count('draw');
      const losses = count('loss');
      const games = wins + draws + losses;
      const score = games ? (wins + draws / 2) / games : 0;
      const interval = wilson(score, games, z);
      const summary = { games, wins, draws, losses, score: Math.round(score * 1e6) / 1e6, interval, threshold };
      if (broken) return { stop: true, state: 'needs-investigation', summary: { ...summary, broken: broken.id } };
      if (records.size < tasks.length) return { stop: false, state: null, summary };
      const state = interval[0] >= threshold ? 'above-threshold' : interval[1] < threshold ? 'below-threshold' : 'inconclusive';
      return { stop: true, state, summary };
    },
  };
}

/** Every task must pass. */
export function allGate() {
  return {
    name: 'all',
    evaluate(records, tasks) {
      const failed = [...records.values()].filter(record => !record.ok).map(record => record.id);
      const summary = { done: records.size, tasks: tasks.length, failed };
      if (records.size < tasks.length) return { stop: false, state: null, summary };
      return { stop: true, state: failed.length ? 'needs-investigation' : 'complete', summary };
    },
  };
}

/** The byte strings a secret value can appear as: itself, JSON-escaped, URL-encoded, and base64 at each alignment. */
function secretForms(value, secret) {
  const forms = [{ secret, bytes: Buffer.from(value) }];
  const json = JSON.stringify(value).slice(1, -1);
  if (json !== value) forms.push({ secret, form: 'json', bytes: Buffer.from(json) });
  const url = encodeURIComponent(value);
  if (url !== value) forms.push({ secret, form: 'url', bytes: Buffer.from(url) });
  const bytes = Buffer.from(value);
  for (let shift = 0; shift < 3; shift++) {
    const encoded = Buffer.concat([Buffer.alloc(shift), bytes]).toString('base64');
    const inner = encoded.slice(Math.ceil((shift * 8) / 6), Math.floor(((shift + bytes.length) * 8) / 6));
    forms.push({ secret, form: 'base64', bytes: Buffer.from(inner) });
  }
  return forms;
}

/** The first form of each secret found in the file, read in chunks that overlap by the longest form. */
async function findForms(path, forms) {
  const found = new Map();
  const overlap = Math.max(...forms.map(form => form.bytes.length)) - 1;
  const handle = await open(path, 'r');
  try {
    let carry = Buffer.alloc(0);
    for (;;) {
      const chunk = Buffer.alloc(1 << 20);
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      const window = Buffer.concat([carry, chunk.subarray(0, bytesRead)]);
      for (const form of forms) if (!found.has(form.secret) && window.includes(form.bytes)) found.set(form.secret, form.form);
      carry = window.subarray(Math.max(0, window.length - overlap));
    }
  } finally {
    await handle.close();
  }
  return found;
}

async function scan(dir, secrets) {
  const values = (secrets ?? []).map((value, secret) => ({ value, secret })).filter(({ value }) => typeof value === 'string');
  const unscanned = values.filter(({ value }) => value.length < 8).map(({ secret }) => secret);
  const forms = values.filter(({ value }) => value.length >= 8).flatMap(({ value, secret }) => secretForms(value, secret));
  const leaks = [];
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile())
        for (const [secret, form] of await findForms(path, forms)) leaks.push({ file: relative(dir, path), secret, ...(form ? { form } : {}) });
    }
  }
  if (forms.length) await walk(dir);
  leaks.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.secret - b.secret));
  return { leaks, unscanned };
}

/**
 * Run (or resume) a plan in `dir`.
 *   tasks       [{ id, ...fields }] in the order they should start; ids are file names
 *   run         async (task, { signal, dir, taskDir }) => ({ ok: boolean, ...result })
 *   gate        streakGate(), rateGate() or allGate() (the default)
 *   revision    the frozen revision label written into every checkpoint
 *   resume      continue an interrupted run in `dir`; otherwise `dir` must not hold a run yet
 *   freeze      { root, files } hashed into the manifest; a resume refuses if any changed
 *   concurrency how many tasks run at once (1)
 *   exclusive   task => key: at most one running task per key (e.g. one local model)
 *   timeoutMs   a task still running after this many milliseconds is aborted and recorded as ok false, error 'timeout'
 *   retries     how many times a task whose result says `infra: true` runs again before that result counts (0)
 *   roundsInOrder  no task with a `round` starts before every task of the earlier rounds finished
 *   budget      { capUsd, estimate: task => usd }: no task starts when the spend so far (tasks return `costUsd`), the
 *               estimates of the tasks in flight and its own estimate would pass capUsd; the run ends as budget-reached
 *   secrets     literal values that must not appear in any file under `dir` when the run ends, as they are or JSON-escaped,
 *               URL-encoded or base64; values under 8 characters are not scanned and are listed in `unscannedSecrets`
 *   config      extra settings recorded in the manifest; a resume refuses if they changed
 *   onEvent     ({ type, ... }) => void, for logs
 * Returns { state, exitCode, summary }. Throws (and changes nothing) when it refuses to start.
 */
export async function runBench(options) {
  const { dir, tasks, run, revision, resume = false, freeze, concurrency = 1, exclusive = () => undefined, secrets,
    config = {}, timeoutMs, retries = 0, budget, roundsInOrder = false, onEvent = () => {} } = options;
  const gate = options.gate ?? allGate();
  if (!dir || !revision || typeof run !== 'function' || !Array.isArray(tasks) || !tasks.length)
    throw new Error('runBench needs dir, revision, run and a non-empty tasks list');
  const ids = new Set();
  for (const task of tasks) {
    if (!TASK_ID.test(task.id ?? '')) throw new Error(`Invalid task id: ${task.id}`);
    if (ids.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`);
    ids.add(task.id);
  }
  const plan = sha256(JSON.stringify(tasks));
  const manifestPath = join(dir, 'manifest.json');
  const statePath = join(dir, 'state.json');
  await mkdir(join(dir, 'tasks'), { recursive: true });
  const held = await exists(manifestPath);
  if (held && !resume) throw new Error(`${dir} already holds a run; use a fresh folder or resume it`);
  if (!held && resume) throw new Error(`${dir} holds no run to resume`);

  const release = await lock(dir);
  let manifest;
  const records = new Map();
  try {
    const files = await frozenFiles(freeze);
    if (resume) {
      manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      const previous = JSON.parse(await readFile(statePath, 'utf8').catch(() => '{}'));
      if (FINISHED.has(previous.state)) throw new Error(`${dir} holds a finished run (${previous.state})`);
      if (manifest.revision !== revision) throw new Error(`Revision changed: ${manifest.revision} → ${revision}`);
      if (manifest.plan !== plan) throw new Error('The task plan changed since the run started');
      if (manifest.gate !== gate.name) throw new Error('The gate changed since the run started');
      if (JSON.stringify(manifest.config) !== JSON.stringify(config)) throw new Error('The config changed since the run started');
      const now = new Map(files.map(file => [file.path, file.sha256]));
      for (const file of manifest.files)
        if (now.get(file.path) !== file.sha256) throw new Error(`Frozen file changed: ${file.path}`);
      const kept = new Set(manifest.files.map(file => file.path));
      for (const file of files) if (!kept.has(file.path)) throw new Error(`Frozen file added: ${file.path}`);
      for (const name of (await readdir(join(dir, 'tasks'))).filter(name => name.endsWith('.json'))) {
        const record = JSON.parse(await readFile(join(dir, 'tasks', name), 'utf8'));
        if (!ids.has(record.id) || record.revision !== revision || record.fingerprint !== manifest.fingerprint)
          throw new Error(`Checkpoint does not belong to this run: ${name}`);
        records.set(record.id, record);
      }
    } else {
      manifest = { schema: SCHEMA, revision, createdAt: new Date().toISOString(), plan, gate: gate.name, files,
        fingerprint: sha256(JSON.stringify({ revision, plan, files })), tasks: tasks.length, config,
        node: process.version, platform: process.platform };
      await atomic(manifestPath, manifest);
    }
  } catch (error) {
    await release();
    throw error;
  }

  const controller = new AbortController();
  const active = new Map();
  const startedAt = new Date().toISOString();
  const pidStarted = processStart(process.pid);
  let state = 'running';
  let failure;
  let verdict = gate.evaluate(records, tasks);
  let reserved = 0;
  const spent = () => [...records.values()].reduce((sum, record) => sum + (record.costUsd ?? 0), 0);
  const save = () => atomic(statePath, { state, pid: process.pid, ...(pidStarted ? { pidStarted } : {}), revision, startedAt, updatedAt: new Date().toISOString(),
    completed: records.size, total: tasks.length, active: [...active.values()], summary: verdict.summary,
    ...(budget ? { spentUsd: spent(), capUsd: budget.capUsd } : {}), ...(failure ? { failure } : {}) });
  const heartbeat = setInterval(() => { save().catch(() => {}); }, 15000);
  heartbeat.unref();
  const interrupt = () => {
    if (state === 'running' || state === 'budget-reached') { state = 'interrupted'; controller.abort(new Error('interrupted')); }
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);

  try {
    await save();
    if (verdict.stop) state = verdict.state;
    const pending = tasks.filter(task => !records.has(task.id));
    const busy = new Set();
    await new Promise((settle, fail) => {
      let running = 0;
      const next = () => {
        if (state !== 'running') { if (!running) settle(); return; }
        while (running < concurrency) {
          const current = roundsInOrder
            ? Math.min(...tasks.filter(task => !records.has(task.id) && task.round !== undefined).map(task => task.round))
            : Infinity;
          const index = pending.findIndex(task => {
            if (task.round > current) return false;
            const key = exclusive(task);
            return key === undefined || !busy.has(key);
          });
          if (index === -1) break;
          const estimate = budget ? Number(budget.estimate?.(pending[index]) ?? 0) : 0;
          if (budget && spent() + reserved + estimate > budget.capUsd) { state = 'budget-reached'; break; }
          const [task] = pending.splice(index, 1);
          const key = exclusive(task);
          if (key !== undefined) busy.add(key);
          running++;
          reserved += estimate;
          execute(task).then(() => {
            running--;
            reserved -= estimate;
            if (key !== undefined) busy.delete(key);
            next();
          }, fail);
        }
        if (!running) settle();
      };
      next();
    });

    async function attempt(task, taskDir) {
      const limit = new AbortController();
      let timer;
      const expired = new Promise(done => {
        if (timeoutMs) timer = setTimeout(() => { limit.abort(new Error('timeout')); done(); }, timeoutMs);
      });
      try {
        const signal = AbortSignal.any([controller.signal, limit.signal]);
        const result = await Promise.race([run(task, { signal, dir, taskDir }), expired]);
        return limit.signal.aborted ? { ok: false, error: 'timeout' } : result;
      } catch (error) {
        return limit.signal.aborted ? { ok: false, error: 'timeout' } : { ok: false, error: String(error?.message ?? error).slice(0, 2000) };
      } finally {
        clearTimeout(timer);
      }
    }

    async function execute(task) {
      const taskDir = join(dir, 'tasks', task.id);
      await mkdir(taskDir, { recursive: true });
      const begun = new Date().toISOString();
      const clock = process.hrtime.bigint();
      active.set(task.id, { id: task.id, startedAt: begun });
      onEvent({ type: 'task-start', id: task.id });
      await save();
      let result;
      let attempts = 0;
      let costUsd = 0;
      const retryFits = () => {
        if (!budget) return true;
        if (state === 'running' && spent() + reserved + costUsd <= budget.capUsd) return true;
        if (state === 'running') state = 'budget-reached';
        return false;
      };
      do {
        attempts++;
        if (attempts > 1) onEvent({ type: 'task-retry', id: task.id, attempt: attempts, error: result?.error });
        result = await attempt(task, taskDir);
        costUsd += Number(result?.costUsd) || 0;
      } while (result?.infra === true && attempts <= retries && !controller.signal.aborted && retryFits());
      active.delete(task.id);
      if (controller.signal.aborted) return;
      const seconds = Math.round(Number(process.hrtime.bigint() - clock) / 1e6) / 1e3;
      const record = { id: task.id, task, revision, fingerprint: manifest.fingerprint, startedAt: begun, seconds,
        ok: result?.ok === true, ...(attempts > 1 ? { attempts } : {}), ...(costUsd ? { costUsd } : {}), result: result ?? null };
      await atomic(join(dir, 'tasks', `${task.id}.json`), record);
      records.set(task.id, record);
      verdict = gate.evaluate(records, tasks);
      onEvent({ type: 'task-end', id: task.id, ok: record.ok, seconds });
      if (verdict.stop && (state === 'running' || state === 'budget-reached')) {
        state = verdict.state;
        controller.abort(new Error('gate stopped the run'));
      }
      await save();
    }
    if (state === 'running') state = verdict.state ?? 'runner-error';
  } catch (error) {
    if (state === 'running') state = 'runner-error';
    failure = String(error?.stack ?? error).slice(0, 4000);
  } finally {
    clearInterval(heartbeat);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
  const { leaks, unscanned } = await scan(dir, secrets);
  if (unscanned.length) {
    onEvent({ type: 'secrets-unscanned', secrets: unscanned });
    verdict = { ...verdict, summary: { ...verdict.summary, unscannedSecrets: unscanned } };
  }
  if (leaks.length) {
    state = 'secret-leak';
    verdict = { ...verdict, summary: { ...verdict.summary, leaks } };
  }
  await save();
  await release();
  onEvent({ type: 'end', state });
  return { state, exitCode: EXIT[state] ?? 2, summary: verdict.summary };
}
