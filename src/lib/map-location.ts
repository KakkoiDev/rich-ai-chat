import { z } from "zod";

const feature = z.object({
  geometry: z.object({ type: z.literal("Point"), coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-85).max(85)]) }),
  properties: z.object({ name: z.string().optional(), city: z.string().optional(), state: z.string().optional(),
    country: z.string().optional(), type: z.string().optional(), extent: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional() }),
});
type Location = { label: string; coordinates: [number, number]; bounds: [number, number, number, number] };
const cache = new Map<string, Location>();

export function mapPreviewBounds(lon: number, lat: number, extent?: [number, number, number, number], type?: string): Location["bounds"] {
  // A city boundary can include outlying islands or territory. Prefer a useful city viewport in that case.
  const wideCity = type === "city" && extent && (Math.abs(extent[0] - extent[2]) > 2 || Math.abs(extent[1] - extent[3]) > 2);
  const [x1, y1, x2, y2] = wideCity ? [lon - 0.24, lat - 0.16, lon + 0.24, lat + 0.16]
    : extent ?? [lon - 0.04, lat - 0.03, lon + 0.04, lat + 0.03];
  const clamp = (n: number, max: number) => Math.min(max, Math.max(-max, n));
  return [
    clamp(Math.min(x1, x2, lon - 0.004), 180), clamp(Math.min(y1, y2, lat - 0.004), 85),
    clamp(Math.max(x1, x2, lon + 0.004), 180), clamp(Math.max(y1, y2, lat + 0.004), 85),
  ];
}

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
    const bounds = mapPreviewBounds(lon, lat, properties.extent, properties.type);
    const label = [...new Set([properties.name || place, properties.city, properties.state, properties.country].filter(Boolean))].join(", ").slice(0, 160);
    const location: Location = { label, bounds, coordinates: [lon, lat] };
    if (cache.size >= 256) cache.delete(cache.keys().next().value!);
    cache.set(key, location);
    return location;
  } catch {
    return undefined;
  }
}

type Preview = Pick<Location, "label" | "bounds">;

export function mapZoomRequest(text: string) {
  const match = /^(?:(?:please\s+)?(?:show|display|open)(?: me)? (?:the |a )?map (?:with|of|for) ([^\r\n]{1,120}?)\s+and\s+|(?:please\s+)?)(?:zoom|pull)\s+(?:(way|much|far)\s+)?(in|out)(?:\s+(a (?:little|bit|lot)|slightly|more|a great deal))?[?!. ]*$/i.exec(text);
  return match && { place: match[1]?.trim(), direction: match[3].toLowerCase() as "in" | "out",
    large: Boolean(match[2]) || /^(?:a lot|a great deal)$/i.test(match[4] ?? "") };
}

export function zoomMap(preview: Preview, direction: "in" | "out", large = false): Preview {
  const factor = large ? 4 : 1.6;
  const scale = direction === "out" ? factor : 1 / factor;
  const resize = (a: number, b: number, limit: number) => {
    const center = (a + b) / 2;
    const half = Math.min(limit, Math.max(0.0005, (b - a) * scale / 2));
    const lower = Math.min(limit - 2 * half, Math.max(-limit, center - half));
    return [lower, lower + 2 * half].map(n => Number(n.toFixed(8)));
  };
  const [west, east] = resize(preview.bounds[0], preview.bounds[2], 180);
  const [south, north] = resize(preview.bounds[1], preview.bounds[3], 85);
  return { label: preview.label, bounds: [west, south, east, north] };
}

export function mapReply(place: string, preview?: Preview) {
  const google = new URL("https://www.google.com/maps/search/");
  google.search = new URLSearchParams({ api: "1", query: place }).toString();
  const osm = new URL("https://www.openstreetmap.org/search");
  osm.searchParams.set("query", place);
  const component = preview ? `OpenStreetMap(${JSON.stringify(preview.label)}, ${preview.bounds.join(", ")}), ` : "";
  const links = `[Open in OpenStreetMap](<${osm.href}>) · [Open in Google Maps](<${google.href}>)`;
  const markdown = JSON.stringify(preview ? links : "No map preview found. Try a more specific location, or open the map search.\n\n" + links);
  return `root = Card([TextContent(${JSON.stringify(preview?.label ?? place)}, "large-heavy"), ${component}MarkDownRenderer(${markdown})])`;
}
