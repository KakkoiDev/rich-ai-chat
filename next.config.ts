import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.RICH_CHAT_BUILD_DIR || ".next",
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "Content-Security-Policy", value: "img-src 'self' https://imgs.search.brave.com; object-src 'none'; frame-src about: https://www.openstreetmap.org/export/embed.html; base-uri 'self'" },
      { key: "Referrer-Policy", value: "no-referrer" },
    ] }, {
      // The shell's offline worker: always checked for a new version, and allowed no wider than the site.
      source: "/sw.js",
      headers: [
        { key: "Cache-Control", value: "no-cache" },
        { key: "Service-Worker-Allowed", value: "/" },
      ],
    }];
  },
  turbopack: { root: process.cwd() },
  experimental: {
    turbopackMinify: false,
  },
};

export default nextConfig;
