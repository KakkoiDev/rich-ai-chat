import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "Content-Security-Policy", value: "img-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'" },
      { key: "Referrer-Policy", value: "no-referrer" },
    ] }];
  },
  turbopack: { root: process.cwd() },
  experimental: {
    turbopackMinify: false,
  },
};

export default nextConfig;
