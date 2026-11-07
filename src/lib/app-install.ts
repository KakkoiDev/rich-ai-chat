/**
 * "Install as app": a generated app becomes a small installable web app (PWA) in its own folder, /apps/<id>/, on the
 * export origin, which is a different origin from the chat (deploy/caddy/exports.caddy). The folder holds the exported
 * page, a manifest with its own id and scope, the Kakkoi icons and a cache-first offline worker scoped to the folder.
 * Everything here is pure; app-install-store.ts writes the folder and the route (api/exports) puts them together.
 */

/** Matches every id this module makes; the Caddy site serves only folders that match it. */
export const installedAppIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** "Tip calculator" + digest -> "tip-calculator-1a2b3c4d5e6f". ASCII only, so the id is the same in every URL form. */
export function installedAppId(title: string, digest: string) {
  const slug = title.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/, "");
  return `${slug || "app"}-${digest.slice(0, 12)}`;
}

/** A home-screen label of at most 12 characters, cut at a word where one is close. */
export function installedAppShortName(title: string) {
  const name = title.trim().replace(/\s+/g, " ") || "App";
  const characters = [...name];
  if (characters.length <= 12) return name;
  const cut = characters.slice(0, 12).join("");
  const space = cut.lastIndexOf(" ");
  return (space >= 4 ? cut.slice(0, space) : cut).trim();
}

/**
 * What in an app's source needs a network connection: request APIs, sockets, and links or resources on other sites.
 * Best effort and on the side of flagging: the result only labels the app "needs connection". XML namespace names
 * (http://www.w3.org/...) are identifiers, not requests, and are ignored.
 */
export function networkFeatures(source: string) {
  const found = new Set<string>();
  const apis: [string, RegExp][] = [
    ["fetch", /\bfetch\s*\(/],
    ["XMLHttpRequest", /\bXMLHttpRequest\b/],
    ["WebSocket", /\bWebSocket\b/],
    ["EventSource", /\bEventSource\b/],
    ["sendBeacon", /\bsendBeacon\s*\(/],
    ["WebRTC", /\bRTCPeerConnection\b/],
    ["import()", /\bimport\s*\(\s*["'`]/],
  ];
  for (const [name, pattern] of apis) if (pattern.test(source)) found.add(name);
  for (const match of source.matchAll(/\b(?:https?|wss?):\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)) {
    const host = match[1].toLowerCase();
    if (host !== "www.w3.org") found.add(host);
  }
  if (/\b(?:src|href|action|poster)\s*=\s*["']?\/\/[a-z0-9]/i.test(source)) found.add("protocol-relative link");
  return [...found];
}

/** The preview's policy, plus what an installed copy needs from its own folder: its manifest, icons and worker. */
export function installedAppPolicy(policy: string) {
  const widened = policy.replace("img-src data:", "img-src 'self' data:").replace("worker-src 'none'", "worker-src 'self'");
  if (widened === policy || !widened.includes("worker-src 'self'")) throw new Error("Unexpected base policy");
  return `${widened}; manifest-src 'self'`;
}

export const installedAppIcons = [
  { file: "icons/icon-32.png", source: "kakkoi-icon-32.png", size: 32 },
  { file: "icons/icon-180.png", source: "kakkoi-icon-180.png", size: 180 },
  { file: "icons/icon-192.png", source: "kakkoi-icon-192.png", size: 192, purpose: "any" },
  { file: "icons/icon-512.png", source: "kakkoi-icon-512.png", size: 512, purpose: "any" },
  { file: "icons/icon-maskable-192.png", source: "kakkoi-icon-maskable-192.png", size: 192, purpose: "maskable" },
  { file: "icons/icon-maskable-512.png", source: "kakkoi-icon-maskable-512.png", size: 512, purpose: "maskable" },
] as const;

/** Lines added to the exported page's head: manifest, icons, and the offline worker's registration. */
export const installedAppHead = [
  '<link rel="manifest" href="manifest.webmanifest">',
  '<link rel="icon" href="icons/icon-32.png" sizes="32x32">',
  '<link rel="apple-touch-icon" href="icons/icon-180.png">',
  '<meta name="theme-color" content="#000000">',
  '<script>if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");</script>',
];

export function installedAppManifest({ id, title, network }: { id: string; title: string; network: string[] }) {
  const name = title.trim().replace(/\s+/g, " ") || "App";
  return JSON.stringify({
    id: `/apps/${id}/`,
    name,
    short_name: installedAppShortName(name),
    description: network.length
      ? `Made in Kakkoi Chat. Needs connection: it uses ${network.slice(0, 3).join(", ")}, which the installed copy blocks.`
      : "Made in Kakkoi Chat. Works offline.",
    start_url: "./",
    scope: "./",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#000000",
    icons: installedAppIcons.filter(icon => "purpose" in icon).map(icon => ({
      src: icon.file, sizes: `${icon.size}x${icon.size}`, type: "image/png", purpose: icon.purpose,
    })),
  }, null, 2) + "\n";
}

/**
 * The app's offline worker: on install it caches every file of the folder, then answers from that cache first. It
 * touches only its own cache, because every app on the export origin shares one CacheStorage. The id is a content
 * hash, so a changed app is a new folder with a new cache, and this cache never needs updating.
 */
export function installedAppWorker(id: string) {
  const files = ["./", "index.html", "manifest.webmanifest", ...installedAppIcons.map(icon => icon.file)];
  return `// Keeps this app working offline: its own files, cache first, inside its own folder only.
const CACHE = ${JSON.stringify(`app-${id}`)};
const FILES = ${JSON.stringify(files)};
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || !request.url.startsWith(self.registration.scope)) return;
  event.respondWith(caches.open(CACHE).then(cache => cache.match(request, { ignoreSearch: true })
    .then(hit => hit || fetch(request).catch(() => request.mode === "navigate" ? cache.match("./") : undefined))
    .then(response => response || Response.error())));
});
`;
}
