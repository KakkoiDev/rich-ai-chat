# pwa: checks for installable web apps

Helpers for Playwright tests of a PWA in Chromium, in JavaScript (`pwa.mjs`) and Python (`pwa.py`, sync API). Each
takes a Playwright page and waits for a state, never for time.

| JavaScript | Python | What it gives |
| --- | --- | --- |
| `serviceWorkerControl(page)` | `service_worker_control(page)` | Waits until a worker controls the page (reloads once if it does not claim); `{ scope, scriptURL }` |
| `cacheContents(page)` | `cache_contents(page)` | Every cache on the origin and its sorted paths |
| `reloadOffline(page)` | `reload_offline(page)` | Cuts the connection, reloads; `{ status, fromServiceWorker }` |
| `installability(page)` | `installability(page)` | Chromium's verdict: `{ errors, manifestURL, manifestErrors }`; `errors` empty means installable |

`installability` needs full Chromium (`channel: 'chromium'`) and a persistent profile: the headless shell reports every
page installable (the helper throws there), and a fresh context in full Chromium adds `in-incognito`.

Recipe `pwa-offline` (`recipes/js/pwa-offline`, `recipes/python/pwa-offline`) uses them on the sample app's Tally PWA
(`sample_app/static/pwa/`). `adopt/adopt.py` pins this folder into adopting repositories as `test-core/pwa/`.
