# Rich AI Chat — verified engineering roadmap

Audited on 2026-11-07 against revision `b490e06`, the uncommitted product-direction notes in [AI-HANDOFF.md](AI-HANDOFF.md), the benchmark reports, and these local core checkouts:

- `visual-core` at `9efabcf`
- `coding-core` at `8961ece`
- `test-core` at `46c62fa`
- `pi-local-harness` at `31866da`

Browser and device limits were checked against current vendor documentation (sources in [§3](#3-browser-and-device-constraints)). No benchmark, model, or server process was started for this audit. No private chats were opened.

Companion documents:

- [DESIGNER-HANDOFF.md](DESIGNER-HANDOFF.md): the brief for the design agent
- [BENCHMARK-PLAN.md](BENCHMARK-PLAN.md): how the five-model matrix grows with each feature

## 0. Owner decisions (2026-11-07)

These override anything below that conflicts with them.

- **Style:** the Kakkoi style is taken from kakkoi.dev:
  - black on white
  - Bebas Neue headings, Inter body text, Noto Sans JP for Japanese
  - hairline rules, a single 768 px column
  - a wireframe-cube motif

  The principle is "the less you add the better". Pages must also work for AI agents driving them through the accessibility tree. The [designer handoff](DESIGNER-HANDOFF.md) is written around this.
- **Chat shell:** a **new Kakkoi chat shell** replaces OpenUI's stock `AgentInterface` layout. It is built on OpenUI's headless layer (`@openuidev/react-headless` for threads, streaming and storage; `@openuidev/react-lang` for rendering replies), so the chat logic and the 82-component catalogue are kept. Reply components are themed through the token adapters.
- **Capacitor is deferred.** M8 is out of scope. The phone experience is the chat PWA (M7) over Tailscale.
- **Component selection gate:** small models get only the components relevant to the request. **Laya** chooses the slice: PLH's typed-decision classifier (`pi-local-harness/harness/laya.py`, laya-mlx with mmBERT-base 322M, multilingual, about 7–13 ms per question, abstains below a confidence threshold). When Laya abstains, the request uses the general path; added to M3.
- **Complete log:** the owner wants a complete log of what happens, for easy debugging (deepseek-harness was cited as an example; its public docs didn't show the log format when checked). This extends M2 (see below).
- **Export origin via Caddy.** The host already runs Caddy beside a userspace `tailscaled`. Generated-app PWAs get their own Caddy site on a separate origin; added to M6.
- **test-core first:** the benchmark engine becomes a shared runner in test-core, together with Schness's strength-evaluation harness (`~/Documents/ChatGPT/Schness`: frozen manifests, single-runner lock, checkpoints, replay verification). The full-screen state and focus test becomes a test-core recipe. Rich AI Chat pins both.

## 1. Corrections to the handoff

Some handoff statements don't match the code or the cores. Plan against the verified version.

| Handoff says or implies | Verified state | Consequence |
| --- | --- | --- |
| Visual-core already vendors Basecoat; build the theme on it and pin a version. | Basecoat 1.0.2 is vendored with hashes (`vendor/basecoat/`, `vendor/LOCK.json`). However, visual-core has **no Kakkoi theme, no dark palette, no logo or app icons, no npm package, no git tags and no release process**. Integration is copy-only: `visual.py init` copies files and writes `provenance.json`. The only palette, "visual-core warm", is light-only and scoped to `.vc-app`. | "Pin the verified version" currently means recording a commit plus file hashes. Add semver tags to the cores as part of the first core change (proposed below). |
| Rebuild the chat shell, sidebar and composer with Basecoat. | The chat shell is OpenUI's `AgentInterface` (`src/chat-page.tsx`). It is styled by `--openui-*` variables set by OpenUI's `ThemeProvider`, not by Basecoat classes. It also provides threads, the sidebar, mobile header, artifact browser, workspace panels and a tool-call timeline slot. | Don't rewrite the shell in Basecoat; that would discard working features. The Kakkoi tokens become the single source and generate two adapters: Basecoat semantic variables (`--background`, `--primary`, …) for generated apps and custom chat widgets, and an OpenUI theme object (`lightTheme`/`darkTheme`, about 120 keys in `ThemeProvider/types.ts`) for the shell. |
| Make the full OpenUI catalog available; inventory what is registered. | All 82 components of `openuiLibrary` (react-ui 0.18.1) are already registered. `src/generated/spec.json` lists 83: the 82 plus `HtmlArtifact`, and `PieChart` is overridden by `ColorPieChart`. The real gaps are elsewhere: (a) **reachability**: small Gemma models get the plain-Markdown `conciseToolPrompt` unless a `wantsRichUI` regex matches (`route.ts:510,536`), so they rarely see the catalog; (b) **custom actions are silently dropped**, because `AgentInterface` receives no `onAction`; (c) the chat-only variants (`FollowUpBlock`, `ChatCard`, `ChatTabs`, …) in `openuiChatLibrary` are not registered; (d) the full system prompt is about **38 KB, roughly 9.6k tokens**. | The OpenUI milestone is about reachability, actions and prompt slicing, not registration. |
| Retain the custom media and app components. | Only `HtmlArtifact` and the `PieChart` override are custom. Image galleries and video results are upstream components (`ImageGallery`, `ImageBlock`, `MarkDownRenderer`) that the route composes (`route.ts:59-76`). | Nothing extra to preserve beyond those two. |
| Activity can be built from structured server events. | OpenUI's `vercelAIAdapter` (react-headless `index.cjs:2196+`) handles only text, step and tool chunks and **drops AI SDK `data-*` parts**. `processStreamedMessage`, which `local-storage.ts` uses, does the same. Tool chunks already reach OpenUI's built-in turn timeline through `readChatAttempt` → `reportTool`. However, the direct-reply paths emit no tool events at all: picture and video regex routes, inline tables, charts, starters, layout configuration and artifact builds. | Activity needs a side channel: a wrapping stream adapter that extracts `data-activity` chunks into a separate store, plus a `ToolCallTimeline`/`AssistantMessage` override. The direct paths must emit their own events. |
| Persist Activity next to browser chat history. | Chat history is one JSON array per thread in `localStorage` (`local-storage.ts`). Write failures are swallowed (`catch {}`). Artifacts of up to 32 KB each are stored inline, so the roughly 5 MB quota can be exhausted without any notice. | Store Activity, saved projects and anything new in IndexedDB. Add a quota-error state. Don't append to the localStorage blob. |
| Full-screen view with preserved state. | The preview is `<iframe sandbox="allow-scripts" srcDoc=…>` keyed by run (`html-artifact.tsx:120`). Moving the iframe in the DOM (for example through a React portal) reloads it and loses state. Inside the opaque-origin frame, key events never reach the parent. | Full-screen must restyle or `requestFullscreen()` the **existing wrapper** without reparenting the iframe. Escape inside the frame has to be relayed by the injected monitor script. |
| Export eligible apps as installable PWAs. | `blob:`, `data:` and `file:` URLs can't be installed. Installation needs an HTTPS or localhost origin with a manifest and, for offline use and Chrome's install prompt, a service worker. Exports under the chat origin would share its storage and service-worker scope with untrusted code. | A downloadable source export can ship before PWAs. Installable exports need a **separate origin** served by the host, such as a second Tailscale Serve HTTPS port. |
| Capacitor client talks to the host over Tailscale. | `POST /api/chat` returns 403 for `Sec-Fetch-Site: cross-site` (`route.ts:79`). A Capacitor webview (`capacitor://localhost` or `https://localhost`) calling `*.ts.net` is cross-site. There is no CORS handling and no auth token. Capacitor is now **v8**. `output: 'export'` can't include route handlers. | Before any native build: an explicit origin allowlist, a bearer token stored in the native keychain, CORS on `/api/chat` and `/api/transcribe`, and an API base URL in the client. Leave CapacitorHttp **disabled**, because it buffers and would break streaming. |
| The chat is reachable privately over HTTPS. | Confirmed in part: a host-managed launcher (`/Library/Application Support/Tailscale Home/tailscale-home`) runs `next-server` on 127.0.0.1:3212, with a userspace `tailscaled` and Caddy alongside. The serve configuration lives outside this repository and isn't documented here. | M7 starts by documenting that front end (without committing tailnet hostnames) and adding the PWA layer on top. |
| Background jobs. | All work runs inside the `/api/chat` request. There is no worker, job table or durable store. coding-core has retries and atomic JSON, but no leases, heartbeats, idempotency or SQLite. test-core's `sample_app` shows `node:sqlite`. | Job primitives belong in coding-core first (state-transition table with guards, idempotent operation receipts, SQLite transaction recipe). |
| The benchmark gate is 135/135. | Confirmed. `matrix.cjs:20-23` derives it as (14 + 13) × 5. The baseline `b490e06.oVGouR` is `stable-and-regression-passed` with 1,485/1,485. Its `error.log` holds 6 gpt-oss `AI_ToolChoiceViolationError` entries (`web_search` called while tool choice was `none`), all recovered. Many breadth cases finish in under 1 s because host layouts and binders handle them. | The latent tool-choice violation is a flakiness source; fix it before or during the first expanded streak. New cases should exercise model output where the model is under test (see the benchmark plan). |

## 2. Capability map: what works, what's missing, where it belongs

The "Owner" column applies the rule from the handoff: reusable work goes into a core first, and Rich AI Chat pins the tested commit.

| Area | Works today | Missing | Owner | Proof |
| --- | --- | --- | --- | --- |
| Theme | OpenUI default theme; `useSystemThemeMode` light/dark; a few `--openui-*` references in `globals.css`; hard-coded greys in `.html-artifact`. | Kakkoi tokens (light and dark), logos and icons, a font file, the Basecoat and OpenUI adapters, a host-injected theme for generated apps, a versioned distribution. | **visual-core**: tokens, adapters, assets, an icon export command, tags. **Rich AI Chat**: wiring and chat-specific layout. | The same token file hash is consumed by the chat and by an exported generated app. Contrast and visual scenarios run in visual-core. Rich AI Chat checks `provenance.json` against the pin. |
| OpenUI catalog | 82 components registered; `@ToAssistant`, forms, EditableTable save and card clicks reach the model. | `onAction` for custom actions; the chat-library variants; a gallery route; small-model reachability; a measured prompt slice. | Rich AI Chat. A reusable "every control has an e2e step" gate already exists in test-core (`e2e_coverage.py`). | Gallery e2e: every component renders, every interactive one is operable by keyboard at 390 px and 1280 px. Model cases: form submit and editable table round-trip. |
| Full-screen app | Inline sandboxed preview, diagnostics, revisions as new artifacts. | Full-window and native fullscreen without reparenting; visible exit; Escape relay; focus restoration; safe-area insets. | Rich AI Chat. **test-core** gets a reusable fullscreen/overlay recipe. | Deterministic e2e in Chromium (native API) and mobile emulation (overlay), with state preserved across enter and exit. |
| Source export | View source only. | A standalone HTML download that inlines the needed engine (LittleJS) with its license and keeps the CSP meta, without the preview monitor. Later, a multi-file zip with a manifest. | Rich AI Chat (export builder). The verification recipe goes to **test-core**. | Model case: an app generated in chat works in a clean page loaded from the exported file with the network offline. |
| Saved projects | Revisions keep the previous artifact in the thread. | A versioned project store and reopen. OpenUI already defines `ArtifactStorage`, an artifact browser and `ArtifactViewPage`. | Rich AI Chat (IndexedDB `ArtifactStorage`); server-side later with the task store. | Save v1, revise, save v2, reload, reopen both versions, export v1. |
| App PWA | — | Per-app manifest, icons, scoped service worker, an export origin separate from the chat, offline cache. | Rich AI Chat (export server). **visual-core**: icon export (SVG→PNG 192/512/maskable). **test-core**: PWA/offline recipe (service-worker registration, CacheStorage, offline reload). | Chromium: installability with no manifest errors, offline reload works. Manual device checklist for iOS and Android. |
| Chat PWA | Private HTTPS via the host launcher (configuration outside the repo). | Manifest, icons, shell service worker, offline and disconnected states, documented serve configuration. | Rich AI Chat. Icons from visual-core. | Chromium offline reload shows the shell and the "host unreachable" state. Device checklist on the tailnet. |
| Capacitor | — | Static client build, API base URL, CORS allowlist, bearer token, microphone and file permissions, private signing. | Rich AI Chat (`apps/native` or similar). | Android debug APK on a real phone: stream, upload, dictate, reconnect. iOS only with a paid account (free profiles expire after 7 days). |
| Activity | OpenUI's turn timeline shows tool calls that the route forwards. Server `console.warn` on incomplete replies. | Request, attempt and tool-call IDs; recorded executions with timings; retry and recovery events; events from direct paths; side-channel adapter; IndexedDB store with deletion; reasoning-summary placeholder; synthetic capture in the eval harness. | Rich AI Chat. A redaction allowlist could later move to test-core's recording privacy rules. | Fault injection (stalled stream, failed tool, cancel), then model cases asserting one execution per real tool call. |
| Tasks and jobs | — | SQLite store, validated transitions, change log, Markdown export, agent operations, worker with leases, heartbeats and checkpoints. | **coding-core**: transition table, idempotent receipts, SQLite transaction and migration recipes (already on its TODO). Rich AI Chat: store, API, UI, worker. | Deterministic: interrupted worker, duplicate delivery, cancellation, cross-profile isolation. Then five-model planning and resume cases. |

### Core pinning, made concrete

None of the cores has a tag, so pinning means recording commits and file hashes. Rich AI Chat gets a `cores.lock.json` at its root:

```json
{
  "visual-core": { "commit": "<sha>", "tag": "v0.5.0", "files": { "<path>": "<sha256>" } },
  "test-core":   { "commit": "<sha>", "manifest": "test-core/MANIFEST.json" }
}
```

- test-core is adopted with `adopt/adopt.py <repo> --no-workflow`, which already writes `MANIFEST.json` with hashes. Its ES-module tools need a small adapter for the CommonJS eval harness.
- visual-core assets are copied with its `init` provenance.
- `node tests/preflight.mjs` verifies the hashes, so a hand-edited copy fails the gate.
- Each core change also adds an `IMPLEMENTATIONS.toml` entry naming Rich AI Chat as a verified consumer, as those repositories require.

## 3. Browser and device constraints

Researched 2026-11-07. These limit what each milestone may promise.

| Flow | Constraint | Design response | Source |
| --- | --- | --- | --- |
| Fullscreen | iPhone Safari has no element fullscreen; only `<video>` can go fullscreen. iPad and desktop browsers support it. | Feature-detect `document.fullscreenEnabled`. On iPhone use a full-window overlay: `position:fixed; inset:0; 100dvh`, safe-area padding and a body scroll lock. | [caniuse](https://caniuse.com/mdn-api_element_requestfullscreen), [WebKit 212934](https://bugs.webkit.org/show_bug.cgi?id=212934) |
| Fullscreen from an iframe | Whether an opaque-origin `srcdoc` frame may request fullscreen varies by engine. | The parent requests fullscreen on the wrapper; the generated app never calls it. | [Mozilla 1608358](https://bugzilla.mozilla.org/show_bug.cgi?id=1608358) |
| Exit and focus | Native Escape can't be intercepted, and keys pressed inside the opaque frame don't reach the parent. | One exit path for both modes: listen for `fullscreenchange`, show a visible Exit button, have the monitor relay Escape to the parent, and restore focus to the trigger. | Spec behaviour |
| Install (Chromium) | Menu install needs a manifest and HTTPS. The automatic prompt still needs a fetch-handling service worker. | Always ship a real service worker with an offline cache. | [Chrome install criteria](https://developer.chrome.com/blog/update-install-criteria) |
| Install (iOS 26+) | Home Screen sites open as web apps by default. There is no prompt API. | Show "Share → Add to Home Screen" instructions. | [WebKit WWDC25](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/) |
| Export origin | `blob:`, `data:` and `file:` can't be installed. Several PWAs on one origin share its storage, and nested scopes are discouraged. | Use a separate export origin, such as a second Serve port, with `/apps/<id>/` scopes and distinct manifest `id`s. Never place exports under the chat origin. | [web.dev multiple PWAs](https://web.dev/articles/building-multiple-pwas-on-the-same-domain) |
| iOS storage | Home Screen apps get their own storage, separate from Safari's, and `persist()` may be denied. | The server is the source of truth; client storage is a cache. Expect empty state after install. | [WebKit 237350](https://bugs.webkit.org/show_bug.cgi?id=237350) |
| Tailnet HTTPS | Serve provisions `*.ts.net` certificates and keeps the service tailnet-only. Certificate names appear in public Certificate Transparency logs. | Use Serve, never Funnel. Keep hostnames out of committed docs and reports. | [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve), [HTTPS](https://tailscale.com/kb/1153/enabling-https) |
| Tailnet down | MagicDNS stops resolving, so a cached shell loads but the API fails. Phones allow only one VPN at a time. | Explicit "Connect Tailscale / host unreachable" state; nothing that must run in the background on the phone. | [Other VPNs](https://tailscale.com/kb/1105/other-vpns) |
| Capacitor | v8. `server.url` is for development only. Webview origins are `capacitor://localhost` on iOS (or `https://localhost` with `iosScheme`) and `https://localhost` on Android. CapacitorHttp buffers responses. | Static bundle plus remote API, CORS allowlist, bearer token, plain `fetch` for streaming. | [Capacitor config](https://capacitorjs.com/docs/config), [HTTP](https://capacitorjs.com/docs/apis/http) |
| Microphone | WKWebView needs `NSMicrophoneUsageDescription`. Android needs `RECORD_AUDIO` and a permission grant from the WebChromeClient. Web Speech is unavailable in iOS Home Screen apps, and microphone permission may be asked again each session. | Keep the current design: MediaRecorder on the device, Whisper on the Mac. Verify on device. | [WebKit 225298](https://bugs.webkit.org/show_bug.cgi?id=225298), [WebKit 215884](https://bugs.webkit.org/show_bug.cgi?id=215884) |
| Signing | Android: debug APK. iOS free Personal Team: 7-day profiles and roughly 3 apps (forum-reported); a paid account gives 1-year ad hoc profiles. | The PWA is the primary iOS path; a native iOS build only with a paid account. | [Apple forum](https://developer.apple.com/forums/thread/71283) |
| Background | No Background Sync on Safari/iOS; hidden pages are suspended. Web Push works only for Home Screen apps on iOS 16.4+. | Jobs run on the server. The client re-attaches when it returns to the foreground. Push notification on completion is optional and later. | [caniuse](https://caniuse.com/background-sync), [WebKit push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) |

**Do not promise:**

- true fullscreen on iPhone
- an install prompt on iOS
- installing an app from a download or a `blob:` URL
- storage isolation between exported apps on one origin
- chat while Tailscale is off
- background jobs on the phone
- Web Speech in the iOS Home Screen app
- streaming through CapacitorHttp
- a long-lived iOS native install without a paid account

**Verify on device before relying on it:**

- opaque-frame fullscreen
- several same-origin Home Screen apps on iOS
- Capacitor 8 microphone grants
- the free-provisioning limits

## 4. Milestones

Every milestone ends with a demo, deterministic acceptance checks, new benchmark cases where model behaviour is involved, and the full release gate. The gate is ten consecutive perfect rounds on the expanded matrix, then one full regression round on the same frozen revision.

Order: the theme (M4) depends on design decisions, so engineering milestones that don't need them come first, and the theme work runs in parallel in visual-core. Activity (M2) precedes jobs (M9–M10) because jobs reuse its event model.

### M1 — Full-window generated apps and standalone source export *(recommended first; detail in §5)*

- **Demo:** Generate a novel app in chat and play it. Open it full-window on a phone and fullscreen on desktop. Exit with the button or Escape, and find the app state unchanged. Download its source, open the file in a clean browser with the network off, and it works the same way.
- **Accept:** see §5.

### M2 — Reply Activity and synthetic run capture

- **Server** (`route.ts`, `chat-attempt.ts`):
  - Assign a `requestId` per POST, an `attemptId` per attempt and a `toolCallId` per execution.
  - Emit `data-activity` chunks for attempt start and end with the reason (`stale-opening`, `provider-interrupted`, …), tool executed (recorded inside `execute`, not when the model proposes the call), tool result summary (allowlisted fields such as `count`, `error`, source hostnames), recovery path (`sources-only synthesis`, `clock fallback`, `media fallback`), and the direct paths (picture and video search, starter, layout configuration, artifact build and check failures).
  - Record timings with `performance.now()`.
  - Never include prompts, raw arguments or file text.
- **Client:**
  - A wrapping `StreamProtocolAdapter` tees the response, routes `data-activity` to an IndexedDB store keyed by thread and assistant message ID, and passes the rest to `vercelAIAdapter`.
  - An Activity disclosure per reply through `components.ToolCallTimeline`, or an `AssistantMessage` wrapper.
  - Deleting the thread deletes its activity.
  - "Reasoning summary unavailable" is shown when the provider gives none (`sendReasoning` stays false).
- **Eval:** opt-in `EVAL_CAPTURE=1` writes a per-case `capture/<suite>/<case>.json` containing the synthetic prompt, settled reply and redacted activity.
- **Complete log and extraction for analysis.** There are three layers, so nothing depends on scraping localStorage:
  1. **Server event log**, always on: append-only JSONL per day under `~/Library/Application Support/Rich AI Chat/logs/`. It holds every request, attempt, model call (provider, model, timings, finish reason, token usage when reported), tool execution, check failure, retry and recovery, keyed by `requestId`, `attemptId` and `toolCallId`. By default it records lengths and hashes rather than prompt or reply text. It has bounded retention, and a `scripts/log-query.mjs` loads it into `node:sqlite` for analysis.
  2. **Debug capture**, per chat and opt-in: a "Debug this chat" switch adds full prompt, reply and tool-result text to the server log for that chat only, so the owner can get a complete trace when needed without logging every classroom chat.
  3. **Browser export**: an **Export** action in the log view and in each thread menu downloads the thread's messages and activity as JSONL, read from IndexedDB, for offline analysis or attaching to a bug.
- **Demo:** A web-search question shows one `web_search` with its duration and source count. A forced stall shows "Attempt 1 stopped: no answer in 22 s, retrying" and still exactly one search.
- **Accept:** Fault-injection tests in `tests/chat-attempt.mjs` (stubbed success, failed tool, interrupted stream, cancel) assert the event sequence. Reload keeps the panel. Thread deletion removes it. Model cases: `activity-single-search`, `activity-no-tool-local` (see the benchmark plan).

### M3 — OpenUI reachability, actions and gallery

- `onAction` handler: log custom actions to Activity and show "This action isn't supported".
- A `/gallery` route, development only, that renders each of the 82 components from fixture markup.
- Decide on `openuiChatLibrary` additions (`FollowUpBlock` first).
- Measure task-specific prompt slices (forms, charts, layout) against the 9.6k-token full prompt.
- Replace the `wantsRichUI` regex gate for small Gemma models with a **Laya slice gate**:
  - Laya answers a `choice` question over named slices (`text`, `sources`, `chart`, `table`, `form`, `layout`, `media`, `app`), with `min_confidence`.
  - The chosen slices' component specs go into the prompt.
  - When Laya abstains, or isn't installed, the general path stays as it is today.
  - Laya runs as a local sidecar process, reusing PLH's pinned runtime and `ask()` contract; it is never downloaded during a request.
  - Its accuracy is measured on a synthetic labelled set before it gates anything, and the decision and confidence go into the log.
- **Demo:** The gallery on a phone and on a desktop. Each model fills a generated form whose submitted values come back in the next reply.
- **Accept:** gallery e2e covers every interactive control (keyboard and 390 px); `e2e_coverage.py` passes. Model cases: `form-submit-roundtrip`, `editable-table-save`, `native-layout-choice`.

### M4 — Kakkoi theme v0 *(parallel track; needs the designer's deliverables)*

- **visual-core:**
  - `themes/kakkoi/tokens.json` is the source.
  - Generated outputs: `kakkoi.css` (Basecoat semantic variables, light and `.dark`), `kakkoi.openui.json` (OpenUI `ThemeProps`), and `kakkoi.inline.css`, a small subset with no Tailwind for generated apps.
  - Logo and icon SVGs, plus an SVG→PNG icon export command for 16/32/180/192/512 and maskable sizes.
  - Scenarios and tests under its rules; tag `v0.5.0`.
- **Rich AI Chat:**
  - Pass `theme={{ mode, lightTheme, darkTheme }}` from the JSON.
  - Replace the hard-coded `.html-artifact` colours.
  - The host injects `kakkoi.inline.css` into previews and exports. The model never writes it, so it costs nothing against the 32 KB artifact budget.
  - `logoUrl` and favicons.
- **Accept:** The chat and an exported app reference the same token hash. Contrast checks run in visual-core. Screenshots of light, dark and phone views; no theme definitions copied into Rich AI Chat.

### M5 — Saved, versioned projects

- Implement OpenUI's `ArtifactStorage` over IndexedDB, with a project ID and a version per revision.
- Enable the Artifacts navigation and browser.
- Reopen a project into a new thread for revision.
- **Accept:** save v1, revise, save v2, reload, reopen either version, export v1. Quota errors are visible. Delete removes all versions.

### M6 — Installable exported apps

- **Caddy:** add a second site to the host's existing Caddy, on its own port or hostname, so it is a different origin from the chat. It uses `file_server` over an exports folder that Rich AI Chat writes, with `Content-Security-Policy`, no cookies, `Service-Worker-Allowed` limited to each app's folder, and the same tailnet-only binding as the chat.
- The host serves exports from that **separate HTTPS origin** under `/apps/<id>/`, with a per-app manifest (distinct `id`, its own scope), icons from the visual-core exporter and a cache-first service worker.
- Network-dependent features are flagged at export time, and those apps are labelled "needs connection".
- **test-core:** a new `pwa-offline` recipe covers service-worker registration, CacheStorage contents and offline reload.
- **Accept:** Chromium reports the app installable and an offline reload works. A manual device checklist (Android Chrome install, iOS Add to Home Screen) is recorded per release. The chat origin's storage is not reachable from the export origin.

### M7 — Chat PWA on the tailnet

- Document the existing serve front end (no hostnames).
- Manifest and icons; a shell-only service worker (never cache `/api/*`).
- States: offline, host unreachable and Tailscale disconnected, with a retry action.
- **Accept:** Chromium offline reload shows the shell and the unreachable state; a reply resumes after reconnecting. Device checklist: install, stream, upload, dictate, reconnect.

### M8 — Private Capacitor builds *(deferred by the owner on 2026-11-07; kept for reference)*

- Split the client build from the API.
- Origin allowlist and bearer token replace the `sec-fetch-site` 403 for native origins; CORS headers.
- Capacitor 8 with CapacitorHttp disabled; microphone and file permissions.
- Android debug APK first; iOS only with a paid developer account.
- **Accept:** on a real Android phone, streaming, attachments, dictation, backgrounding and reconnecting, and the tailnet-off state all work.

### M9 — Persistent tasks

- **coding-core first:** a guarded transition table (pure), idempotent operation receipts, and SQLite transaction and migration recipes in JS (`node:sqlite`).
- **Rich AI Chat:**
  - SQLite store with an append-only change log and Markdown export.
  - A Tasks panel scoped to the browser profile.
  - Agent operations: read the plan, propose items, record a checkpoint, record a verification (rejected without evidence).
- **Accept:** the handoff's two-step plan scenario, plus concurrent edits, illegal transitions and cross-profile isolation.

### M10 — Background jobs

- A worker process separate from the HTTP request.
- Job, run, attempt, lease, heartbeat and outcome records; reclaim expired leases; resume from the last committed checkpoint.
- One generation at a time per constrained local model.
- Activity events reused for job progress.
- **Accept:** kill the worker during a run and it resumes from the checkpoint; duplicate delivery doesn't repeat a receipt-backed operation; cancellation; blocked dependencies; waiting reasons are visible.

## 5. First milestone in detail: M1

### Why M1 first

- It needs no design decision; the current OpenUI tokens are acceptable until M4.
- It doesn't touch the model or tool path in `route.ts`, so it can't destabilize the 135-check baseline.
- It gives the expanded benchmark its first observable, model-driven outcome: an app generated by each of the five models works after export.

### Rich AI Chat changes

1. **`src/html-artifact.tsx`**
   - Add a toolbar button, **Full screen**. It wraps the existing `<section>` content in a state, without moving the iframe.
   - When `document.fullscreenEnabled`, call `wrapper.requestFullscreen()`. Otherwise add `data-view="full-window"`, styled with `position:fixed; inset:0; height:100dvh; padding:env(safe-area-inset-*)`, and lock body scroll.
   - A visible **Exit** button stays outside the iframe. Store `document.activeElement` on open and restore it on exit. Listen for `fullscreenchange`.
   - Extend the injected monitor to `postMessage({kind:'escape'})` on Escape inside the frame. The parent only ever exits on it.
   - Add `allow="fullscreen"` only if testing shows a need; the parent-side request does not require it.
2. **`src/lib/artifact-export.ts`** (new)
   - `exportArtifact(document, title)` returns a standalone HTML file containing: `<!doctype html>`, charset, viewport, the same CSP meta as the preview, the inlined LittleJS engine with its MIT notice when the marker is present, and the source.
   - The preview monitor is excluded.
   - Pure and unit-tested in preflight.
3. **Download source** button: a `Blob` and `<a download>` in the parent. The file name comes from the slugged title, the artifact version index and a short content hash.
4. **CSS:** full-window styles in `globals.css` using `--openui-*` tokens, which the M4 theme replaces later.

### Core changes

- **test-core:** new recipe `fullscreen-overlay`, in JS and Python per its two-language convention. It provides:
  - assertions for entering native fullscreen and for the overlay fallback under mobile emulation
  - an Exit button that is visible and at least 44 px
  - focus restored to the trigger
  - iframe state preserved, by reading a counter before and after
  - Given/When/Then scenarios and a vocabulary entry
  - tag `v0.2.0`

  Also recipe `export-replay`: serve a downloaded file from a temporary loopback server, set the context offline, and run the same interaction steps.
- **visual-core:** none for M1.
- **coding-core:** none for M1.
- **Rich AI Chat:** adopt test-core with `adopt.py --no-workflow`, add `cores.lock.json`, and verify the hashes in preflight.

### Tests that prove M1 is ready

1. `npm run lint`, `node --test tests/chat-attempt.mjs`, `node tests/preflight.mjs`. Preflight adds export unit tests:
   - the CSP meta is present
   - the monitor is absent
   - the engine is inlined only with its marker
   - `</script>` is escaped
   - the output is byte-stable for the same input
   - the core hash pins match
2. `RICH_CHAT_BUILD_DIR=.next-local/<candidate> npm run build`.
3. Deterministic e2e `tests/e2e/fullscreen-export.cjs` against the tested calculator starter and tic-tac-toe, so no model is involved:
   - **Desktop Chromium, 1280×800:** enter fullscreen and `document.fullscreenElement` is the wrapper. Play to a mid-game state, then press Escape, then Exit; the state is unchanged and focus returns to Full screen.
   - **Mobile emulation, 390×844 with touch and a stubbed `fullscreenEnabled=false`:** the overlay covers the viewport and the body doesn't scroll. Exit is visible, at least 44 px, and reachable by Tab. Escape relayed from inside the frame exits.
   - **Export:** download the file, serve it from a loopback server, set the context offline, and replay the same moves to the same result. No console errors and no CSP violations.
   - **LittleJS slingshot export:** the file runs offline with the engine inlined.
4. **Five-model matrix with the new `features` suite.** Its first two cases are model-driven (details in [BENCHMARK-PLAN.md](BENCHMARK-PLAN.md)):
   - `export-novel-app`
   - `export-after-revision`

   A round grows to (14 + 13 + 2) × 5 = **145 checks**. Stable means ten consecutive 145/145 rounds plus one 145/145 regression round on the same frozen revision: **1,595/1,595**.
5. **Manual device check:** iPhone Safari, the full-window overlay, Exit, rotation, safe areas. Record the result in the release notes; it doesn't count toward the matrix.

### Known risk to watch during the M1 streak

gpt-oss's `AI_ToolChoiceViolationError` on the Kiso search (6 occurrences in the baseline) recovers today but could fail a round. If it does, fix the general path. For example, treat a tool call during the `toolChoice: "none"` step as a recoverable synthesis retry that reuses `searchSources`. Then restart the streak.
