/* eslint-disable @typescript-eslint/no-require-imports -- optional Playwright is resolved via NODE_PATH for this standalone check. */
// M7 deterministic checks: the chat as an installable app. Full Chromium finds it installable, its shell worker keeps
// the page and build files but never /api/*, an offline reload shows the shell and says why it can't connect, a
// stopped host shows the unreachable state, and a reply that failed while the host was down is sent again after
// Retry. A stub model answers, so no real model runs. It starts the stub and the built chat itself:
//   RICH_CHAT_BUILD_DIR=.next-local/<build> node tests/e2e/chat-pwa.cjs   (Playwright via NODE_PATH)
// Pattern: test-core recipe pwa-offline (test-core/pwa/pwa.mjs).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { pwa, freePort, startStubModel, startChat, launchProfile, scratchFolder, check, checks } = require('./pwa-support.cjs');

(async () => {
  const { cacheContents, installability, reloadOffline, serviceWorkerControl } = await pwa();
  const scratch = scratchFolder('chat-pwa');
  const model = await startStubModel();
  const port = await freePort();
  const start = () => startChat({ port, modelURL: model.url });
  let chat = await start();
  const context = await launchProfile(scratch);
  const page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(20000);
  const box = page.getByRole('textbox', { name: 'Message' });
  const status = page.locator('.connection-status');
  const ask = async text => { await box.fill(text); await box.press('Enter'); };
  try {
    await check('The chat is installable as Kakkoi Chat, and its shell worker controls the whole site', async () => {
      await page.goto(chat.url);

      const registration = await serviceWorkerControl(page);
      const verdict = await installability(page);

      assert.deepEqual(registration, { scope: `${chat.url}/`, scriptURL: `${chat.url}/sw.js` });
      assert.deepEqual(verdict, { errors: [], manifestURL: `${chat.url}/manifest.webmanifest`, manifestErrors: [] });
      const manifest = await (await fetch(`${chat.url}/manifest.webmanifest`)).json();
      assert.deepEqual([manifest.name, manifest.short_name, manifest.display, manifest.start_url], ['Kakkoi Chat', 'Kakkoi Chat', 'standalone', '/']);
    });

    await check('A reply streams as usual, and the worker keeps the shell but nothing from /api/*', async () => {
      await ask('Say hello to Alpha');
      await page.getByText('Stub reply to Alpha.').waitFor();

      const cached = await cacheContents(page);

      assert.deepEqual(Object.keys(cached), ['kakkoi-chat-shell-v1']);
      const paths = cached['kakkoi-chat-shell-v1'];
      assert.ok(paths.includes('/') && paths.includes('/manifest.webmanifest') && paths.includes('/icons/kakkoi-icon-192.png'));
      assert.ok(paths.some(entry => entry.startsWith('/_next/static/') && entry.endsWith('.js')), 'Build scripts are kept');
      assert.deepEqual(paths.filter(entry => !entry.startsWith('/_next/static/') && !entry.startsWith('/icons/')), ['/', '/manifest.webmanifest']);
      assert.ok(!paths.some(entry => entry.startsWith('/api/')), 'Nothing from /api/* is cached');
    });

    await check('An offline reload shows the shell and says the device is offline, with Retry; back online it clears', async () => {
      const reload = await reloadOffline(page);

      assert.deepEqual(reload, { status: 200, fromServiceWorker: true });
      await box.waitFor();
      await status.getByText("You're offline").waitFor();
      assert.ok(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('rich-ai-chat:messages:'))),
        'The earlier chat is still on this device');
      await status.getByRole('button', { name: 'Retry' }).click(); // still offline: it says so again
      await status.getByRole('button', { name: 'Retry' }).waitFor();
      await status.getByText("You're offline").waitFor();
      await context.setOffline(false); // the browser's "online" event checks again on its own
      await status.waitFor({ state: 'detached' });
    });

    await check('With the host stopped, a reload shows the shell and says the host is not answering, with Retry', async () => {
      await chat.stop();

      const response = await page.reload();

      assert.equal(response.fromServiceWorker(), true);
      await box.waitFor();
      await status.getByText("The chat's host isn't answering").waitFor();
      await status.getByRole('button', { name: 'Retry' }).waitFor();
    });

    await check('A reply asked while the host was down is sent again after it comes back and Retry is pressed', async () => {
      await ask('Say hello to Bravo');
      await status.getByText("The chat's host isn't answering").waitFor();
      chat = await start();

      await status.getByRole('button', { name: 'Retry' }).click();

      await page.getByText('Stub reply to Bravo.').waitFor();
      await status.waitFor({ state: 'detached' });
      const asked = page.locator('.openui-shell-thread-message-user__content').filter({ hasText: 'Say hello to Bravo' });
      assert.equal(await asked.count(), 1, 'The question shows once in the thread');
      assert.ok(!Object.values(await cacheContents(page)).flat().some(entry => entry.startsWith('/api/')), 'Still nothing from /api/*');
    });
  } finally {
    await context.close().catch(() => {});
    await chat.stop().catch(() => {});
    await model.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  console.log(`PASS: ${checks.length} chat app checks`);
})().catch(error => { console.error(error); process.exitCode = 1; });
