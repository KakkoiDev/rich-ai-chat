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

export async function braveSearch(kind: "web" | "images" | "videos", query: string, key: string, signal: AbortSignal) {
  const url = new URL(`https://api.search.brave.com/res/v1/${kind}/search`);
  url.search = new URLSearchParams({ q: query, count: "4", safesearch: "strict" }).toString();
  const budget = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  const request = () => fetch(url, {
    headers: { "X-Subscription-Token": key }, redirect: "error",
    signal: AbortSignal.any([budget, AbortSignal.timeout(6500)]),
  });
  let response: Response;
  try {
    response = await request();
  } catch (error) {
    if (budget.aborted || !(error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError"))) throw error;
    await delay(250, undefined, { signal: budget });
    return request();
  }
  if (![429, 500, 502, 503, 504].includes(response.status)) return response;
  const retryHeader = response.headers.get("Retry-After");
  const retryMs = retryHeader && /^\d+$/.test(retryHeader)
    ? Number(retryHeader) * 1000 : retryHeader ? Date.parse(retryHeader) - Date.now() : 0;
  if (retryMs > 5000) return response;
  await response.body?.cancel();
  await delay(Math.max(response.status === 429 ? 1100 : 250, retryMs || 0), undefined, { signal: budget });
  return request();
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
