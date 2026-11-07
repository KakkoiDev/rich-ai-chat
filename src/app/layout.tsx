import type { Metadata, Viewport } from "next";
// Kakkoi web fonts (visual-core, pinned in cores.lock.json): bundled and served from this host, never a CDN.
import "../../public/theme/kakkoi-fonts.css";
import "./globals.css";


export const metadata: Metadata = {
  title: "Kakkoi Chat",
  description: "A classroom chat that answers, searches, charts and builds small apps, running on this Mac.",
  // Installable as "Kakkoi Chat" (manifest.ts); the icons are visual-core's, pinned in cores.lock.json.
  applicationName: "Kakkoi Chat",
  appleWebApp: { title: "Kakkoi Chat", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/kakkoi-icon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/icons/kakkoi-icon-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = { themeColor: [{ media: "(prefers-color-scheme: light)", color: "#ffffff" }, { media: "(prefers-color-scheme: dark)", color: "#000000" }] };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
