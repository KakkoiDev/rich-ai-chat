/* eslint-disable @typescript-eslint/no-require-imports -- optional Playwright is resolved via NODE_PATH for this standalone check. */
// M6 deterministic checks: "Install as app" writes a generated app into the exports folder, a throwaway Caddy serves
// it with deploy/caddy/exports.caddy on a second origin, and full Chromium finds it installable and working offline,
// with no way into the chat's storage. Starters only, so no model is involved. It starts the chat and Caddy itself:
//   RICH_CHAT_BUILD_DIR=.next-local/<build> node tests/e2e/export-install.cjs   (Playwright via NODE_PATH; Caddy via
//   RICH_CHAT_CADDY, PATH, or the host's copy)
// Pattern: test-core recipe pwa-offline (test-core/pwa/pwa.mjs).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { repo, pwa, freePort, startChat, startExportOrigin, launchProfile, get, scratchFolder, check, checks } = require('./pwa-support.cjs');

const STARTER = 'Make a playable two-player tic-tac-toe game.';
const TITLE = 'Tic-tac-toe starter';

async function openStarter(context, chatURL) {
  const page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(chatURL);
  const box = page.getByRole('textbox', { name: 'Message' });
  await box.fill(STARTER);
  await box.press('Enter');
  const card = page.getByRole('region', { name: TITLE });
  await card.getByRole('button', { name: 'Install as app' }).waitFor();
  return { page, card };
}

