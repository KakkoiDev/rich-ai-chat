// Read a benchmark run folder (written by bench.mjs) and summarise it per subject: cases passed, median and slowest
// times, and every failure with its detail. A task's result may list its cases as `cases: [{ id, status, seconds,
// detail? }]`; without them the task itself counts as one case. No dependencies.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { sameProcess } from './bench.mjs';

const FINAL = new Set(['stable-and-regression-passed', 'needs-investigation', 'complete', 'above-threshold', 'below-threshold',
  'inconclusive', 'budget-reached', 'secret-leak', 'interrupted', 'runner-error']);
const EXIT = { 'stable-and-regression-passed': 0, complete: 0, 'above-threshold': 0, 'needs-investigation': 1, 'below-threshold': 1,
  inconclusive: 1, 'budget-reached': 1, interrupted: 130, 'runner-error': 2, 'secret-leak': 2, stale: 2 };

const median = values => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** The run's state, with "stale" when it still says running but its process is gone or its PID now names another process. */
export async function readState(dir) {
  const state = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'));
  if (state.state === 'running' && state.pid && !sameProcess(state.pid, state.pidStarted)) return { ...state, state: 'stale' };
  return state;
}

export async function summarize(dir, { subjectOf = task => task.subject ?? task.model ?? task.id } = {}) {
  const state = await readState(dir);
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  const names = (await readdir(join(dir, 'tasks'))).filter(name => name.endsWith('.json')).sort();
  const subjects = new Map();
  for (const name of names) {
    const record = JSON.parse(await readFile(join(dir, 'tasks', name), 'utf8'));
    const subject = String(subjectOf(record.task));
    const entry = subjects.get(subject) ?? { subject, tasks: 0, failedTasks: 0, passed: 0, total: 0, seconds: [], failures: [] };
    entry.tasks++;
    if (!record.ok) entry.failedTasks++;
    const cases = Array.isArray(record.result?.cases) ? record.result.cases
      : [{ id: record.id, status: record.ok ? 'pass' : 'fail', seconds: record.seconds, detail: record.result?.error ?? record.result?.detail }];
    for (const one of cases) {
      entry.total++;
      if (one.status === 'pass') entry.passed++;
      else entry.failures.push({ task: record.id, case: one.id, detail: String(one.detail ?? '').slice(0, 500) });
      if (typeof one.seconds === 'number') entry.seconds.push(one.seconds);
    }
    subjects.set(subject, entry);
  }
  return {
    dir, state: state.state, revision: manifest.revision, completed: state.completed, total: state.total,
    checks: state.summary?.checks, rounds: state.summary?.rounds, failedRound: state.summary?.failedRound,
    active: state.active ?? [], updatedAt: state.updatedAt, final: FINAL.has(state.state) || state.state === 'stale',
    exitCode: EXIT[state.state] ?? (state.state === 'running' ? undefined : 2),
    subjects: [...subjects.values()].map(({ seconds, ...entry }) => ({
      ...entry, medianSeconds: Math.round(median(seconds) * 10) / 10, maxSeconds: Math.round(Math.max(0, ...seconds) * 10) / 10,
    })),
  };
}

export function formatSummary(summary) {
  const lines = [`${summary.state}: ${summary.completed}/${summary.total} tasks · revision ${String(summary.revision).slice(0, 12)}`];
  if (summary.checks) lines.push(`checks ${summary.checks.passed}/${summary.checks.expected}`);
  for (const round of summary.rounds ?? [])
    lines.push(`round ${round.round}${round.regression ? ' (regression)' : ''}: ${round.done}/${round.tasks} ${round.perfect ? 'perfect' : 'FAILED'}`);
  for (const active of summary.active) lines.push(`running ${active.id} since ${active.startedAt}`);
  for (const s of summary.subjects) {
    lines.push(`${s.subject}: ${s.passed}/${s.total} cases · median ${s.medianSeconds} s · slowest ${s.maxSeconds} s`);
    for (const f of s.failures) lines.push(`  FAIL ${f.task} ${f.case}: ${f.detail.replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  return lines.join('\n');
}

/** Resolve with the summary once the run is final (or stale). Polls the state file; it never starts or stops a run. */
export async function waitForRun(dir, { pollMs = 5000, signal } = {}) {
  for (;;) {
    const summary = await summarize(dir).catch(error => (error.code === 'ENOENT' ? undefined : Promise.reject(error)));
    if (summary?.final) return summary;
    if (signal?.aborted) throw signal.reason ?? new Error('aborted');
    await new Promise(done => setTimeout(done, pollMs)); // a held timer: a watcher keeps its process alive
  }
}
