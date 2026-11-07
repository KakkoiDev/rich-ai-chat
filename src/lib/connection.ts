/**
 * Is the chat's host reachable from this device, and if not, why (best effort)? The chat is served privately over
 * Tailscale, so three failures look different to a phone:
 * - offline: the device has no network (navigator.onLine is false);
 * - tailscale: the request failed at once on a tailnet address, which is what a name that no longer resolves
 *   (Tailscale switched off) looks like;
 * - unreachable: the host answered with an error (the chat server is down behind Tailscale Serve), or nothing
 *   answered in time (the Mac is asleep or off), or the server is down on a local address.
 */
export type Reachability = "online" | "offline" | "tailscale" | "unreachable";

/** A failure faster than this is a refusal or a name that did not resolve, not a host that never answered. */
export const fastFailureMs = 1500;
export const healthTimeoutMs = 6000;

/** *.ts.net names and Tailscale's 100.64.0.0/10 addresses. */
export function isTailnetHost(hostname: string) {
  if (/\.ts\.net\.?$/i.test(hostname)) return true;
  const octets = /^100\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(hostname);
  return !!octets && Number(octets[1]) >= 64 && Number(octets[1]) <= 127;
}

export function classifyConnection({ online, status, elapsedMs, hostname }: {
  online: boolean; status?: number; elapsedMs: number; hostname: string;
}): Reachability {
  if (!online) return "offline";
  if (status !== undefined) return status >= 200 && status < 300 ? "online" : "unreachable";
  return elapsedMs < fastFailureMs && isTailnetHost(hostname) ? "tailscale" : "unreachable";
}

/** Ask the host's health route (never cached, never through the offline cache) and classify the answer. */
export async function checkConnection({ fetcher = fetch, online = navigator.onLine, hostname = location.hostname,
  now = () => performance.now(), timeoutMs = healthTimeoutMs } = {}): Promise<Reachability> {
  if (!online) return "offline";
  const started = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher("/api/health", { cache: "no-store", signal: controller.signal });
    return classifyConnection({ online, status: response.status, elapsedMs: now() - started, hostname });
  } catch {
    return classifyConnection({ online, elapsedMs: now() - started, hostname });
  } finally {
    clearTimeout(timer);
  }
}

export const reachabilityText: Record<Exclude<Reachability, "online">, { title: string; detail: string }> = {
  offline: { title: "You're offline", detail: "This device has no network connection. Your chats are still here." },
  tailscale: { title: "Can't reach the chat", detail: "Tailscale may be off on this device. Turn it on, then retry." },
  unreachable: { title: "The chat's host isn't answering", detail: "The Mac may be asleep or the chat server stopped. Retry when it's back." },
};
