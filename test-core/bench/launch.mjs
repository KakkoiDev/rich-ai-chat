// Start a benchmark so it outlives the program (or app session) that started it, and stop it later by its folder.
// macOS: a launchd job (survives the launching app quitting). Elsewhere: a detached process. Either way the run's
// folder gets launch.json, which `stop` reads. Put secrets in an env file read by the run (node --env-file), never in
// `env`: launchd keeps `env` in a plist on disk. No dependencies.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { open, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const xml = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function launchctl(...args) {
  const child = spawn('launchctl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', data => { out += data; });
  child.stderr.on('data', data => { err += data; });
  const [code] = await once(child, 'close');
  return { code, out, err: err.trim() };
}

/** A finished job stays loaded under its label and blocks a new bootstrap: remove it. Refuse while it still runs. */
async function clearFinishedJob(label) {
  const target = `gui/${process.getuid()}/${label}`;
  const { code, out } = await launchctl('print', target);
  if (code !== 0) return;
  if (/^\s*state = running$/m.test(out)) throw new Error(`${label} is still running; stop it first`);
  const removed = await launchctl('bootout', target);
  if (removed.code !== 0) throw new Error(`launchctl bootout failed: ${removed.err || `exit ${removed.code}`}`);
}

/**
 * launchDetached({ folder, label, argv, cwd, env, method })
 *   folder  the run's report folder: launch.json, run.log and error.log go here
 *   argv    the command; a leading "node" means this Node.js
 *   method  "launchd" (default on macOS) or "detached"
 */
export async function launchDetached({ folder, label, argv, cwd = process.cwd(), env = {}, method = process.platform === 'darwin' ? 'launchd' : 'detached' }) {
  if (!LABEL.test(label ?? '')) throw new Error(`Invalid label: ${label}`);
  if (!Array.isArray(argv) || !argv.length) throw new Error('launchDetached needs argv');
  const dir = resolve(folder);
  const command = argv[0] === 'node' ? [process.execPath, ...argv.slice(1)] : argv;
  const stdout = join(dir, 'run.log');
  const stderr = join(dir, 'error.log');
  const record = { method, label, argv: command, cwd: resolve(cwd), startedAt: new Date().toISOString() };
  if (method === 'launchd') {
    await clearFinishedJob(label);
    const plist = join(dir, 'job.plist');
    const strings = values => values.map(value => `<string>${xml(value)}</string>`).join('');
    const environment = Object.entries(env).map(([key, value]) => `<key>${xml(key)}</key><string>${xml(value)}</string>`).join('');
    await writeFile(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string>
<key>ProgramArguments</key><array>${strings(command)}</array>
<key>WorkingDirectory</key><string>${xml(record.cwd)}</string>
<key>EnvironmentVariables</key><dict>${environment}</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><false/>
<key>StandardOutPath</key><string>${xml(stdout)}</string>
<key>StandardErrorPath</key><string>${xml(stderr)}</string>
</dict></plist>
`);
    const { code, err } = await launchctl('bootstrap', `gui/${process.getuid()}`, plist);
    if (code !== 0) throw new Error(`launchctl bootstrap failed: ${err || `exit ${code}`}`);
    Object.assign(record, { plist });
  } else if (method === 'detached') {
    const out = await open(stdout, 'a');
    const err = await open(stderr, 'a');
    const child = spawn(command[0], command.slice(1), { cwd: record.cwd, env: { ...process.env, ...env }, detached: true,
      stdio: ['ignore', out.fd, err.fd] });
    child.unref();
    await out.close();
    await err.close();
    Object.assign(record, { pid: child.pid });
  } else throw new Error(`Unknown method: ${method}`);
  await writeFile(join(dir, 'launch.json'), JSON.stringify(record, null, 2) + '\n');
  return record;
}

/** Stop the run started in `folder`: SIGTERM, which the runner records as interrupted. */
export async function stopDetached(folder) {
  const record = JSON.parse(await readFile(join(resolve(folder), 'launch.json'), 'utf8'));
  if (record.method === 'launchd') {
    const { code, err } = await launchctl('bootout', `gui/${process.getuid()}/${record.label}`);
    if (code !== 0 && !/No such process|Could not find/i.test(err)) throw new Error(`launchctl bootout failed: ${err}`);
  } else {
    try { process.kill(record.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  return record;
}
