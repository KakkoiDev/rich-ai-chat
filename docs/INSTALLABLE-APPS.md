# Installable apps (M6)

"Install as app" turns a generated app into a small web app that a phone or computer can install and open offline.
It is served from its **own origin**, never from the chat's, so an installed app can't read the chat's storage.

## How it works

1. The app card's **Install as app** button sends the app's title and source to `POST /api/exports` (same-origin
   requests only).
2. The chat builds the same standalone page as **Download source** (same content policy, no preview monitor, LittleJS
   inlined with its licence when used) and adds a manifest link, the icons and the registration of an offline worker.
   The page's policy is the preview's, widened only for its own manifest, icons and worker (`connect-src` stays
   `'none'`).
3. It writes one folder into the exports folder, all at once (a hidden `.incoming-*` folder renamed into place):

   ```
   <RICH_CHAT_EXPORTS_DIR>/apps/<id>/
     index.html  manifest.webmanifest  sw.js  icons/icon-{32,180,192,512}.png  icons/icon-maskable-{192,512}.png
   ```

   `<id>` is the title as ASCII plus 12 hex characters of the page's SHA-256, so the same app always lands in the
   same folder and a changed app gets a new one. The manifest has `id` `/apps/<id>/`, scope and start URL `./`, the
   app's title as `name`, a short name of at most 12 characters and `display: standalone`. The icons are visual-core's
   Kakkoi icons, pinned in `cores.lock.json` (copied by `scripts/pin-visual-core.mjs`, checked by preflight).
4. The worker caches the folder's files when it installs and then answers from that cache first. It only ever touches
   its own cache (`app-<id>`), because all apps on the export origin share one CacheStorage.
5. The card shows the app's address, `<RICH_CHAT_EXPORT_ORIGIN>/apps/<id>/`, with how to install it.

**Needs connection.** At export time the source is scanned for network use (`fetch`, `XMLHttpRequest`, `WebSocket`,
`EventSource`, `sendBeacon`, WebRTC, `import()`, and links or resources on other sites; XML namespace names are
ignored). A match labels the app **Needs connection** on the card and in its manifest description. The installed copy
keeps the preview's rule that blocks network access, so those parts don't work there; the label says so.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `RICH_CHAT_EXPORTS_DIR` | `~/Library/Application Support/Rich AI Chat/exports` | Where app folders are written; the Caddy site serves this folder |
| `RICH_CHAT_EXPORT_ORIGIN` | unset | The export site's address as devices reach it, e.g. `https://<mac>.<tailnet>.ts.net:3216`. Unset: the button says Install as app isn't set up, and nothing is written |

## The export site (Caddy)

`deploy/caddy/exports.caddy` is the site: `file_server` over the exports folder on its own port, bound to 127.0.0.1
(Tailscale Serve publishes it to the tailnet, like the chat). It serves only `/apps/<id>/...` (everything else is 404,
no listings, dot files hidden), sends a strict `Content-Security-Policy` and other hardening headers on every
response, never sets a cookie and drops any cookie a browser sends, and limits `Service-Worker-Allowed` on each
`/apps/<id>/sw.js` to `/apps/<id>/`. It takes two import arguments: the port and the exports folder.

### Enabling it on the host (owner)

The host runs Caddy beside a userspace `tailscaled` (`ps aux | grep -i caddy` shows its binary and Caddyfile; it is
not on the PATH). These steps change the host, so they are the owner's; nothing in this repository runs them.

1. Pick a free port, for example 3216: `lsof -nP -iTCP:3216 -sTCP:LISTEN` prints nothing.
2. Put the site file next to the host's Caddyfile, so it doesn't depend on where this repository is checked out:

   ```sh
   sudo cp deploy/caddy/exports.caddy "/Library/Application Support/App Home Caddy/rich-chat-exports.caddy"
   ```

