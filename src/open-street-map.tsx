"use client";

import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";

export const OpenStreetMap = defineComponent({
  name: "OpenStreetMap",
  description: "Map preview for a place with known bounds, in west, south, east, north order. Never guess bounds.",
  props: z.object({
    label: z.string().max(160),
    west: z.number().min(-180).max(180),
    south: z.number().min(-85).max(85),
    east: z.number().min(-180).max(180),
    north: z.number().min(-85).max(85),
  }),
  component: ({ props: { label, west, south, east, north } }) => {
    if (west >= east || south >= north) return null;
    const url = new URL("https://www.openstreetmap.org/export/embed.html");
    url.search = new URLSearchParams({ bbox: [west, south, east, north].join(","), layer: "mapnik" }).toString();
    return <iframe title={`Map of ${label} — OpenStreetMap`} src={url.href} loading="lazy"
      sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer"
      style={{ width: "100%", height: 300, border: 0, borderRadius: 8 }} />;
  },
});
