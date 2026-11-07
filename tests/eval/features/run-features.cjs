/* eslint-disable @typescript-eslint/no-require-imports -- standalone Playwright benchmark. */
// Features suite: model-driven cases that grow with each milestone (docs/BENCHMARK-PLAN.md). Same contract as the
// breadth suite: CHAT_URL, EVAL_MODEL, EVAL_REVISION, EVAL_ROUND and EVAL_REPORT in; a JSON report out; exit code 1 on
// any failure. `--list` prints the case ids so the matrix can check its expected count against them.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeFile } = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { featurePrompt } = require('./prompts.cjs');

const cases = [
  ['export-novel-app', 'export', async (page, spec, kit) => {
    const frame = await kit.preview(page, await kit.ask(page, spec.prompt));
    const [first, , third] = spec.items;
    const play = async target => {
      await kit.button(target, first).click();
      await kit.button(target, first).click();
      await kit.button(target, third).click();
      await kit.output(target, 3);
    };
    await play(frame);

    const card = page.locator('.html-artifact').last();
    await card.getByRole('button', { name: 'Full screen', exact: true }).click();
    await page.waitForFunction(() => document.fullscreenElement?.classList.contains('artifact-stage'));
    await kit.output(frame, 3);
    await page.getByRole('button', { name: 'Exit full screen', exact: true }).click();
    await page.waitForFunction(() => document.fullscreenElement === null);
    await kit.output(frame, 3);
    await kit.button(frame, spec.reset).click();
    await kit.output(frame, 0, 'every');

    const exported = await kit.openExport(page, card);
    await play(exported.page);
    await kit.button(exported.page, spec.reset).click();
    await kit.output(exported.page, 0, 'every');
    await exported.close();
  }],
  ['export-after-revision', 'export', async (page, spec, kit) => {
    const first = await kit.preview(page, await kit.ask(page, spec.prompt));
    await kit.button(first, spec.plus).click();
    await kit.output(first, spec.add);

    const original = page.locator('.html-artifact').last();
    await original.getByLabel('What should change?').fill(spec.revision);
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/chat', { timeout: 140000 });
    await original.getByRole('button', { name: 'Request revision', exact: true }).click();
    const revised = await kit.preview(page, await kit.read(await response));
    const v2 = async target => {
      await kit.button(target, spec.plus).click();
      await kit.button(target, spec.plus).click();
      await kit.button(target, spec.minus).click();
      await kit.output(target, 2 * spec.add - spec.take);
      await kit.button(target, 'Reset').click();
      await kit.output(target, 0);
    };
    await v2(revised);

    // v1 is still in the thread, unchanged: it keeps its state and has no new button.
    const v1 = page.frameLocator('.html-artifact iframe').first();
    await kit.output(v1, spec.add);
    assert.equal(await kit.button(v1, spec.minus).count(), 0, 'The first version did not change');

    const cards = page.locator('.html-artifact');
    const exportedV2 = await kit.openExport(page, cards.last());
    await v2(exportedV2.page);
    await exportedV2.close();
    const exportedV1 = await kit.openExport(page, cards.first());
    await kit.button(exportedV1.page, spec.plus).click();
    await kit.output(exportedV1.page, spec.add);
    assert.equal(await kit.button(exportedV1.page, spec.minus).count(), 0, 'The first export has no new button');
    await exportedV1.close();
  }],
];

if (process.argv.includes('--list')) {
  for (const [id] of cases) console.log(id);
  process.exit(0);
}

const { chromium } = require('playwright');
const url = process.env.CHAT_URL;
const model = process.env.EVAL_MODEL;
const round = Number(process.env.EVAL_ROUND || 1);
assert.ok(url && model, 'Set CHAT_URL and EVAL_MODEL');
const LOCAL = new Set(['127.0.0.1', 'localhost', '[::1]']);
const replies = new WeakMap();
const events = body => body.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));