(async () => {
  const { cacheContents, installability, reloadOffline, serviceWorkerControl } = await pwa();
  const scratch = scratchFolder('export-install');
  const exportsDir = path.join(scratch, 'Rich AI Chat', 'exports'); // a space in the path, like the real default
  const [chatPort, exportPort] = [await freePort(), await freePort()];
  let chat;
  let origin;
  let context;
  try {
    await check('Without an export origin, Install as app says it is not set up and writes nothing', async () => {
      chat = await startChat({ port: chatPort, env: { RICH_CHAT_EXPORTS_DIR: exportsDir, RICH_CHAT_EXPORT_ORIGIN: '' } });
      context = await launchProfile(scratch);
      const { card } = await openStarter(context, chat.url);

      await card.getByRole('button', { name: 'Install as app' }).click();

      await card.getByText(/Install as app isn't set up on this server: the owner sets RICH_CHAT_EXPORT_ORIGIN/).waitFor();
      assert.equal(fs.existsSync(exportsDir), false, 'Nothing was written');
      await context.close();
      await chat.stop();
    });

    chat = await startChat({ port: chatPort, env: { RICH_CHAT_EXPORTS_DIR: exportsDir, RICH_CHAT_EXPORT_ORIGIN: `http://127.0.0.1:${exportPort}/` } });
    origin = await startExportOrigin({ port: exportPort, exportsDir, scratch });
    context = await launchProfile(scratch);
    let appURL;
    let id;

    await check('Install as app writes the app folder and shows its address on the export origin', async () => {
      const { card } = await openStarter(context, chat.url);

      await card.getByRole('button', { name: 'Install as app' }).click();

      const link = card.getByRole('link', { name: new RegExp(`^${origin.url}/apps/`) });
      await link.waitFor();
      appURL = await link.getAttribute('href');
      id = /\/apps\/([a-z0-9-]+)\/$/.exec(appURL)?.[1];
      assert.match(id ?? '', /^tic-tac-toe-starter-[0-9a-f]{12}$/);
      assert.equal(await card.getByText('Needs connection').count(), 0, 'A self-contained game is not flagged');
      const folder = path.join(exportsDir, 'apps', id);
      assert.deepEqual(fs.readdirSync(folder).sort(), ['icons', 'index.html', 'manifest.webmanifest', 'sw.js']);
      assert.deepEqual(fs.readdirSync(path.join(folder, 'icons')).sort(),
        ['icon-180.png', 'icon-192.png', 'icon-32.png', 'icon-512.png', 'icon-maskable-192.png', 'icon-maskable-512.png']);
      assert.ok(fs.readFileSync(path.join(folder, 'icons/icon-512.png')).equals(fs.readFileSync(path.join(repo, 'public/icons/kakkoi-icon-512.png'))),
        "visual-core's pinned icon");
      const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.webmanifest'), 'utf8'));
      assert.deepEqual([manifest.id, manifest.name, manifest.scope, manifest.display], [`/apps/${id}/`, TITLE, './', 'standalone']);
      assert.ok(!fs.readFileSync(path.join(folder, 'index.html'), 'utf8').includes('rich-chat-preview'), 'No preview monitor');
    });

    await check('The export origin serves only app folders, with a strict policy, no cookies and a narrow worker scope', async () => {
      const page = await get(appURL, { Cookie: 'chat=should-not-matter' });
      assert.equal(page.status, 200);
      assert.match(page.headers['content-security-policy'], /^default-src 'none'; .*connect-src 'self'.*frame-ancestors 'none'/);
      assert.equal(page.headers['set-cookie'], undefined);
      assert.equal(page.headers['x-content-type-options'], 'nosniff');
      const worker = await get(`${appURL}sw.js`);
      assert.equal(worker.headers['service-worker-allowed'], `/apps/${id}/`);
      assert.match((await get(`${appURL}manifest.webmanifest`)).headers['content-type'], /^application\/manifest\+json/);
      const root = await get(`${origin.url}/`);
      assert.equal(root.status, 404, 'No listing of the folder');
      assert.equal(root.headers['content-security-policy'], page.headers['content-security-policy'], 'The policy is on every answer');
      assert.equal((await get(`${origin.url}/apps/`)).status, 404);
      fs.mkdirSync(path.join(exportsDir, 'apps', '.incoming-probe'));
      fs.writeFileSync(path.join(exportsDir, 'apps', '.incoming-probe', 'index.html'), 'half written');
      assert.equal((await get(`${origin.url}/apps/.incoming-probe/index.html`)).status, 404, 'Folders being written stay hidden');
      const chatPage = await get(`${chat.url}/`);
      assert.equal(chatPage.headers['set-cookie'], undefined, 'The chat sets no cookie an app could read on the same host');
    });

    let app;
    await check('Chromium reports the exported app installable, and its worker caches exactly its own folder', async () => {
      app = await context.newPage();
      app.setDefaultTimeout(20000);
      await app.goto(appURL);

      const registration = await serviceWorkerControl(app);
      const verdict = await installability(app);

      assert.deepEqual(registration, { scope: appURL, scriptURL: `${appURL}sw.js` });
      assert.deepEqual(verdict, { errors: [], manifestURL: `${appURL}manifest.webmanifest`, manifestErrors: [] });
      const cached = await cacheContents(app);
      const folder = `/apps/${id}/`;
      assert.deepEqual(cached[`app-${id}`], [folder, ...['icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-32.png', 'icons/icon-512.png',
        'icons/icon-maskable-192.png', 'icons/icon-maskable-512.png', 'index.html', 'manifest.webmanifest'].map(file => folder + file)]);
    });

    await check('An offline reload of the installed app is served by its worker and the game still plays', async () => {
      const reload = await reloadOffline(app);

      assert.deepEqual(reload, { status: 200, fromServiceWorker: true });
      for (const cell of ['1', '4', '2', '5', '3']) await app.getByRole('button', { name: cell, exact: true }).click();
      await app.locator('#status').filter({ hasText: 'X wins' }).waitFor();
      await context.setOffline(false);
    });

    await check("The export origin cannot reach the chat origin's storage, caches or server", async () => {
      const chatPage = context.pages()[0];
      await chatPage.evaluate(async () => {
        localStorage.setItem('probe-secret', 'chat-only');
        sessionStorage.setItem('probe-secret', 'chat-only');
        await (await caches.open('probe-chat-cache')).put('/probe', new Response('chat-only'));
      });

      const seen = await app.evaluate(async chatURL => ({
        local: localStorage.getItem('probe-secret'),
        session: sessionStorage.getItem('probe-secret'),
        cookie: document.cookie,
        caches: await caches.keys(),
        chatChats: Object.keys(localStorage).filter(key => key.startsWith('rich-ai-chat')),
        fetchChat: await fetch(`${chatURL}/api/health`).then(() => 'reached', () => 'blocked'),
        widerScope: await navigator.serviceWorker.register('sw.js', { scope: '/' }).then(() => 'registered', error => error.name),
      }), chat.url);

      assert.deepEqual(seen, { local: null, session: null, cookie: '', caches: [`app-${id}`], chatChats: [], fetchChat: 'blocked', widerScope: 'SecurityError' });
      assert.ok((await chatPage.evaluate(() => Object.keys(localStorage))).some(key => key.startsWith('rich-ai-chat')), 'The chat does have stored chats');
    });

    await check('An app that uses the network is flagged "needs connection" at export time', async () => {
      const chatPage = context.pages()[0];
      const document = '<html><body><button id="b">Load</button><output id="o"></output><script>b.onclick = async () => '
        + "{ o.textContent = await (await fetch('https://api.example.org/quote')).text(); };</script></body></html>";
      const answer = await chatPage.evaluate(async source => {
        const response = await fetch('/api/exports', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Quote of the day', document: source }) });
        return response.json();
      }, document);
      assert.equal(answer.needsConnection, true);
      assert.deepEqual(answer.network, ['fetch', 'api.example.org']);
      const manifest = JSON.parse(fs.readFileSync(path.join(exportsDir, 'apps', answer.id, 'manifest.webmanifest'), 'utf8'));
      assert.match(manifest.description, /^Made in Kakkoi Chat\. Needs connection: it uses fetch, api\.example\.org/);

      // The card shows the label from that answer.
      const { card, page } = await openStarter(context, chat.url);
      await page.route('**/api/exports', route => route.fulfill({ json: answer }));
      await card.getByRole('button', { name: 'Install as app' }).click();
      await card.getByText('Needs connection').waitFor();
      await card.getByText('It uses fetch, api.example.org.').waitFor();
      await page.unroute('**/api/exports');
    });

    await check('The same app installs to the same folder; a request from another site is refused', async () => {
      const chatPage = context.pages()[0];
      const before = fs.readdirSync(path.join(exportsDir, 'apps')).filter(name => !name.startsWith('.')).sort();
      const { card } = await openStarter(context, chat.url);
      await card.getByRole('button', { name: 'Install as app' }).click();
      await card.getByRole('link', { name: appURL }).waitFor();
      assert.deepEqual(fs.readdirSync(path.join(exportsDir, 'apps')).filter(name => !name.startsWith('.')).sort(), before);
      const status = await chatPage.evaluate(async url => (await fetch(url, { method: 'POST', body: '{}' })).status, `${chat.url}/api/exports`);
      assert.equal(status, 400, 'Same-origin but empty: a bad request');
      const crossSite = await fetch(`${chat.url}/api/exports`, { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' }, body: '{}' });
      assert.equal(crossSite.status, 403);
    });
  } finally {
    await context?.close().catch(() => {});
    await origin?.stop();
    await chat?.stop();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  console.log(`PASS: ${checks.length} installable app checks`);
})().catch(error => { console.error(error); process.exitCode = 1; });
