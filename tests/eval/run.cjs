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
  const events = parseEvents((await result.body()).toString("utf8"));
  assert.ok(events.some(e => e.type === 'finish'), 'No completed reply');
  const text = events.filter(e => e.type === 'text-delta').map(e => e.delta).join('');
  assert.ok(text.trim() && !/model (?:stopped before finishing|could not finish)/i.test(text), text.slice(0, 240) || 'Empty reply');
  return text;
}

const cases = [
  ['context', 'model', async () => {
    const first = part('user', 'Our class mascot is named Kumo. Acknowledge in one short sentence.');
    const a = await turn(first);
    const b = await turn(first, part('assistant', a.text), part('user', 'What is its name? Answer with just the name.'));
    assert.match(b.text, /\bKumo\b/i);
    assert.equal(a.calls.length + b.calls.length, 0, 'Class context must not need search');
  }],
  ['calculator', 'model', async () => {
    const { stdout } = await e2e('gpt-oss');
    return stdout.includes('APP_PATH: starter') ? { category: 'app', note: 'Tested calculator starter' } : undefined;
  }],
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
    const reply = await ask(page, 'Make a compact two-player tic-tac-toe game. Use a 3 by 3 grid of buttons labeled 1 to 9 in row-major order when empty. X goes first. Announce the winner as "X wins" or "O wins". Include a Restart button.');
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
    return reply.includes('HtmlArtifact("Tic-tac-toe starter"') ? { category: 'app', note: 'Tested tic-tac-toe starter' } : undefined;
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
  ['local-clock', 'app', async page => {
    const context = await page.context().browser().newContext({ timezoneId: 'Asia/Tokyo' });
    try {
      const localPage = await context.newPage();
      await localPage.goto(url);
      const text = await ask(localPage, "What's today's date?");
      const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format();
      assert.ok(text.includes(date), 'Expected today in the browser time zone');
      await localPage.getByText('Asia/Tokyo', { exact: true }).waitFor();
    } finally {
      await context.close();
    }
  }],
  ['named-zone-clock', 'model', async () => {
    const result = await turn(part('user', 'What time is it in New York right now?'));
    assert.equal(result.calls.length, 1);
    const [call] = result.calls;
    assert.equal(call.toolName, 'current_datetime');
    const output = result.events.find(e => e.type === 'tool-output-available' && e.toolCallId === call.toolCallId)?.output;
    assert.ok(['America/New_York', 'US/Eastern'].includes(output?.timeZone), 'Expected a valid New York time zone');
    assert.match(output.time, /^\d{2}:\d{2}:\d{2}$/);
  }],
  ['map-location', 'app', async page => {
    for (const [prompt, place, country, bounds] of [
      ['show me where is Mount Everest on the map', 'Mount Everest', 'Nepal', '86.88, 27.95, 86.97, 28.02'],
      ['show me Paris on the map', 'Paris', 'France', '2.22, 48.81, 2.47, 48.91'],
    ]) {
      const result = await turn(part('user', prompt));
      assert.equal(result.calls.length, 0, 'Map previews need no model or paid search');
      assert.ok(result.text.includes(`OpenStreetMap("${place}, ${country}", ${bounds})`));
      assert.ok(result.text.includes(`https://www.openstreetmap.org/search?${new URLSearchParams({ query: place })}`));
    }
    await page.route('https://www.openstreetmap.org/export/embed.html?*', route =>
      route.fulfill({ contentType: 'text/html', body: '<p>Map fixture loaded</p>' }));
    await ask(page, 'Show me Paris on the map');
    const frame = 'iframe[title="Map of Paris, France — OpenStreetMap"]';
    await page.frameLocator(frame).getByText('Map fixture loaded').waitFor({ state: 'visible' });
    assert.equal(new URL(await page.locator(frame).getAttribute('src')).searchParams.get('bbox'), '2.22,48.81,2.47,48.91');
    await page.getByRole('link', { name: 'Open in OpenStreetMap', exact: true }).waitFor({ state: 'visible' });
    await ask(page, 'where is tokyo?');
    const tokyo = 'iframe[title="Map of Tokyo, Japan — OpenStreetMap"]';
    await page.frameLocator(tokyo).getByText('Map fixture loaded').waitFor({ state: 'visible' });
    assert.equal(new URL(await page.locator(tokyo).getAttribute('src')).searchParams.get('bbox'), '139.56,35.52,139.92,35.82');
    const missing = await turn(part('user', 'Show me a map of Unknown Fixture Place'));
    assert.match(missing.text, /No map preview found/);
    assert.doesNotMatch(missing.text, /OpenStreetMap\(/);
  }],
  ['weekly-temperature-chart', 'app', async page => {
    const reply = await ask(page, 'Show me a chart of the temperature in Paris this coming week');
    assert.ok(reply.includes('LineChart(["2026-01-16","2026-01-17","2026-01-18","2026-01-19","2026-01-20","2026-01-21","2026-01-22"]'));
    assert.ok(reply.includes('Series("Low (°C)", [-2,-1,0,2,3,1,4])'), reply);
    assert.ok(reply.includes('Series("High (°C)", [4,5,6,9,11,7,12])'), reply);
    await page.locator('svg[role="img"]').waitFor({ state: 'visible' });
    await page.getByRole('link', { name: 'Forecast data: Open-Meteo' }).waitFor({ state: 'visible' });
  }],
  ['model-numeric-chart', 'model', async page => {
    const reply = await ask(page, 'Plot a line chart of the aquarium temperature readings. Label the points Dawn, Noon, and Dusk, in that order. The readings were 18.5, 24, and 20.25 degrees Celsius, respectively.');
    assert.match(reply, /LineChart\(/);
    assert.match(reply, /\[\s*"Dawn"\s*,\s*"Noon"\s*,\s*"Dusk"\s*\]/);
    assert.match(reply, /\[\s*18\.5\s*,\s*24(?:\.0+)?\s*,\s*20\.25\s*\]/);
    await page.locator('svg[role="img"]').waitFor({ state: 'visible' });
  }],
  ['online-pictures', 'app-live', async page => {
    const reply = await ask(page, 'Show me pictures of Mount Fuji');
    assert.match(reply, /ImageGallery\(/, 'Missing image gallery');
    const image = page.locator('img[src^="https://imgs.search.brave.com/"]').first();
    await image.waitFor();
    await image.evaluate(node => node.decode());
    await page.getByRole('link', { name: 'Source 1', exact: true }).waitFor();
  }],
  ['online-videos', 'app-live', async page => {
    const reply = await ask(page, 'show video of shibuya');
    assert.match(reply, /Shibuya/i, 'Expected a Shibuya video result');
    const link = page.getByRole('link', { name: 'Watch video', exact: true }).first();
    await link.waitFor();
    assert.match(await link.getAttribute('href'), /^https:\/\//);
    const image = page.locator('img[src^="https://imgs.search.brave.com/"]').first();
    await image.waitFor();
    await image.evaluate(node => node.decode());
  }],
  ['uncertain-fact-search', 'model-live', async () => {
    const result = await turn(part('user', 'What is the IAU observatory code of Kiso Observatory, and in what year did its 105 cm Schmidt telescope begin observations?'));
    assert.equal(result.calls.length, 1, 'Expected the model to look up the obscure fact');
    const [call] = result.calls;
    assert.equal(call.toolName, 'web_search');
    assert.match(call.input.query, /Kiso/i);
    const output = result.events.find(e => e.type === 'tool-output-available' && e.toolCallId === call.toolCallId)?.output;
    assert.ok(output, 'Missing search tool result');
    const sources = output.untrustedSources ?? [];
    if (!sources.length) return { skip: output.error || 'Provider returned no sources' };
    assert.ok(sources.some(source => result.text.includes(source.url)), 'Reply did not cite a returned source');
    assert.doesNotMatch(result.text, /couldn’t finish the answer/, 'The model retrieved sources but did not answer');
  }],
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
    return result.events.some(event => event.type === 'text-delta' && event.id === 'search-sources')
      ? { note: 'Model called search; app displayed returned source links' } : undefined;
  }],
];

(async () => {
  const selected = process.argv.slice(2);
  for (const id of selected) assert.ok(cases.some(([name]) => name === id), 'Unknown case: ' + id);
  const browser = await chromium.launch();
  const report = { model, appRevision: process.env.EVAL_REVISION, startedAt: new Date().toISOString(), cases: [] };
  try {
    for (const [id, category, run] of cases) {
      if (selected.length && !selected.includes(id)) continue;
      const page = await browser.newPage();
      page.setDefaultTimeout(10000);
      const start = Date.now();
      let status = 'pass', detail, pathCategory = category;
      try {
        await page.goto(url);
        const result = await run(page);
        if (result?.category) pathCategory = result.category;
        if (result?.note) detail = result.note;
        if (result?.skip) { status = 'skip'; detail = result.skip; }
      } catch (error) {
        status = 'fail';
        detail = error.message.replace(/\x1b\[[0-9;]*m/g, '').split('\n').slice(0, 3).join(' ').slice(0, 300);
      } finally {
        await page.close();
      }
      const seconds = (Date.now() - start) / 1000;
      report.cases.push({ id, category: pathCategory, status, seconds, ...(detail ? { detail } : {}) });
      console.log(`${status.toUpperCase()} ${id} (${seconds.toFixed(1)}s)${detail ? ': ' + detail : ''}`);
    }
  } finally {
    await browser.close();
  }
  if (process.env.EVAL_REPORT) await writeFile(process.env.EVAL_REPORT, JSON.stringify(report, null, 2) + '\n');
  if (report.cases.some(result => result.status === 'fail')) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
