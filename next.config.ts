import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.RICH_CHAT_BUILD_DIR || ".next",
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "Content-Security-Policy", value: "img-src 'self' https://imgs.search.brave.com; object-src 'none'; frame-src about:; base-uri 'self'" },
      { key: "Referrer-Policy", value: "no-referrer" },
    ] }];
  },
  turbopack: { root: process.cwd() },
  experimental: {
    turbopackMinify: false,
  },
};

export default nextConfig;
