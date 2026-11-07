/* eslint-disable @typescript-eslint/no-require-imports -- optional Playwright is resolved via NODE_PATH for this standalone check. */
// M1 deterministic checks against a running chat (CHAT_URL), using the tested starters so no model is involved:
// full screen with the Fullscreen API, the full-window fallback on a phone, and the downloaded source working offline.
// Pattern: test-core recipe fullscreen-view (the same element is shown, state survives, focus returns).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const chatUrl = process.env.CHAT_URL;
assert.ok(chatUrl, 'Set CHAT_URL to a running Rich AI Chat');
const LOCAL = new Set(['127.0.0.1', 'localhost', '[::1]']);

async function openStarter(browser, contextOptions, prompt, title, initScript) {
  const context = await browser.newContext(contextOptions);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.protocol === 'file:' || LOCAL.has(url.hostname) ? route.fallback() : route.abort('internetdisconnected');
  });
  if (initScript) await context.addInitScript(initScript);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(chatUrl);
  const box = page.getByRole('textbox', { name: 'Message' });
  await box.fill(prompt);
  await box.press('Enter');
  await page.getByRole('button', { name: 'Run preview' }).click();
  const card = page.getByRole('region', { name: title });
  await card.getByText('Preview loaded. No runtime errors reported so far.').waitFor();
  return { context, page, card, errors, app: page.frameLocator(`iframe[title="${title}"]`) };
}

const checks = [];
async function check(name, body) {
  await body();
  checks.push(name);
  console.log('PASS: ' + name);
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-mock-keychain', '--password-store=basic'] });
  const downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'rich-chat-export-'));
  try {
    await check('Full screen keeps the app and its state, and Exit returns focus', async () => {
      const { context, page, card, app, errors } = await openStarter(browser, { viewport: { width: 1280, height: 800 } },
        'Make a playable two-player tic-tac-toe game.', 'Tic-tac-toe starter');
      await app.getByRole('button', { name: '1', exact: true }).click();
      await app.locator('#status').filter({ hasText: 'O’s turn' }).waitFor();
      const stage = card.locator('.artifact-stage');
      await stage.evaluate(element => { element.dataset.probe = 'same-node'; });
      const open = card.getByRole('button', { name: 'Full screen' });

      await open.click();

      await page.waitForFunction(() => document.fullscreenElement?.classList.contains('artifact-stage'));
      const exit = page.getByRole('button', { name: 'Exit full screen' });
      assert.equal(await exit.evaluate(element => element === document.activeElement), true, 'Exit is focused');
      await app.locator('#status').filter({ hasText: 'O’s turn' }).waitFor();
      await exit.click();
      await page.waitForFunction(() => document.fullscreenElement === null);
      assert.equal(await stage.getAttribute('data-probe'), 'same-node', 'The same stage came back');
      assert.equal(await app.locator('#status').textContent(), 'O’s turn', 'The game kept its state');
      assert.equal(await open.evaluate(element => element === document.activeElement), true, 'Focus returned to Full screen');
      assert.deepEqual(errors, []);
      await context.close();
    });

    await check('Without the Fullscreen API the app fills a phone screen, and Escape inside it leaves', async () => {
      const { context, page, card, app, errors } = await openStarter(browser,
        { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
        'Make a playable two-player tic-tac-toe game.', 'Tic-tac-toe starter',
        () => Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false }));
      await app.getByRole('button', { name: '5', exact: true }).tap();
      await app.locator('#status').filter({ hasText: 'O’s turn' }).waitFor();
      const stage = card.locator('.artifact-stage');
      const open = card.getByRole('button', { name: 'Full screen' });

      await open.tap();

      assert.equal(await stage.getAttribute('data-view'), 'full-window');
      assert.deepEqual(await stage.boundingBox(), { x: 0, y: 0, width: 390, height: 844 });
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflow), 'hidden', 'The chat behind stays still');
      const exit = page.getByRole('button', { name: 'Exit full screen' });
      assert.ok((await exit.boundingBox()).height >= 44, 'Exit is finger-sized');
      await app.getByRole('button', { name: '1', exact: true }).tap(); // focus is now inside the sandboxed app
      await app.locator('#status').filter({ hasText: 'X’s turn' }).waitFor();
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('.artifact-stage')?.dataset.view === 'inline');
      assert.equal(await app.locator('#status').textContent(), 'X’s turn', 'The game kept its state');
      assert.equal(await open.evaluate(element => element === document.activeElement), true, 'Focus returned to Full screen');
      assert.deepEqual(errors, []);
      await context.close();
    });

    async function download(card, page) {
      const [file] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: 'Download source' }).click()]);
      const target = path.join(downloads, file.suggestedFilename());
      await file.saveAs(target);
      await card.getByText(/^Saved .+\.html\. It is one HTML file that works offline\.$/).waitFor();
      return target;
    }

    async function openOffline(file) {
      const context = await browser.newContext();
      await context.setOffline(true);
      const requests = [];
      context.on('request', request => { if (!request.url().startsWith('file:')) requests.push(request.url()); });
      const page = await context.newPage();
      const problems = [];
      page.on('pageerror', error => problems.push(error.message));
      page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
      await page.goto(pathToFileURL(file).href);
      return { context, page, problems, requests };
    }

    await check('The downloaded app works on its own, offline', async () => {
      const { context, page, card } = await openStarter(browser, {}, 'Make a playable two-player tic-tac-toe game.', 'Tic-tac-toe starter');
      const file = await download(card, page);
      assert.match(path.basename(file), /^tic-tac-toe-starter-[0-9a-f]{8}\.html$/);
      const html = fs.readFileSync(file, 'utf8');
      assert.ok(!html.includes('rich-chat-preview'), 'No preview monitor in the export');
      await context.close();

      const exported = await openOffline(file);
      for (const cell of ['1', '4', '2', '5', '3']) await exported.page.getByRole('button', { name: cell, exact: true }).click();
      await exported.page.locator('#status').filter({ hasText: 'X wins' }).waitFor();
      await exported.page.getByRole('button', { name: 'Restart', exact: true }).click();
      await exported.page.getByRole('button', { name: '1', exact: true }).waitFor();
      assert.deepEqual(exported.problems, []);
      assert.deepEqual(exported.requests, []);
      await exported.context.close();
    });

    await check('A downloaded LittleJS game runs offline with its engine inlined', async () => {
      const { context, page, card } = await openStarter(browser, {}, 'Make an Angry Birds clone.', 'Slingshot Garden starter');
      const file = await download(card, page);
      const html = fs.readFileSync(file, 'utf8');
      assert.ok(html.includes('Frank Force') && html.includes('MIT License'), 'Engine licence travels with the game');
      await context.close();

      const exported = await openOffline(file);
      const canvas = exported.page.locator('canvas');
      await canvas.focus();
      await exported.page.keyboard.press('Space');
      await exported.page.locator('#score').filter({ hasText: /^[1-9]\d*$/ }).waitFor();
      assert.deepEqual(exported.problems, []);
      assert.deepEqual(exported.requests, []);
      await exported.context.close();
    });
  } finally {
    await browser.close();
    fs.rmSync(downloads, { recursive: true, force: true });
  }
  console.log(`PASS: ${checks.length} full-screen and export checks`);
})().catch(error => { console.error(error); process.exitCode = 1; });