3. Add one line at the end of the host's Caddyfile (`/Library/Application Support/App Home Caddy/Caddyfile`), with
   your exports folder:

   ```caddyfile
   import rich-chat-exports.caddy 3216 "/Users/<you>/Library/Application Support/Rich AI Chat/exports"
   ```

4. Validate before applying (read-only; it doesn't touch the running Caddy):

   ```sh
   "/Library/Application Support/App Home Caddy/caddy" validate --adapter caddyfile \
     --config "/Library/Application Support/App Home Caddy/Caddyfile"
   ```

5. Apply. The host's Caddy runs with `admin off`, so `caddy reload` can't reach it: restart its launchd job instead
   (find the label with `sudo launchctl list | grep -i caddy`, then `sudo launchctl kickstart -k system/<label>`).
   Check: `curl -sI http://127.0.0.1:3216/` answers `404` with a `Content-Security-Policy` header.
6. Publish it on the tailnet, tailnet only, with the same `tailscale` that serves the chat:

   ```sh
   tailscale serve --bg --https=3216 http://127.0.0.1:3216
   tailscale serve status    # the new entry says (tailnet only)
   ```

   Never use Funnel for it.
7. Tell the chat where it is: add `RICH_CHAT_EXPORT_ORIGIN=https://<mac>.<tailnet>.ts.net:3216` (the name `tailscale
   serve status` shows) to the chat's environment, then restart the chat. Keep the hostname out of committed files.

To check the site file alone, without the host's Caddyfile, wrap it in a throwaway config the way
`tests/e2e/pwa-support.cjs` does (`{ admin off }` plus the `import` line) and run `caddy validate` on that.

### Isolation, and its one limit

Different ports are different origins: an app on the export origin can't read the chat's `localStorage`,
`sessionStorage`, IndexedDB, CacheStorage or offline worker, and its policy blocks requests to the chat
(`tests/e2e/export-install.cjs` checks all of these). **Cookies are the exception**: browsers scope cookies by host
name, not port. The chat sets no cookies today (the check asserts it). If it ever does, make them `HttpOnly`, or
serve the export site under a different host name (for example a second Tailscale node) instead of a second port.

All apps share the export origin with each other, so they share its storage. Apps are content the person generated
themselves; don't promise isolation between two installed apps.

## Tests

- `node tests/preflight.mjs`: ids, short names, network flags, the widened policy, manifest, worker, the folder
  writer (atomic, idempotent, refuses bad names) and the origin setting.
- `RICH_CHAT_BUILD_DIR=<build> node tests/e2e/export-install.cjs` (Playwright via `NODE_PATH`; full Chromium for
  that Playwright version; Caddy via `RICH_CHAT_CADDY`, the PATH or the host's copy): runs the committed site file on
  a throwaway Caddy and checks the not-configured message, the written folder, the headers, Chromium's installability
  verdict (test-core `pwa-offline`), an offline reload that still plays, isolation from the chat, the "needs
  connection" flag and the cross-site refusal. `tests/eval/release.mjs` runs it before every benchmark.

## Device checklist (each release, by hand)

Use a synthetic app (for example the tic-tac-toe starter) and the tailnet export origin.

**Android, Chrome**
- [ ] Install as app shows an `https://…ts.net:<port>/apps/<id>/` link; it opens in Chrome on the phone.
- [ ] Chrome's menu offers **Install app** (or **Add to Home screen → Install**); the home-screen icon is the Kakkoi
      cube and the label is the app's short name.
- [ ] The installed app opens standalone (no address bar) and plays.
- [ ] Airplane mode, then open the app from the home screen: it opens and plays.
- [ ] An app labelled **Needs connection** shows the label on the card before installing.

**iPhone, Safari (iOS 26+)**
- [ ] The link opens in Safari; **Share → Add to Home Screen** shows the app's name and the cube icon; "Open as Web
      App" is on.
- [ ] The home-screen app opens without Safari's bars and plays.
- [ ] Airplane mode, then open it from the home screen: it opens and plays.
- [ ] Two installed apps from the same export origin each open their own app (not one another's).