function kitFor(browser, downloads) {
  const kit = {
    button: (target, name) => target.getByRole('button', { name, exact: true }),
    async read(response) {
      const ok = typeof response.ok === 'function' ? response.ok() : response.ok;
      assert.ok(ok, 'HTTP ' + (typeof response.status === 'function' ? response.status() : response.status));
      const chunks = events(await response.text());
      const text = chunks.filter(e => e.type === 'text-delta').map(e => e.delta).join('');
      assert.ok(chunks.some(e => e.type === 'finish') && text.trim(), 'No completed reply');
      return { text };
    },
    async ask(page, prompt) {
      const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/chat', { timeout: 140000 });
      const input = page.getByRole('textbox', { name: 'Message' });
      await input.fill(prompt);
      await input.press('Enter');
      return kit.read(await response);
    },
    async preview(page, reply) {
      replies.set(page, reply.text);
      assert.match(reply.text, /HtmlArtifact\(/, 'No preview: ' + reply.text.slice(0, 360));
      await page.getByRole('button', { name: 'Run preview', exact: true }).last().click();
      await page.locator('.html-artifact').last().getByText('Preview loaded. No runtime errors reported so far.').waitFor();
      return page.frameLocator('.html-artifact iframe').last();
    },
    /** Wait until some output (or every output) shows the number on its own, e.g. "Total: 3" but not "13". */
    async output(target, n, which = 'some') {
      const pattern = new RegExp('(?:^|[^0-9.])' + n + '(?:\\.0+)?(?:$|[^0-9.])');
      const outputs = target.locator('output');
      await outputs.filter({ hasText: pattern }).first().waitFor({ timeout: 5000 })
        .catch(async () => { throw new Error(`No output shows ${n}: ${JSON.stringify(await outputs.allInnerTexts().catch(() => []))}`); });
      if (which === 'every') for (const text of await outputs.allInnerTexts()) assert.match(text, pattern, `Every output shows ${n}`);
    },
    /** Download a card's source and open it in a fresh offline browser; nothing may leave the file. */
    async openExport(page, card) {
      const [file] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: 'Download source', exact: true }).click()]);
      const target = path.join(downloads, `${Date.now()}-${file.suggestedFilename()}`);
      await file.saveAs(target);
      const context = await browser.newContext();
      await context.setOffline(true);
      const problems = [];
      context.on('request', request => { if (!request.url().startsWith('file:')) problems.push('request ' + request.url()); });
      const exported = await context.newPage();
      exported.setDefaultTimeout(10000);
      exported.on('pageerror', error => problems.push(error.message));
      await exported.goto(pathToFileURL(target).href);
      return { page: exported, close: async () => { await context.close(); assert.deepEqual(problems, [], 'The export ran cleanly offline'); } };
    },
  };
  return kit;
}

(async () => {
  const selected = process.argv.slice(2);
  for (const id of selected) assert.ok(cases.some(c => c[0] === id), 'Unknown case: ' + id);
  const browser = await chromium.launch({ args: ['--use-mock-keychain', '--password-store=basic'] });
  const downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'rich-chat-features-'));
  const kit = kitFor(browser, downloads);
  const report = { model, appRevision: process.env.EVAL_REVISION, startedAt: new Date().toISOString(), cases: [] };
  try {
    for (const [id, category, run] of cases) {
      if (selected.length && !selected.includes(id)) continue;
      const spec = featurePrompt(id, round, model);
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await context.route('**/*', route => LOCAL.has(new URL(route.request().url()).hostname) || route.request().url().startsWith('blob:')
        ? route.fallback() : route.abort('internetdisconnected'));
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const start = performance.now();
      let status = 'pass', detail, observed;
      try {
        await page.goto(url);
        await run(page, spec, kit);
      } catch (e) {
        status = 'fail';
        detail = String(e.message).replace(/\x1b\[[0-9;]*m/g, '').slice(0, 450);
        const frame = page.frames().findLast(f => f.url() === 'about:srcdoc');
        if (frame) observed = await frame.evaluate(() => ({
          controls: Array.from(document.querySelectorAll('input,button,output')).slice(0, 20)
            .map(el => ({ tag: el.localName, text: (el.getAttribute('aria-label') || el.textContent).trim().slice(0, 80) })),
          visibleText: document.body?.innerText.slice(0, 320),
        })).catch(() => undefined);
      } finally {
        await context.close();
      }
      const seconds = (performance.now() - start) / 1000;
      // Synthetic prompts only: keep the prompt always and the reply on failure, for reproduction.
      const response = status === 'fail' ? replies.get(page)?.slice(0, 35000) : undefined;
      report.cases.push({ id, category, status, seconds, prompt: spec.prompt, ...(spec.revision ? { revision: spec.revision } : {}),
        ...(detail ? { detail } : {}), ...(observed ? { observed } : {}), ...(response ? { response } : {}) });
      console.log(status.toUpperCase(), id, seconds.toFixed(2) + 's', detail || '');
    }
  } finally {
    await browser.close();
    fs.rmSync(downloads, { recursive: true, force: true });
  }
  if (process.env.EVAL_REPORT) await writeFile(process.env.EVAL_REPORT, JSON.stringify(report, null, 2) + '\n');
  if (report.cases.some(c => c.status === 'fail')) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 2; });
