/* eslint-disable @typescript-eslint/no-require-imports -- standalone report builder. */
const fs = require('node:fs');
const path = require('node:path');
const models = ['gpt-oss', 'deepseek'];
const rounds = models.map(slug => {
  const read = suffix => JSON.parse(fs.readFileSync(path.join(__dirname, slug + '-' + suffix + '.json'), 'utf8'));
  const base = read('expanded');
  const retest = read('assertion-retest');
  if (base.model !== retest.model || base.appRevision !== retest.appRevision) throw Error('Mismatched runs: ' + slug);
  const replacements = new Map(retest.cases.map(c => [c.id, c]));
  return { ...base, cases: base.cases.map(c => replacements.has(c.id) ? { ...replacements.get(c.id), retest: true } : c) };
});
if (new Set(rounds.map(r => r.appRevision)).size !== 1) throw Error('App revisions differ');
const rows = rounds[0].cases.map(({ id, category }) => {
  const cells = rounds.map(run => {
    const c = run.cases.find(result => result.id === id);
    return `${c.status.toUpperCase()} · ${c.seconds.toFixed(2)} s${c.retest ? ' †' : ''}`;
  });
  return `| ${id} | ${category} | ${cells.join(' | ')} |`;
});
const totals = rounds.map(r => r.cases.filter(c => c.status === 'pass').length + '/' + r.cases.length);
let report = [
  '# Rich AI Chat breadth comparison', '',
  'App revision: `' + rounds[0].appRevision.slice(0, 7) + '`.', '',
  'One observation per case and model. † uses a fresh run after an assertion correction, replacing the initial result for both models. Initial and retest JSON files are retained. Time is end-to-end and includes browser work and timeouts.', '',
  '| Case | Family | ' + rounds.map(r => r.model).join(' | ') + ' |',
  '| --- | --- | --- | --- |', ...rows,
  '| **Total** | | ' + totals.join(' | ') + ' |', '',
  '## Failure details', '',
].join('\n');
for (const r of rounds) {
  for (const c of r.cases.filter(c => c.status !== 'pass')) {
    report += '\n- **' + r.model + ' / ' + c.id + ':** ' + (c.detail || c.status).split('\n').slice(0, 3).join(' ').replaceAll('`', "'") + '\n';
  }
}
fs.writeFileSync(path.join(__dirname, 'comparison.md'), report);
console.log(rounds.map((r, i) => r.model + ': ' + totals[i]).join(', '));
