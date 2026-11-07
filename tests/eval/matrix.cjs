/* eslint-disable @typescript-eslint/no-require-imports -- standalone benchmark driver. */
// The five-model matrix on test-core's pinned benchmark runner (test-core/bench). One task is one model in one round:
// it starts the app for that model, runs every suite and passes only when each suite passed all its expected cases.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const { EVAL_REVISION, EVAL_DIR, RICH_CHAT_BUILD_DIR } = process.env;
assert.ok(EVAL_REVISION && EVAL_DIR && RICH_CHAT_BUILD_DIR, 'Set EVAL_REVISION, EVAL_DIR, and RICH_CHAT_BUILD_DIR');
const models = process.argv.slice(2);
if (!models.length) models.push('deepseek-flash', 'gpt-oss:20b', 'gemma4:12b-mlx', 'gemma4:e4b-mlx', 'gemma4:e2b-mlx');
const port = Number(process.env.EVAL_PORT || 3238);
const chatUrl = 'http://127.0.0.1:' + port + '/';
const directory = path.resolve(EVAL_DIR);
// The release gate is 10 + 1. Smaller values are for parity and focused checks and never count as a stable release.
const required = Number(process.env.EVAL_REQUIRED || 10);
const regression = Number(process.env.EVAL_REGRESSION ?? 1);
const suites = [
  ['basic', path.join(__dirname, 'run.cjs'), 14],
  ['breadth', path.join(__dirname, 'breadth/run-breadth.cjs'), 13],
];
const root = path.resolve(__dirname, '../..');
const frozen = ['tests/eval/matrix.cjs', 'tests/eval/run.cjs', 'tests/eval/breadth/run-breadth.cjs',
  ...fs.readdirSync(path.join(root, 'tests/e2e')).map(name => 'tests/e2e/' + name),
  'test-core/bench/bench.mjs', 'package-lock.json', path.join(RICH_CHAT_BUILD_DIR, 'BUILD_ID')];

async function evaluate(model, round, taskDir, signal) {
  const hosted = model === 'deepseek-flash';
  const env = {
    ...process.env, NEXT_TELEMETRY_DISABLED: '1', MODEL_ID: model, EVAL_MODEL: model, CHAT_URL: chatUrl,
    MODEL_BASE_URL: hosted ? 'https://api.deepseek.com' : 'http://127.0.0.1:11434/v1',
    MODEL_API_KEY: hosted ? process.env.DEEPSEEK_API_KEY || '' : 'local',
  };
  assert.ok(env.MODEL_API_KEY, 'DeepSeek API key is missing');
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)],
    { env, stdio: 'inherit', signal, killSignal: 'SIGTERM' });
  server.on('error', () => {});
  const results = [];
  try {
    for (let attempt = 0; ; attempt++) {
      if (signal.aborted) throw new Error('aborted');
      if (server.exitCode !== null || attempt === 50) throw new Error('Benchmark chat server did not start');
      const response = await fetch(chatUrl, { signal: AbortSignal.timeout(1000) }).catch(() => null);
      if (response?.ok) { await response.arrayBuffer(); break; }
      await delay(200);
    }
    for (const [suite, script, expected] of suites) {
      const file = path.join(taskDir, suite + '.json');
      const runner = spawn(process.execPath, [script], { env: { ...env, EVAL_ROUND: String(round), EVAL_REPORT: file }, stdio: 'inherit', signal });
      runner.on('error', () => {});
      const [code] = await once(runner, 'exit');
      if (signal.aborted) throw new Error('aborted');
      const result = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
      const passed = result?.cases.filter(test => test.status === 'pass').length ?? 0;
      const perfect = code === 0 && result?.model === model && result.appRevision === EVAL_REVISION &&
        result.cases.length === expected && passed === expected;
      results.push({ suite, passed, expected, perfect, report: result ? path.relative(directory, file) : null });
    }
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'exit');
      server.kill();
      await exited;
    }
  }
  return results;
}

(async () => {
  const { runBench, streakGate } = await import(path.join(root, 'test-core/bench/bench.mjs'));
  const resume = process.env.EVAL_RESUME === '1';
  if (!resume) {
    const existing = await fetch(chatUrl, { signal: AbortSignal.timeout(1000) }).catch(() => null);
    assert.ok(!existing, 'The benchmark port is already in use');
  }
  const tasks = [];
  for (let round = 1; round <= required + regression; round++)
    for (const model of models)
      tasks.push({ id: 'r' + String(round).padStart(2, '0') + '-' + model.replace(/[^a-z0-9.-]/gi, '-'), round, model });
  const { state, exitCode, summary } = await runBench({
    dir: directory, revision: EVAL_REVISION, tasks, resume,
    gate: streakGate({ required, regression }),
    freeze: { root, files: frozen },
    secrets: [process.env.DEEPSEEK_API_KEY, process.env.MODEL_API_KEY, process.env.BRAVE_SEARCH_API_KEY],
    config: { models, suites: suites.map(([name, , expected]) => ({ name, expected })), required, regression, port },
    onEvent: event => { if (event.type === 'task-start') console.log(`=== ${event.id} ===`); },
    async run(task, { signal, taskDir }) {
      const results = await evaluate(task.model, task.round, taskDir, signal);
      const passed = results.reduce((sum, suite) => sum + suite.passed, 0);
      const expected = suites.reduce((sum, [, , count]) => sum + count, 0);
      return { ok: results.length === suites.length && results.every(suite => suite.perfect), checks: { passed, expected }, suites: results };
    },
  });
  // A short summary under the historical name for tools and notes that read matrix.json.
  fs.writeFileSync(path.join(directory, 'matrix.json'), JSON.stringify({ revision: EVAL_REVISION, models, required,
    regressionRounds: regression, state, summary }, null, 2) + '\n');
  console.log(`${state}: ${summary.checks?.passed ?? 0}/${summary.checks?.expected ?? 0} checks`);
  process.exitCode = exitCode;
})().catch(error => {
  console.error(error.message);
  process.exitCode = 2;
});
