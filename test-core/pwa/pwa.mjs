// Checks for an installable web app (PWA) in Chromium through Playwright: the service worker took control, what it
// cached, a reload with the network cut, and Chromium's own installability verdict. Every function takes a Playwright
// Page and waits for a state, never for time. Recipe pwa-offline shows them in use; adopted repositories get this file
// pinned (test-core/pwa/pwa.mjs). The Python twin is pwa/pwa.py.

/**
 * Wait until a service worker controls the page. A worker that does not claim open pages controls them only from the
 * next load, so the page is reloaded once in that case. Returns { scope, scriptURL } of the active registration.
 */
export async function serviceWorkerControl(page) {
  const registration = await page.evaluate(async () => {
    const ready = await navigator.serviceWorker.ready;
    return { scope: ready.scope, scriptURL: ready.active?.scriptURL ?? '' };
  });
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  return registration;
}

/**
 * Everything in CacheStorage for the page's origin: { cacheName: [path, ...] }, paths sorted, same-origin entries as
 * path + query, others as full URLs. CacheStorage is per origin, so this includes other apps' caches on that origin.
 */
export function cacheContents(page) {
  return page.evaluate(async () => {
    const contents = {};
    for (const name of await caches.keys()) {
      const requests = await (await caches.open(name)).keys();
      contents[name] = requests.map((request) => {
        const url = new URL(request.url);
        return url.origin === location.origin ? url.pathname + url.search : url.href;
      }).sort();
    }
    return contents;
  });
}

/**
 * Cut the browser's connection and reload. Returns { status, fromServiceWorker }. The connection stays cut so the
 * test can go on using the page offline; `await page.context().setOffline(false)` brings it back.
 */
export async function reloadOffline(page) {
  await page.context().setOffline(true);
  const response = await page.reload();
  return { status: response?.status() ?? 0, fromServiceWorker: response?.fromServiceWorker() ?? false };
}

/**
 * Chromium's installability verdict (the checks behind its Install menu item), through the DevTools protocol:
 * { errors: [errorId, ...], manifestURL, manifestErrors: [message, ...] }. An empty `errors` means installable.
 * It needs full Chromium (launch with channel: 'chromium'): the headless shell answers every page with no errors, so
 * this throws there instead of passing. And use a persistent context (browserType.launchPersistentContext): full
 * Chromium adds "in-incognito" in a fresh one.
 */
export async function installability(page) {
  const session = await page.context().newCDPSession(page);
  try {
    const { product } = await session.send('Browser.getVersion');
    if (product.startsWith('HeadlessChrome/')) {
      throw new Error("Chromium's headless shell reports every page installable; launch full Chromium with channel: 'chromium'.");
    }
    const { installabilityErrors } = await session.send('Page.getInstallabilityErrors');
    const manifest = await session.send('Page.getAppManifest');
    return {
      errors: installabilityErrors.map((error) => error.errorId),
      manifestURL: manifest.url,
      manifestErrors: manifest.errors.map((error) => error.message),
    };
  } finally {
    await session.detach();
  }
}
