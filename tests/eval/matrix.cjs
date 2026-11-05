/* eslint-disable @typescript-eslint/no-require-imports -- standalone benchmark driver. */
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
fs.mkdirSync(directory, { recursive: true });
const summaryPath = path.join(directory, 'matrix.json');
assert.ok(!fs.existsSync(summaryPath), 'Use a fresh report directory for each revision or matrix attempt');
const summary = { revision: EVAL_REVISION, models, required: 10, regressionRounds: 1, state: 'running', rounds: [] };
const suites = [
  ['basic', path.join(__dirname, 'run.cjs'), 14],
  ['breadth', path.join(__dirname, 'breadth/run-breadth.cjs'), 12],
];

function save() {
  fs.writeFileSync(summaryPath + '.tmp', JSON.stringify(summary, null, 2) + '\n');
  fs.renameSync(summaryPath + '.tmp', summaryPath);
}

let server;
let runner;
function stop() {
  runner?.kill();
  server?.kill();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  summary.state = 'interrupted';
  save();
  stop();
  process.exit(130);
});

async function evaluate(model, roundDir, report) {
  const hosted = model === 'deepseek-flash';
  const env = {
    ...process.env, NEXT_TELEMETRY_DISABLED: '1', MODEL_ID: model, EVAL_MODEL: model, CHAT_URL: chatUrl,
    MODEL_BASE_URL: hosted ? 'https://api.deepseek.com' : 'http://127.0.0.1:11434/v1',
    MODEL_API_KEY: hosted ? process.env.DEEPSEEK_API_KEY || '' : 'local',
  };
  assert.ok(env.MODEL_API_KEY, 'DeepSeek API key is missing');
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { env, stdio: 'inherit' });
  try {
    for (let attempt = 0; ; attempt++) {
      if (server.exitCode !== null || attempt === 50) throw new Error('Benchmark chat server did not start');
      const response = await fetch(chatUrl, { signal: AbortSignal.timeout(1000) }).catch(() => null);
      if (response?.ok) { await response.arrayBuffer(); break; }
      await delay(200);
    }
    for (const [suite, script, expected] of suites) {
      summary.active = { ...summary.active, suite };
      save();
      const file = path.join(roundDir, suite + '.json');
      runner = spawn(process.execPath, [script], { env: { ...env, EVAL_REPORT: file }, stdio: 'inherit' });
      const [code] = await once(runner, 'exit');
      runner = undefined;
      const result = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
      const passed = result?.cases.filter(test => test.status === 'pass').length ?? 0;
      const perfect = code === 0 && result?.model === model && result.appRevision === EVAL_REVISION &&
        result.cases.length === expected && passed === expected;
      report.suites.push({ suite, passed, expected, perfect, report: result ? path.relative(directory, file) : null });
      save();
    }
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'exit');
      server.kill();
      await exited;
    }
    server = undefined;
  }
}

(async () => {
  const existing = await fetch(chatUrl, { signal: AbortSignal.timeout(1000) }).catch(() => null);
  assert.ok(!existing, 'The benchmark port is already in use');
  for (let round = 1; round <= summary.required + summary.regressionRounds; round++) {
    const entry = { round, regression: round > summary.required, models: [] };
    summary.rounds.push(entry);
    for (const model of models) {
      console.log(`=== ${model}, ${entry.regression ? 'final regression' : 'round ' + round + '/' + summary.required} ===`);
      const roundDir = path.join(directory, 'round-' + String(round).padStart(2, '0'), model.replace(/[^a-z0-9.-]/gi, '-'));
      fs.mkdirSync(roundDir, { recursive: true });
      const report = { model, suites: [] };
      entry.models.push(report);
      summary.active = { round, model };
      save();
      await evaluate(model, roundDir, report);
    }
    if (!entry.models.every(report => report.suites.length === suites.length && report.suites.every(test => test.perfect))) {
      summary.state = 'needs-investigation';
      process.exitCode = 1;
      break;
    }
  }
  if (summary.state === 'running') summary.state = 'stable-and-regression-passed';
  delete summary.active;
  save();
})().catch(error => {
  console.error(error.message);
  summary.state = 'runner-error';
  summary.error = error.message;
  delete summary.active;
  save();
  stop();
  process.exitCode = 2;
});
