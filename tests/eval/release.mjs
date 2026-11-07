// Start a release streak for one revision, the way the benchmark plan requires (docs/BENCHMARK-PLAN.md):
// freeze the commit into its own folder, build it there, run the deterministic browser checks on that build, then
// launch the five-model matrix so it outlives this process (test-core/bench). Watch it with
//   node test-core/bench/cli.mjs watch <report folder>
//
//   node tests/eval/release.mjs [--revision HEAD] [--note "why"] [--no-launch] [model ...]
//
// Settings: RICH_CHAT_BENCH_ROOT (reports and builds; default ~/Library/Application Support/Rich AI Chat Benchmarks),
// RICH_CHAT_BENCH_MODULES (a folder providing Playwright; default: <root>/bench-modules),
// RICH_CHAT_ENV_FILE (secrets, read by the run itself; default /Library/Application Support/Rich AI Chat/.env).
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeRevision } from '../../test-core/bench/freeze.mjs';
import { launchDetached } from '../../test-core/bench/launch.mjs';
import { summarize } from '../../test-core/bench/report.mjs';

const repo = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const args = process.argv.slice(2);
const flag = name => { const at = args.indexOf(name); return at < 0 ? undefined : args.splice(at, 2)[1]; };
const revision = flag('--revision') ?? 'HEAD';
const note = flag('--note');
const launch = !args.includes('--no-launch');
const models = args.filter(arg => !arg.startsWith('--'));
const root = process.env.RICH_CHAT_BENCH_ROOT || join(homedir(), 'Library', 'Application Support', 'Rich AI Chat Benchmarks');
const envFile = process.env.RICH_CHAT_ENV_FILE || '/Library/Application Support/Rich AI Chat/.env';

async function step(label, command, argv, options) {
  console.log(`== ${label}`);
  const child = spawn(command, argv, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const [code] = await once(child, 'close');
  if (code !== 0) throw new Error(`${label} failed:\n${output.slice(-3000)}`);
  return output;
}

const freePort = () => new Promise(done => { const server = createServer().listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => done(port)); }); });

async function main() {
  // One benchmark at a time on the local models.
  const latest = join(root, 'latest.txt');
  if (launch && existsSync(latest)) {
    const current = readFileSync(latest, 'utf8').trim();
    const state = existsSync(join(current, 'state.json')) ? await summarize(current).catch(() => undefined) : undefined;
    if (state && !state.final) throw new Error(`A benchmark is still running in ${current}; stop or watch it first.`);
  }
  const sha = (await step('Resolve the revision', 'git', ['-C', repo, 'rev-parse', '--verify', `${revision}^{commit}`])).trim();
  const build = join(root, 'builds', sha);
  const modules = process.env.RICH_CHAT_BENCH_MODULES || join(root, 'bench-modules');
  if (!existsSync(join(modules, 'playwright'))) throw new Error(`No Playwright in ${modules}; set RICH_CHAT_BENCH_MODULES.`);
  if (!existsSync(build)) {
    console.log(`== Freeze ${sha} into ${build}`);
    await freezeRevision({ repo, revision: sha, into: build, copy: ['node_modules'], link: { 'bench-modules': realpathSync(modules) } });
  } else if (!existsSync(join(build, 'FROZEN.json'))) {
    throw new Error(`${build} was not frozen by test-core (no FROZEN.json); move it aside to freeze ${sha.slice(0, 7)} again.`);
  } else if (JSON.parse(readFileSync(join(build, 'FROZEN.json'), 'utf8')).revision !== sha) {
    throw new Error(`${build} holds another revision`);
  }
  const env = { ...process.env, RICH_CHAT_BUILD_DIR: '.next-local/bench', NEXT_TELEMETRY_DISABLED: '1', NODE_PATH: join(build, 'bench-modules') };
  if (!existsSync(join(build, '.next-local/bench/BUILD_ID'))) await step('Build', 'npm', ['run', 'build'], { cwd: build, env });

  // The deterministic checks run on the frozen build before any model does.
  await step('Activity checks (stub model)', process.execPath, ['tests/e2e/activity.cjs'], { cwd: build, env: { ...env, ACTIVITY_PORT: String(await freePort()) } });
  const port = await freePort();
  const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)],
    { cwd: build, env: { ...env, RICH_CHAT_LOG_DIR: 'off' }, stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    for await (const data of app.stdout) if (String(data).includes('Ready')) break;
    await step('Full-screen and export checks', process.execPath, ['tests/e2e/fullscreen-export.cjs'], { cwd: build, env: { ...env, CHAT_URL: `http://127.0.0.1:${port}/` } });
  } finally {
    app.kill();
  }
  if (!launch) return console.log(`Frozen, built and checked: ${build}`);

  const folder = mkdtempSync(join(root, 'reports', `${sha.slice(0, 7)}.`));
  if (note) writeFileSync(join(folder, 'NOTE.txt'), note.trim() + '\n');
  const record = await launchDetached({
    folder, label: `dev.kakkoi.rich-ai-chat.benchmark.${basename(folder)}`, cwd: build,
    // Settings only; the secrets stay in the env file, which the run reads itself.
    env: { PATH: process.env.PATH, NODE_PATH: join(build, 'bench-modules'), EVAL_DIR: folder, EVAL_REVISION: sha,
      RICH_CHAT_BUILD_DIR: '.next-local/bench', RICH_CHAT_LOG_DIR: join(folder, 'server-log'), RICH_CHAT_DEBUG_CAPTURE: '1' },
    argv: ['node', `--env-file=${envFile}`, 'tests/eval/matrix.cjs', ...models],
  });
  writeFileSync(latest, folder + '\n');
  console.log(`Launched ${record.label} (${record.method}).\nWatch: node test-core/bench/cli.mjs watch "${folder}"`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
