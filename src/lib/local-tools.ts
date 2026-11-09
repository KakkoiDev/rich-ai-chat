import { setTimeout as delay } from "node:timers/promises";
import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

export function currentDateTime(timeZone: string, daysFromToday = 0, now = Temporal.Now.instant()) {
  // Require a named zone or UTC; offsets such as +09:00 cannot account for DST.
  if (timeZone.length > 80 || !/^[A-Za-z][A-Za-z0-9_+/-]*$/.test(timeZone)) return null;
  try {
    const current = now.toZonedDateTimeISO(timeZone);
    const date = current.toPlainDate().add({ days: daysFromToday });
    return {
      timeZone: current.timeZoneId,
      date: date.toString(),
      weekday: date.toLocaleString("en", { weekday: "long" }),
      ...(daysFromToday === 0 && {
        time: current.toPlainTime().toString({ smallestUnit: "second" }),
        utcOffset: current.offset,
      }),
    };
  } catch {
    return null;
  }
}

/** Keep the model's clock tool output stable for exact-match benchmark recordings. */
export function modelClock(timeZone: string, daysFromToday = 0) {
  const fixed = process.env.RICH_CHAT_PAID_PROXY && process.env.RICH_CHAT_EVAL_CLOCK;
  return currentDateTime(timeZone, daysFromToday, fixed ? Temporal.Instant.from(fixed) : undefined);
}

const mediaResult = z.object({
  title: z.string().nullish(),
  url: z.string().nullish(),
  thumbnail: z.object({ src: z.string().nullish() }).nullish(),
  video: z.object({ duration: z.string().nullish() }).nullish(),
});

export function safeSearchQuery(query: string) {
  return query.length >= 3 && query.length <= 160 && !/@|https?:|[\r\n]|(?:\d[ .()+-]*){7}/i.test(query);
}

