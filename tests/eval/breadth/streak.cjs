/* eslint-disable @typescript-eslint/no-require-imports -- standalone benchmark driver. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { CHAT_URL, EVAL_MODEL, EVAL_REVISION, EVAL_DIR } = process.env;
assert.ok(CHAT_URL && EVAL_MODEL && EVAL_REVISION && EVAL_DIR, 'Set CHAT_URL, EVAL_MODEL, EVAL_REVISION and EVAL_DIR');
const directory = path.resolve(EVAL_DIR);
fs.mkdirSync(directory, { recursive: true });
assert.ok(!fs.readdirSync(directory).some(name => /^round-\d+\.json$/.test(name)), 'Use a fresh EVAL_DIR for each streak');
const summary = { model: EVAL_MODEL, appRevision: EVAL_REVISION, required: 10, rounds: [] };
for (let round = 1; round <= summary.required; round++) {
  const name = 'round-' + String(round).padStart(2, '0') + '.json';
  const report = path.join(directory, name);
  console.log(`=== ${EVAL_MODEL} round ${round}/${summary.required} ===`);
  const run = spawnSync(process.execPath, [path.join(__dirname, 'run-breadth.cjs')], {
    env: { ...process.env, EVAL_REPORT: report }, stdio: 'inherit',
  });
  const result = fs.existsSync(report) ? JSON.parse(fs.readFileSync(report, 'utf8')) : undefined;
  const passed = result?.cases.filter(c => c.status === 'pass').length ?? 0;
  const perfect = run.status === 0 && result?.model === EVAL_MODEL &&
    result?.appRevision === EVAL_REVISION && result.cases.length === 12 && passed === 12;
  summary.rounds.push({ round, report: result ? name : null, passed, perfect, exitCode: run.status });
  fs.writeFileSync(path.join(directory, 'streak.json'), JSON.stringify(summary, null, 2) + '\n');
  if (!perfect) {
    console.error('Streak ended. Fix the failure and start a new streak on a frozen revision.');
    process.exitCode = run.status === 2 || run.error ? 2 : 1;
    break;
  }
}
if (summary.rounds.length === summary.required && summary.rounds.every(r => r.perfect)) {
  console.log(`STABLE: ${EVAL_MODEL} passed ${summary.required} consecutive 12/12 rounds.`);
}
