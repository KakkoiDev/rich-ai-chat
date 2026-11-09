import { z } from "zod";

const feature = z.object({
  geometry: z.object({ type: z.literal("Point"), coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-85).max(85)]) }),
  properties: z.object({ name: z.string().optional(), city: z.string().optional(), state: z.string().optional(),
    country: z.string().optional(), extent: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional() }),
});
type Location = { label: string; coordinates: [number, number]; bounds: [number, number, number, number] };
const cache = new Map<string, Location>();

export async function findMapLocation(place: string, signal: AbortSignal): Promise<Location | undefined> {
  const key = place.normalize("NFKC").toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;
  try {
    const url = new URL(process.env.RICH_CHAT_GEOCODER_URL || "https://photon.komoot.io/api/");
    url.searchParams.set("q", place);
    url.searchParams.set("limit", "1");
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(2500)]) });
    if (!response.ok) return;
    const result = feature.safeParse((await response.json())?.features?.[0]);
    if (!result.success) return;
    const { geometry: { coordinates: [lon, lat] }, properties } = result.data;
    const [x1, y1, x2, y2] = properties.extent ?? [lon - 0.04, lat - 0.03, lon + 0.04, lat + 0.03];
    const clamp = (n: number, max: number) => Math.min(max, Math.max(-max, n));
    const bounds: Location["bounds"] = [
      clamp(Math.min(x1, x2, lon - 0.004), 180), clamp(Math.min(y1, y2, lat - 0.004), 85),
      clamp(Math.max(x1, x2, lon + 0.004), 180), clamp(Math.max(y1, y2, lat + 0.004), 85),
    ];
    const label = [...new Set([properties.name || place, properties.city, properties.state, properties.country].filter(Boolean))].join(", ").slice(0, 160);
    const location: Location = { label, bounds, coordinates: [lon, lat] };
    if (cache.size >= 256) cache.delete(cache.keys().next().value!);
    cache.set(key, location);
    return location;
  } catch {
    return undefined;
  }
}
