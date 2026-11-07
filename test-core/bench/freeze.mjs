// Freeze one committed revision of a git repository into its own folder, so a long benchmark runs on exactly that
// code while work continues in the checkout. Committed files come from `git archive` (uncommitted edits never leak
// in); large folders such as node_modules are copied, as APFS clones on macOS. No dependencies beyond git and tar.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

async function run(command, args, options = {}) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  let out = '';
  let err = '';
  child.stdout.on('data', data => { out += data; });
  child.stderr.on('data', data => { err += data; });
  const [code] = await once(child, 'close');
  if (code !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${err.trim() || `exit ${code}`}`);
  return out.trim();
}

const exists = path => access(path).then(() => true, () => false);

/**
 * freezeRevision({ repo, revision, into, copy: ['node_modules'], link: { 'bench-modules': '/abs/path' } })
 * Returns { revision (full sha), dir }. Refuses an existing `into` or an unknown revision, and changes nothing then.
 */
export async function freezeRevision({ repo, revision, into, copy = [], link = {} }) {
  const dir = resolve(into);
  const source = resolve(repo);
  if (await exists(dir)) throw new Error(`${dir} already exists; freeze into a new folder`);
  const sha = await run('git', ['-C', source, 'rev-parse', '--verify', `${revision}^{commit}`])
    .catch(() => { throw new Error(`Unknown revision: ${revision}`); });
  await mkdir(dir, { recursive: true });
  try {
    return await fill(source, sha, dir, copy, link);
  } catch (error) {
    await rm(dir, { recursive: true, force: true }); // never leave a half-frozen folder behind
    throw error;
  }
}

async function fill(source, sha, dir, copy, link) {
  // Through a tar file: piping one child into another leaves the first one's close event unfired.
  const archive = join(dir, '.frozen-revision.tar');
  await run('git', ['-C', source, 'archive', '--format=tar', '-o', archive, sha]);
  await run('tar', ['-xf', archive, '-C', dir]);
  await rm(archive);
  for (const relative of copy) {
    if (isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error(`Copy paths stay inside the repo: ${relative}`);
    const from = join(source, relative);
    if (!(await exists(from))) throw new Error(`Nothing to copy at ${relative}`);
    // -c makes APFS clones on macOS: instant and no extra disk until a file changes.
    await run('cp', [...(process.platform === 'darwin' ? ['-c'] : []), '-R', from, join(dir, relative)]);
  }
  for (const [name, target] of Object.entries(link)) await symlink(target, join(dir, name));
  await writeFile(join(dir, 'FROZEN.json'), JSON.stringify({ revision: sha, frozenAt: new Date().toISOString(), repo: source,
    copied: copy, linked: link }, null, 2) + '\n');
  return { revision: sha, dir };
}
