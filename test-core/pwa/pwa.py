"""Checks for an installable web app (PWA) in Chromium through Playwright's sync API: the service worker took control,
what it cached, a reload with the network cut, and Chromium's own installability verdict. Every function takes a
Playwright Page and waits for a state, never for time. Recipe pwa-offline shows them in use; adopted repositories get
this file pinned (test-core/pwa/pwa.py). The JavaScript twin is pwa/pwa.mjs.
"""
from __future__ import annotations

_READY = """async () => {
  const ready = await navigator.serviceWorker.ready;
  return { scope: ready.scope, scriptURL: ready.active ? ready.active.scriptURL : '' };
}"""

_CACHES = """async () => {
  const contents = {};
  for (const name of await caches.keys()) {
    const requests = await (await caches.open(name)).keys();
    contents[name] = requests.map((request) => {
      const url = new URL(request.url);
      return url.origin === location.origin ? url.pathname + url.search : url.href;
    }).sort();
  }
  return contents;
}"""


def service_worker_control(page) -> dict:
    """Wait until a service worker controls the page (reloading once if it does not claim open pages).
    Returns {"scope", "scriptURL"} of the active registration."""
    registration = page.evaluate(_READY)
    if not page.evaluate("() => Boolean(navigator.serviceWorker.controller)"):
        page.reload()
    page.wait_for_function("() => Boolean(navigator.serviceWorker.controller)")
    return registration


def cache_contents(page) -> dict[str, list[str]]:
    """Everything in CacheStorage for the page's origin: {cache name: [path, ...]}, sorted; same-origin entries as
    path + query, others as full URLs. CacheStorage is per origin, so other apps' caches on that origin show too."""
    return page.evaluate(_CACHES)


def reload_offline(page) -> dict:
    """Cut the browser's connection and reload. Returns {"status", "from_service_worker"}. The connection stays cut;
    page.context.set_offline(False) brings it back."""
    page.context.set_offline(True)
    response = page.reload()
    return {"status": response.status if response else 0,
            "from_service_worker": bool(response and response.from_service_worker)}


def installability(page) -> dict:
    """Chromium's installability verdict through the DevTools protocol: {"errors": [errorId, ...], "manifest_url",
    "manifest_errors": [message, ...]}. Empty "errors" means installable. It needs full Chromium (launch with
    channel="chromium"): the headless shell answers every page with no errors, so this raises there instead of
    passing. And use a persistent context (browser_type.launch_persistent_context): full Chromium adds "in-incognito"
    in a fresh one."""
    session = page.context.new_cdp_session(page)
    try:
        if session.send("Browser.getVersion")["product"].startswith("HeadlessChrome/"):
            raise RuntimeError("Chromium's headless shell reports every page installable; "
                               "launch full Chromium with channel='chromium'.")
        errors = session.send("Page.getInstallabilityErrors")["installabilityErrors"]
        manifest = session.send("Page.getAppManifest")
        return {"errors": [error["errorId"] for error in errors], "manifest_url": manifest["url"],
                "manifest_errors": [error["message"] for error in manifest["errors"]]}
    finally:
        session.detach()
