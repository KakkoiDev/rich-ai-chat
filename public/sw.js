// Kakkoi Chat's shell worker: it keeps the chat's page and its own static files, so the app opens without a
// connection and can say why the host is unreachable. It never touches /api/*: replies, uploads, dictation and the
// connection check always go to the host, and nothing a person asked or received is cached here.
const CACHE = 'kakkoi-chat-shell-v1';
const SHELL = '/';
const ALWAYS = ['/manifest.webmanifest', '/icons/kakkoi-icon-32.png', '/icons/kakkoi-icon-180.png',
  '/icons/kakkoi-icon-192.png', '/icons/kakkoi-icon-512.png'];
const STATIC = /\/_next\/static\/[^"'\\\s)<>]+/g;

/** The page's own build files, named in its HTML and in its style sheets (fonts). */
async function referencedFiles(cache, html) {
  const files = new Set(html.match(STATIC) ?? []);
  for (const sheet of [...files].filter(file => file.endsWith('.css'))) {
    const response = (await cache.match(sheet)) ?? await fetch(sheet).catch(() => undefined);
    if (response?.ok) for (const file of (await response.text()).match(STATIC) ?? []) files.add(file);
  }
  return [...files];
}

/** Store a fresh copy of the page and the build files it needs; drop build files the new page no longer uses. */
async function keepShell(response) {
  const cache = await caches.open(CACHE);
  const files = await referencedFiles(cache, await response.clone().text());
  const missing = [];
  for (const file of files) if (!(await cache.match(file))) missing.push(file);
  await cache.addAll(missing);
  await cache.put(SHELL, response);
  const keep = new Set(files);
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/_next/static/') && !keep.has(path)) await cache.delete(request);
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const page = await fetch(SHELL, { cache: 'no-store' });
    if (!page.ok) throw new Error('The chat page did not load');
    await keepShell(page);
    await (await caches.open(CACHE)).addAll(ALWAYS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('kakkoi-chat-shell-') && name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    // The page itself: the host's copy when it answers, else the kept shell (which then shows why it can't connect).
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok && url.pathname === SHELL && !url.search) event.waitUntil(keepShell(response.clone()).catch(() => {}));
        return response;
      } catch {
        return (await caches.match(SHELL)) ?? Response.error();
      }
    })());
    return;
  }

  if (url.pathname.startsWith('/_next/static/') || ALWAYS.includes(url.pathname)) {
    // Build files never change under one name: the kept copy first.
    event.respondWith((async () => {
      const kept = await caches.match(request, { ignoreSearch: true });
      if (kept) return kept;
      const response = await fetch(request);
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)));
      }
      return response;
    })());
  }
});
