#!/usr/bin/env node
// Command line for benchmark runs; see bench/README.md for the method.
//   node bench/cli.mjs freeze --repo . --revision HEAD --into DIR [--copy node_modules] [--link name=/target]
//   node bench/cli.mjs launch --folder RUN --label NAME [--cwd DIR] [--method launchd|detached] [--env K=V] -- node run.mjs
//   node bench/cli.mjs stop RUN
//   node bench/cli.mjs report RUN [--json]
//   node bench/cli.mjs watch RUN [--poll SECONDS] [--json]     exits with the run's exit code
// With --json, a failure prints { ok: false, error: { code, message } } on stdout, code one of usage, not-found, failed.
import { mkdir } from 'node:fs/promises';
import { freezeRevision } from './freeze.mjs';
import { launchDetached, stopDetached } from './launch.mjs';
import { formatSummary, summarize, waitForRun } from './report.mjs';

const BOOLEAN = ['json'];

function options(args, repeatable = []) {
  const found = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') { found['--'] = args.slice(i + 1); break; }
    if (!arg.startsWith('--')) { found._.push(arg); continue; }
    const name = arg.slice(2);
    const value = !BOOLEAN.includes(name) && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[++i] : true;
    if (repeatable.includes(name)) (found[name] ??= []).push(value);
    else found[name] = value;
  }
  return found;
}

const pairs = values => Object.fromEntries((values ?? []).map(value => {
  const at = String(value).indexOf('=');
  if (at < 1) throw new Error(`Expected NAME=VALUE, got ${value}`);
  return [value.slice(0, at), value.slice(at + 1)];
}));

const usage = message => Object.assign(new Error(message), { code: 'usage' });

async function main([command, ...args]) {
  const o = options(args, ['copy', 'link', 'env']);
  if (command === 'freeze') {
    if (!o.revision || !o.into) throw usage('freeze needs --revision and --into');
    return { out: await freezeRevision({ repo: o.repo ?? '.', revision: o.revision, into: o.into, copy: o.copy ?? [], link: pairs(o.link) }) };
  }
  if (command === 'launch') {
    if (!o.folder || !o.label || !o['--']?.length) throw usage('launch needs --folder, --label and -- COMMAND');
    await mkdir(o.folder, { recursive: true });
    return { out: await launchDetached({ folder: o.folder, label: o.label, argv: o['--'], cwd: o.cwd, env: pairs(o.env), method: o.method }) };
  }
  if (['stop', 'report', 'watch'].includes(command) && !o._[0]) throw usage(`${command} needs the run folder`);
  if (command === 'stop') return { out: await stopDetached(o._[0]) };
  if (command === 'report' || command === 'watch') {
    const summary = command === 'watch' ? await waitForRun(o._[0], { pollMs: Number(o.poll ?? 5) * 1000 }) : await summarize(o._[0]);
    return { text: o.json ? JSON.stringify(summary, null, 2) : formatSummary(summary), code: command === 'watch' ? summary.exitCode : 0 };
  }
  throw usage('Commands: freeze, launch, stop, report, watch');
}

let settled = false;
// If the work never finishes (nothing left to wait on), say so instead of exiting quietly with success.
process.on('beforeExit', () => {
  if (settled) return;
  settled = true;
  console.error('The command stopped before it finished.');
  process.exitCode = 2;
});
main(process.argv.slice(2)).then(({ out, text, code = 0 }) => {
  settled = true;
  console.log(text ?? JSON.stringify(out, null, 2));
  process.exitCode = code;
}, error => {
  settled = true;
  const args = process.argv.slice(2);
  const own = args.includes('--') ? args.slice(0, args.indexOf('--')) : args;
  if (own.includes('--json')) {
    const code = error.code === 'usage' ? 'usage' : error.code === 'ENOENT' ? 'not-found' : 'failed';
    console.log(JSON.stringify({ ok: false, error: { code, message: error.message } }, null, 2));
  } else console.error(error.message);
  process.exitCode = 2;
});
