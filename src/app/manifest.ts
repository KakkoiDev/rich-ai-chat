import type { MetadataRoute } from "next";

/** The chat as an installable app (served at /manifest.webmanifest). Icons are visual-core's, pinned in cores.lock.json. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Kakkoi Chat",
    short_name: "Kakkoi Chat",
    description: "Private chat with local models, served from your Mac over Tailscale.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#000000",
    icons: [
      { src: "/icons/kakkoi-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/kakkoi-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/kakkoi-icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/kakkoi-icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
