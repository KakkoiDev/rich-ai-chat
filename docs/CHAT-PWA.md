# Kakkoi Chat as an app on the tailnet (M7)

The chat installs as **Kakkoi Chat** on a phone or computer and opens even without a connection, so it can say why it
can't reach the Mac. Replies, uploads and dictation always go to the Mac; nothing is answered from a cache.

## The serve front end (as found on 2026-11-08)

No host names here: they appear in public certificate logs, so they stay out of the repository.

```
phone or laptop on the tailnet
  │ https://<mac>.<tailnet>.ts.net:3212        Tailscale Serve, tailnet only (never Funnel), *.ts.net certificate
  ▼
system tailscaled (tailscale serve)  ──proxy──▶  http://127.0.0.1:3212   next-server (this app), loopback only
```

- A host-managed launcher (`/Library/Application Support/Tailscale Home/tailscale-home`) keeps `next-server` running
  on 127.0.0.1:3212; its settings live outside this repository (settings such as `RICH_CHAT_EXPORT_ORIGIN` go there).
- `tailscale serve status` lists the chat as `https://<mac>.<tailnet>.ts.net:3212 (tailnet only)` proxying to
  `http://127.0.0.1:3212`. HTTPS is what makes install and the offline worker possible on phones.
- The same host also runs a Caddy beside a userspace `tailscaled`, for other sites. The export origin for installed
  apps (M6) is added to that Caddy and published by Serve on its own port: see
  [INSTALLABLE-APPS.md](INSTALLABLE-APPS.md).
- To add or check a Serve entry: `tailscale serve --bg --https=<port> http://127.0.0.1:<port>`, then
  `tailscale serve status`. Keep every entry tailnet only.

## What the app adds

- **Manifest** (`src/app/manifest.ts`, served at `/manifest.webmanifest`): name and short name "Kakkoi Chat",
  standalone, start and scope `/`, white background, black theme, visual-core's Kakkoi icons (any and maskable,
  192 and 512; pinned in `cores.lock.json`). The layout adds the 32 px icon, the 180 px Apple touch icon and the
  Apple web-app title.
- **Shell worker** (`public/sw.js`, production builds only, registered by `src/connection-status.tsx`): it keeps the
  chat page and the build files that page names (and their fonts), plus the manifest and icons. Pages are fetched from
  the Mac first and fall back to the kept copy; build files come from the kept copy first. It never answers or caches
  `/api/*`, so chats, replies, files and voice never enter its cache (the e2e checks the cache holds no `/api/*`).
  Next serves it with `Cache-Control: no-cache` so a new version is picked up.
- **Connection line** (`src/connection-status.tsx`, above the composer; logic in `src/lib/connection.ts`): it asks
  `/api/health` when the page opens, when the browser goes online, when the page becomes visible, after a failed
  reply, every 15 s while something is wrong, and on **Retry**. It tells three cases apart, best effort:

  | State | How it is recognised | What it says |
  | --- | --- | --- |
  | Offline | the browser reports no network | You're offline. This device has no network connection. |
  | Tailscale off | the request fails at once on a `*.ts.net` or 100.64/10 address (the name no longer resolves) | Can't reach the chat. Tailscale may be off on this device. |
  | Host unreachable | an error status (Serve is up, the chat isn't), no answer within 6 s (Mac asleep or off), or a refusal on a local address | The chat's host isn't answering. |

  **A reply resumes**: when a reply fails while the host can't be reached, the question is sent again as soon as a
  check (Retry, coming back online, or the 15 s recheck) finds the host answering. A failure while the host does
  answer (a server error) is not retried automatically.

## Tests

- `node tests/preflight.mjs`: the three-way classification, the health check (timeout, offline without a request)
  and that the worker passes `/api/*` straight through.
- `RICH_CHAT_BUILD_DIR=<build> node tests/e2e/chat-pwa.cjs` (Playwright via `NODE_PATH`, full Chromium; a stub model,
  no real model): Chromium reports the chat installable, a reply streams, the cache holds the shell but nothing from
  `/api/*`, an offline reload shows the shell and the offline state with Retry, a stopped host shows the unreachable
  state, and a question asked while the host was down is answered after the host returns and Retry is pressed.
  `tests/eval/release.mjs` runs it before every benchmark.

## Device checklist (each release, by hand, on the tailnet)

Use synthetic prompts only. **Android Chrome** and **iPhone Safari (iOS 26+)**, each:

- [ ] **Install**: open the chat's tailnet address. Android: menu → Install app. iPhone: Share → Add to Home Screen,
      "Open as Web App" on. The icon is the Kakkoi cube; the label reads "Kakkoi Chat".
- [ ] **Stream**: from the home-screen app, ask a question; the reply streams in, and Activity shows it.
- [ ] **Upload**: attach a small UTF-8 text file and ask about it; the reply uses it.
- [ ] **Dictate**: record a short sentence with the microphone button; the text appears in the composer (the Mac
      transcribes it; iOS may ask for the microphone again each session).
- [ ] **Reconnect**:
  - Airplane mode, then open the app: the chat opens and says "You're offline", with Retry.
  - Wi-Fi on, Tailscale off, open or Retry: it says Tailscale may be off.
  - Tailscale on, quit the chat server on the Mac (or let the Mac sleep), Retry: it says the host isn't answering.
  - Ask a question while the host is down, bring it back, press Retry: the question is answered without retyping.
