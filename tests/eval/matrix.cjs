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
const evalClock = '2026-01-15T12:00:00Z';
const suites = [
  ['basic', path.join(__dirname, 'run.cjs'), 17],
  ['breadth', path.join(__dirname, 'breadth/run-breadth.cjs'), 13],
  ['features', path.join(__dirname, 'features/run-features.cjs'), 4],
  ['conversations', path.join(__dirname, 'conversation-smoke.mjs'), 5],
];
// Listable suites must match their frozen case counts, or the run refuses to start.
for (const [name, script, expected] of suites.slice(2)) {
  const listed = require('node:child_process').execFileSync(process.execPath, [script, '--list'], { encoding: 'utf8' }).trim().split('\n');
  assert.equal(listed.length, expected, `${name} lists ${listed.length} cases; update its expected count`);
}
const root = path.resolve(__dirname, '../..');
const frozen = ['tests/eval/matrix.cjs', 'tests/eval/run.cjs', 'tests/eval/breadth/run-breadth.cjs',
  'tests/eval/features/run-features.cjs', 'tests/eval/features/prompts.cjs',
  'tests/eval/conversation-smoke.mjs', 'tests/eval/conversation-provider.mjs',
  ...fs.readdirSync(path.join(root, 'tests/e2e')).map(name => 'tests/e2e/' + name),
  'test-core/bench/bench.mjs', 'test-core/bench/conversation.mjs', 'test-core/bench/response-proxy.mjs', 'tests/eval/paid-proxy.mjs', 'tests/eval/map-fixture.mjs',
  'package-lock.json', path.join(RICH_CHAT_BUILD_DIR, 'BUILD_ID')];

async function evaluate(model, round, taskDir, signal, provider, mapFixture) {
  const hosted = model === 'deepseek-flash';
  const env = {
    ...process.env, NEXT_TELEMETRY_DISABLED: '1', MODEL_ID: model, EVAL_MODEL: model, CHAT_URL: chatUrl,
    MODEL_BASE_URL: hosted ? provider.origin : 'http://127.0.0.1:11434/v1',
    MODEL_API_KEY: 'local', RICH_CHAT_PAID_PROXY: provider.origin,
    RICH_CHAT_EVAL_CLOCK: evalClock, RICH_CHAT_GEOCODER_URL: mapFixture.url, RICH_CHAT_FORECAST_URL: mapFixture.forecastUrl,
    BRAVE_SEARCH_API_KEY: 'fixture', DEEPSEEK_API_KEY: 'fixture',
    EVAL_BRAVE_SEARCH_API_KEY: '', EVAL_DEEPSEEK_API_KEY: '',
  };
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
      let file = path.join(taskDir, suite + '.json');
      // An interrupted task may already have a partial suite report. Preserve it on resume.
      for (let retry = 1; fs.existsSync(file); retry++) file = path.join(taskDir, suite + '.retry-' + retry + '.json');
      const runner = spawn(process.execPath, [script], { env: { ...env, EVAL_ROUND: String(round), EVAL_REPORT: file }, stdio: 'inherit', signal });
      runner.on('error', () => {});
      const [code] = await once(runner, 'exit');
      if (signal.aborted) throw new Error('aborted');
      const result = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
      const passed = result?.cases.filter(test => test.status === 'pass').length ?? 0;
      const perfect = code === 0 && result?.model === model && result.appRevision === EVAL_REVISION &&
        result.cases.length === expected && passed === expected;
      results.push({ suite, passed, expected, perfect, report: result ? path.relative(directory, file) : null,
        cases: (result?.cases ?? []).map(c => ({ id: `${suite}/${c.id}`, status: c.status, seconds: c.seconds, ...(c.detail ? { detail: c.detail } : {}) })) });
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
  if (process.env.EVAL_PAID_MODE === 'record')
    assert.ok(!resume && required === 1 && regression === 0, 'Use EVAL_REQUIRED=1 EVAL_REGRESSION=0 for a separate recording run');
  const { paidProxy } = await import('./paid-proxy.mjs');
  const proxy = await paidProxy(process.env);
  let mapFixture, provider;
  try {
    mapFixture = await (await import('./map-fixture.mjs')).startMapFixture();
    provider = await (await import('./conversation-provider.mjs')).startConversationProvider(proxy.origin);
    const { state, exitCode, summary } = await runBench({
      dir: directory, revision: EVAL_REVISION, tasks, resume,
      gate: streakGate({ required, regression }),
      freeze: { root, files: frozen },
      secrets: [process.env.DEEPSEEK_API_KEY, process.env.MODEL_API_KEY, process.env.BRAVE_SEARCH_API_KEY],
      config: { models, suites: suites.map(([name, , expected]) => ({ name, expected })), required, regression, port,
        paidMode: proxy.mode, cassetteDigest: proxy.digest, evalClock },
      onEvent: event => { if (event.type === 'task-start') console.log(`=== ${event.id} ===`); },
      async run(task, { signal, taskDir }) {
        const before = { ...proxy.stats };
        const results = await evaluate(task.model, task.round, taskDir, signal, provider, mapFixture);
        const paid = Object.fromEntries(Object.entries(proxy.stats).map(([key, count]) => [key, count - before[key]]));
        const passed = results.reduce((sum, suite) => sum + suite.passed, 0);
        const expected = suites.reduce((sum, [, , count]) => sum + count, 0);
        // `cases` lets test-core's report show each model's cases, timings and failures.
        return { ok: !paid.misses && !paid.failures && (proxy.mode !== 'replay' || paid.outbound === 0) && results.length === suites.length && results.every(suite => suite.perfect),
          paid, checks: { passed, expected },
          suites: results.map(s => ({ suite: s.suite, passed: s.passed, expected: s.expected, perfect: s.perfect, report: s.report })),
          cases: results.flatMap(suite => suite.cases) };
      },
    });
    // A short summary under the historical name for tools and notes that read matrix.json.
    fs.writeFileSync(path.join(directory, 'matrix.json'), JSON.stringify({ revision: EVAL_REVISION, models, required,
      regressionRounds: regression, state, summary, paid: { mode: proxy.mode, digest: proxy.digest, ...proxy.stats } }, null, 2) + '\n');
    console.log(`${state}: ${summary.checks?.passed ?? 0}/${summary.checks?.expected ?? 0} checks`);
    process.exitCode = exitCode;
  } finally { await Promise.all([proxy.close(), mapFixture?.close(), provider?.close()]); }
})().catch(error => {
  console.error(error.message);
  process.exitCode = 2;
});
