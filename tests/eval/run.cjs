/* eslint-disable @typescript-eslint/no-require-imports -- Node and optional Playwright runner. */
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { promisify } = require('node:util');
const { chromium } = require('playwright');

const url = process.env.CHAT_URL;
const model = process.env.EVAL_MODEL;
assert.ok(url && model, 'Set CHAT_URL and EVAL_MODEL (the model configured on that server)');
const part = (role, text) => ({ role, parts: [{ type: 'text', text }] });
const parseEvents = body => body.split('\n')
  .filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));

async function turn(...messages) {
  const response = await fetch(new URL('/api/chat', url), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }), signal: AbortSignal.timeout(170000),
  });
  assert.ok(response.ok, 'HTTP ' + response.status);
  const events = parseEvents(await response.text());
  const text = events.filter(e => e.type === 'text-delta').map(e => e.delta).join('');
  assert.ok(events.some(e => e.type === 'finish'), 'No completed reply');
  assert.ok(text.trim() && !/model (?:stopped before finishing|could not finish)/i.test(text), 'Empty reply or recovery notice');
  return { text, calls: events.filter(e => e.type === 'tool-input-available'), events };
}

const e2e = name => promisify(execFile)(process.execPath, [join(__dirname, '../e2e', name + '.cjs')], {
  timeout: 175000,
}).catch(e => { throw new Error(e.stderr?.trim() || e.message); });

async function ask(page, prompt) {
  const box = page.getByRole('textbox').first();
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/chat', { timeout: 150000 });
  await box.fill(prompt);
  await box.press('Enter');
  const result = await response;
  assert.ok(result.ok(), 'Chat request failed: ' + result.status());
  const events = parseEvents(await result.text());
  assert.ok(events.some(e => e.type === 'finish'), 'No completed reply');
  const text = events.filter(e => e.type === 'text-delta').map(e => e.delta).join('');
  assert.ok(text.trim() && !/model (?:stopped before finishing|could not finish)/i.test(text), text.slice(0, 240) || 'Empty reply');
}

const cases = [
  ['context', 'model', async () => {
    const first = part('user', 'Our class mascot is named Kumo. Acknowledge in one short sentence.');
    const a = await turn(first);
    const b = await turn(first, part('assistant', a.text), part('user', 'What is its name? Answer with just the name.'));
    assert.match(b.text, /\bKumo\b/i);
    assert.equal(a.calls.length + b.calls.length, 0, 'Class context must not need search');
  }],
  ['calculator', 'model', () => e2e('gpt-oss')],
  ['repair', 'model', () => e2e('gpt-oss-repair')],
  ['native-pie', 'model', async page => {
    await ask(page, 'Show a native pie chart with exactly three slices: Apples 50, Bananas 30, Cherries 20.');
    const palette = ['#2563eb', '#d97706', '#0f766e', '#be185d', '#7c3aed', '#b91c1c', '#4d7c0f', '#475569'];
    for (const value of [50, 30, 20]) await page.getByText(new RegExp('^' + value + '(?:\\.0+)?%$')).first().waitFor();
    const fills = await page.locator('svg path[fill]').evaluateAll(nodes => nodes.map(n => n.getAttribute('fill')));
    assert.equal(new Set(fills.filter(color => palette.includes(color))).size, 3, 'Expected three distinct slice colors');
    assert.equal(await page.getByRole('button', { name: 'Run preview' }).count(), 0);
  }],
  ['classroom-image', 'model', async page => {
    await ask(page, 'Show the bundled classroom water cycle illustration.');
    const image = page.locator('img[src="/water-cycle.svg"], img[src*="url=%2Fwater-cycle.svg"]').first();
    await image.waitFor();
    await image.evaluate(node => node.decode());
  }],
  ['tic-tac-toe', 'model', async page => {
    await ask(page, 'Make a compact two-player tic-tac-toe game. Use a 3 by 3 grid of buttons labeled 1 to 9 in row-major order when empty. X goes first. Announce the winner as "X wins" or "O wins". Include a Restart button.');
    await page.getByRole('button', { name: 'Run preview' }).click();
    const frame = page.frameLocator('.html-artifact iframe');
    for (const name of ['1', '4', '2', '5', '3']) {
      await frame.getByRole('button', { name, exact: true }).click();
    }
    await frame.getByText(/X wins/i).first().waitFor();
    await frame.getByRole('button', { name: 'Restart', exact: true }).click();
    for (const name of ['1', '4', '2', '5', '3']) {
      await frame.getByRole('button', { name, exact: true }).waitFor();
    }
  }],
  ['table-to-chart', 'app', async page => {
    const table = '| Day | High (°F) | Rain (%) |\n| --- | --- | --- |\n| Mon | 67 | 20 |\n| Tue | 70 | 15 |';
    await page.route('**/api/chat', route => route.fetch({ postData: {
      messages: [part('assistant', table), part('user', 'Do the chart again')],
    } }).then(response => route.fulfill({ response })));
    await ask(page, 'Do the chart again');
    await page.getByText('Chart from the previous table', { exact: true }).waitFor();
    assert.equal(await page.locator('svg[role="img"]').count(), 2, 'Different units need separate charts');
  }],
  ['slingshot', 'app', () => e2e('slingshot')],
  ['weather-search', 'live', async () => {
    const result = await turn(part('user', 'Search the web for current weather in Tokyo. Include a source link, or say if the search did not return usable data.'));
    assert.equal(result.calls.length, 1, 'Expected exactly one search');
    const [call] = result.calls;
    assert.equal(call.toolName, 'web_search');
    assert.match(call.input.query, /Tokyo/i);
    const output = result.events.find(e => e.type === 'tool-output-available' && e.toolCallId === call.toolCallId)?.output;
    assert.ok(output, 'Missing search tool result');
    const sources = output.untrustedSources || [];
    if (!sources.length) return { skip: output.error || 'Provider returned no sources' };
    assert.ok(sources.some(source => result.text.includes(source.url)), 'Reply did not cite a returned source');
  }],
];

(async () => {
  const selected = process.argv.slice(2);
  for (const id of selected) assert.ok(cases.some(([name]) => name === id), 'Unknown case: ' + id);
  const browser = await chromium.launch();
  const report = { model, startedAt: new Date().toISOString(), cases: [] };
  try {
    for (const [id, category, run] of cases) {
      if (selected.length && !selected.includes(id)) continue;
      const page = await browser.newPage();
      page.setDefaultTimeout(10000);
      const start = Date.now();
      let status = 'pass', detail;
      try {
        await page.goto(url);
        const result = await run(page);
        if (result?.skip) { status = 'skip'; detail = result.skip; }
      } catch (error) {
        status = 'fail';
        detail = error.message.replace(/\x1b\[[0-9;]*m/g, '').split('\n').slice(0, 3).join(' ').slice(0, 300);
      } finally {
        await page.close();
      }
      const seconds = (Date.now() - start) / 1000;
      report.cases.push({ id, category, status, seconds, ...(detail ? { detail } : {}) });
      console.log(`${status.toUpperCase()} ${id} (${seconds.toFixed(1)}s)${detail ? ': ' + detail : ''}`);
    }
  } finally {
    await browser.close();
  }
  if (process.env.EVAL_REPORT) await writeFile(process.env.EVAL_REPORT, JSON.stringify(report, null, 2) + '\n');
  if (report.cases.some(result => result.status === 'fail')) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
