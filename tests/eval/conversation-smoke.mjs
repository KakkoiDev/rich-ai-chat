// Synthetic multi-turn smoke test. Run on an isolated server with paid replay.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { runConversation } from '../../test-core/bench/conversation.mjs';

const models = ['gemma4:e2b-mlx', 'gemma4:e4b-mlx', 'gemma4:12b-mlx', 'gpt-oss:20b', 'deepseek-flash'];
const has = (text, pattern, message) => assert.match(text, pattern, message);
const map = text => {
  const m = /OpenStreetMap\("(?:[^"\\]|\\.)*",\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\)/.exec(text);
  assert.ok(m, 'Expected an inline map with bounds');
  return m.slice(1).map(Number);
};
const forecast = text => {
  has(text, /LineChart\(/, 'Expected a forecast chart with daily values');
  has(text, /Paris/i, 'Expected the carried-over city');
  has(text, /Open-Meteo/i, 'Expected forecast attribution');
};
const cases = {
  'map-followup': [
    ['Show me Paris on the map.', text => map(text)],
    ['Zoom out a little.', (text, prior) => {
      const a = map(prior[0]), b = map(text);
      assert.ok(b[0] < a[0] && b[1] < a[1] && b[2] > a[2] && b[3] > a[3], 'Expected wider bounds');
      assert.ok(Math.abs(a[0] + a[2] - b[0] - b[2]) < 0.001 &&
        Math.abs(a[1] + a[3] - b[1] - b[3]) < 0.001, 'Expected the same map center');
    }],
    ['Zoom way in.', (text, prior) => {
      const a = map(prior[1]), b = map(text);
      assert.ok((b[2] - b[0]) < (a[2] - a[0]) / 3, 'Expected a much closer view');
      assert.ok(Math.abs(a[0] + a[2] - b[0] - b[2]) < 0.001 &&
        Math.abs(a[1] + a[3] - b[1] - b[3]) < 0.001, 'Expected the same map center');
    }],
  ],
  'forecast-followup': [
    ['Show me Paris on the map.', text => map(text)],
    ["What's the weather there for the next seven days? A chart would be nice.", forecast],
    ['Could you look it up online?', forecast],
  ],
  'search-deliverable': [
    ['Pizza sounds good tonight.', text => assert.ok(text.trim())],
    ['Could you look up an easy homemade pizza recipe for me?', (text, _, events) => {
      assert.ok(events.some(e => e.type === 'data-activity' && e.data.type === 'tool-end' &&
        e.data.tool === 'web_search' && e.data.status === 'ok'), 'Expected a successful web search');
      has(text, /flour/i, 'Expected actual ingredients');
      has(text, /\d+\s*(?:g\b|cups?\b|tsp\b|teaspoons?\b)/i, 'Expected usable quantities');
      has(text, /\b(?:preheat|bake)\b/i, 'Expected cooking steps');
      has(text, /\d+\s*(?:minutes?|min\b)/i, 'Expected cooking time');
      has(text, /https:\/\//i, 'Expected source attribution');
    }],
  ],
  'game-followup': [
    ['Could you make me a game of tic-tac-toe that I can play here?', text => has(text, /HtmlArtifact\(/, 'Expected a playable preview')],
    ['Can you explain how I restart the game?', text => has(text, /\b(?:reset|restart|new game|play again)\b/i, 'Expected an answer about the game')],
  ],
  'app-followup': [
    ['Could you make me a tiny app with a button that counts how many glasses of water I drank? Add a reset button.', text => has(text, /HtmlArtifact\(/, 'Expected an app preview')],
    ['Can you show me the JavaScript for the reset part?', (text, prior) => {
      const literalReset = /(?:reset[\s\S]{0,500}(?:=\s*0|setItem|removeItem)|(?:=\s*0|setItem|removeItem)[\s\S]{0,500}reset)/i;
      // A reset can also assign a named initial value from the app. Verify the same
      // assignment and a zero initial value in the real source, not in the explanation.
      const assigned = /\b([\w.]+)\s*=\s*([\w.]+\.initialValue)\b/.exec(text);
      const sameAssignment = assigned && prior[0].includes(assigned[0]) && /\binitialValue\s*:\s*0\b/.test(prior[0]);
      assert.ok(literalReset.test(text) || (sameAssignment && /reset/i.test(text)), 'Expected working reset code');
    }],
  ],
};

if (process.argv.includes('--list')) {
  console.log(Object.keys(cases).join('\n'));
} else {
  const url = new URL(process.env.CHAT_URL || 'http://127.0.0.1:3257');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Use an isolated loopback server');
  const reportPath = process.env.EVAL_REPORT;
  assert.ok(reportPath, 'Set EVAL_REPORT to a new report path');
  const selected = process.env.EVAL_MODEL ? [process.env.EVAL_MODEL] : models;
  assert.ok(selected.every(model => models.includes(model)), 'Unknown model');
  const ids = process.argv.slice(2);
  assert.ok(ids.every(id => Object.hasOwn(cases, id)), 'Unknown case');
  const report = { model: process.env.EVAL_MODEL, appRevision: process.env.EVAL_REVISION, cases: [] };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2), { flag: 'wx' });
  for (const model of selected) for (const [id, steps] of Object.entries(cases)) {
    if (ids.length && !ids.includes(id)) continue;
    const result = await runConversation(steps, async history => {
      const messages = history.map(({ role, text }) => ({ role, parts: [{ type: 'text', text }] }));
      const response = await fetch(new URL('/api/chat', url), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages }), signal: AbortSignal.timeout(135000),
      });
      assert.ok(response.ok, 'Chat HTTP ' + response.status);
      const events = (await response.text()).split('\n').filter(line => line.startsWith('data: {'))
        .map(line => JSON.parse(line.slice(6)));
      const answer = events.some(e => e.type === 'finish')
        ? events.filter(e => e.type === 'text-delta').map(e => e.delta).join('') : '';
      return { answer, evidence: events, activity: events.filter(e => e.type === 'data-activity').map(e => e.data) };
    });
    const { status, seconds, turns } = result;
    report.cases.push({ model, id, ...result });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(model, id, status, seconds.toFixed(1) + 's', turns.filter(t => t.detail).map(t => t.detail).join('; '));
  }
  if (report.cases.some(c => c.status !== 'pass')) process.exitCode = 1;
}
