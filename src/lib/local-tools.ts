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

const imageResponse = z.object({
  results: z.array(z.object({
    title: z.string().nullish(),
    url: z.string().nullish(),
    thumbnail: z.object({ src: z.string().nullish() }).nullish(),
  })).default([]),
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

export async function findImages(query: string, signal: AbortSignal) {
  if (!safeSearchQuery(query)) return { error: "Use a short public topic without links or personal information." } as const;
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return { error: "Image search is not configured." } as const;
  try {
    const url = new URL("https://api.search.brave.com/res/v1/images/search");
    url.search = new URLSearchParams({ q: query, count: "4", safesearch: "strict" }).toString();
    const response = await fetch(url, {
      headers: { "X-Subscription-Token": key }, redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(7000)]),
    });
    if (!response.ok) return { error: "The image search provider is unavailable." } as const;
    const parsed = imageResponse.safeParse(await response.json());
    const images = (parsed.success ? parsed.data.results : []).flatMap(result => {
      const source = httpsUrl(result.url);
      const thumbnail = httpsUrl(result.thumbnail?.src);
      if (!source || thumbnail?.origin !== "https://imgs.search.brave.com") return [];
      return [{ src: thumbnail.href, alt: result.title?.trim().slice(0, 120) || "Search result", source: source.href }];
    }).slice(0, 4);
    return images.length ? { images } : { error: "No pictures found. Try a more specific topic." } as const;
  } catch {
    return { error: "Image search failed or timed out." } as const;
  }
}