function httpsUrl(value: string | null | undefined) {
  if (!value || value.length > 2048 || /[\s<>"\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

/**
 * The first answer from a hedged request: one attempt now, another after each `hedgeAfterMs` delay while none has
 * answered, and the next one at once after a connection error. A hung connection (Brave's slow tail) then costs a few
 * seconds instead of the whole budget. The first response wins and the others are cancelled.
 */
function firstResponse(url: URL, key: string, budget: AbortSignal, hedgeAfterMs: number[], signal: AbortSignal, budgetMs: number) {
  return new Promise<Response>((resolve, reject) => {
    const attempts: AbortController[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    let settled = false;
    let failed = 0;
    const done = (finish: () => void) => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      budget.removeEventListener("abort", stop);
      finish();
    };
    const errors: string[] = [];
    const describe = (why: string) => new Error(`${attempts.length} attempt${attempts.length === 1 ? "" : "s"}, ${[...errors, why].join(", ")}`);
    const stop = () => done(() => {
      for (const attempt of attempts) attempt.abort();
      reject(describe(signal.aborted ? "cancelled" : `no answer within ${budgetMs / 1000} s`));
    });
    const start = () => {
      if (settled || attempts.length > hedgeAfterMs.length) return;
      const attempt = new AbortController();
      attempts.push(attempt);
      fetch(url, { headers: { "X-Subscription-Token": key }, redirect: "error", signal: AbortSignal.any([budget, attempt.signal]) })
        .then(response => done(() => {
          for (const other of attempts) if (other !== attempt) other.abort();
          resolve(response);
        }), (error: unknown) => {
          if (settled) return;
          const transient = error instanceof TypeError || (error instanceof DOMException && error.name === "AbortError" && !budget.aborted);
          failed++;
          errors.push(error instanceof Error ? (error.cause instanceof Error ? `${error.name}: ${error.cause.message}` : error.name) : "error");
          if (budget.aborted || !transient) return done(() => { for (const other of attempts) other.abort(); reject(error); });
          if (failed === attempts.length && attempts.length > hedgeAfterMs.length) return done(() => reject(describe("all failed")));
          start();
        });
    };
    budget.addEventListener("abort", stop, { once: true });
    start();
    for (const delayMs of hedgeAfterMs) timers.push(setTimeout(start, delayMs));
  });
}

export async function braveSearch(kind: "web" | "images" | "videos", query: string, key: string, signal: AbortSignal,
  timing = { hedgeAfterMs: [3000, 8000], budgetMs: 15000 }) {
  const url = new URL(`/res/v1/${kind}/search`, process.env.RICH_CHAT_PAID_PROXY || "https://api.search.brave.com");
  url.search = new URLSearchParams({ q: query, count: "4", safesearch: "strict" }).toString();
  const budget = AbortSignal.any([signal, AbortSignal.timeout(timing.budgetMs)]);
  const response = await firstResponse(url, key, budget, timing.hedgeAfterMs, signal, timing.budgetMs);
  if (![429, 500, 502, 503, 504].includes(response.status)) return response;
  const retryHeader = response.headers.get("Retry-After");
  const retryMs = retryHeader && /^\d+$/.test(retryHeader)
    ? Number(retryHeader) * 1000 : retryHeader ? Date.parse(retryHeader) - Date.now() : 0;
  if (retryMs > 5000) return response;
  await response.body?.cancel();
  await delay(Math.max(response.status === 429 ? 1100 : 250, retryMs || 0), undefined, { signal: budget });
  return firstResponse(url, key, budget, [], signal, timing.budgetMs);
}

async function searchMedia(kind: "images" | "videos", query: string, signal: AbortSignal) {
  const label = kind === "images" ? "Image" : "Video";
  if (!safeSearchQuery(query)) return { error: "Use a short public topic without links or personal information." } as const;
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return { error: `${label} search is not configured.` } as const;
  try {
    const response = await braveSearch(kind, query, key, signal);
    if (!response.ok) return { error: `${label} search is unavailable right now.` } as const;
    const parsed = z.object({ results: z.array(z.unknown()).default([]) }).safeParse(await response.json());
    return { results: (parsed.success ? parsed.data.results : []).flatMap(result => {
      const item = mediaResult.safeParse(result);
      if (!item.success) return [];
      const source = httpsUrl(item.data.url);
      if (!source) return [];
      const thumbnail = httpsUrl(item.data.thumbnail?.src);
      return [{
        source: source.href,
        title: item.data.title?.trim().slice(0, 120),
        thumbnail: thumbnail?.origin === "https://imgs.search.brave.com" ? thumbnail.href : undefined,
        duration: item.data.video?.duration,
      }];
    }) };
  } catch {
    return { error: `${label} search failed or timed out.` } as const;
  }
}

export async function findImages(query: string, signal: AbortSignal) {
  const result = await searchMedia("images", query, signal);
  if (!result.results) return { error: result.error } as const;
  const images = result.results.flatMap(({ source, thumbnail, title }) =>
    thumbnail ? [{ source, src: thumbnail, alt: title || "Search result" }] : []).slice(0, 4);
  return images.length ? { images } : { error: "No pictures found. Try a more specific topic." } as const;
}

export async function findVideos(query: string, signal: AbortSignal) {
  const result = await searchMedia("videos", query, signal);
  if (!result.results) return { error: result.error } as const;
  const seen = new Set<string>();
  const videos = result.results.flatMap(({ source, thumbnail, title, duration }) => {
    if (seen.has(source)) return [];
    seen.add(source);
    return [{
      source, thumbnail, title: title || new URL(source).hostname,
      duration: duration && /^(?:\d{1,2}:)?\d{1,2}:\d{2}$/.test(duration) ? duration : undefined,
    }];
  }).slice(0, 3);
  return videos.length ? { videos } : { error: "No videos found. Try a more specific topic." } as const;
}

/** "Look up the year X opened, and cite your source." -> "the year X opened". */
export function explicitSearchQuery(request: string) {
  const verb = /^\s*(?:(?:please|can you|could you)\s+)*(?:search(?: the web| online)?(?: for)?|look up)\s+/i;
  if (!verb.test(request)) return undefined;
  const query = request.trim()
    .replace(verb, "")
    .replace(/[,;]?\s*(?:and\s+)?(?:please\s+)?(?:cite|include|give|add)\s+(?:your|a|the)?\s*(?:sources?|links?|citations?)[^.?!]*[.?!]*\s*$/i, "")
    .replace(/[.?!\s]+$/, "").slice(0, 160).trim();
  return query.length >= 3 ? query : undefined;
}
