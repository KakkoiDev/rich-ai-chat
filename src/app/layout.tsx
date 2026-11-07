import type { Metadata, Viewport } from "next";
import "./globals.css";


export const metadata: Metadata = {
  title: "KakkoiSchool Rich Chat",
  description: "Generative UI chat with the Vercel AI SDK and Agent Interface",
  // Installable as "Kakkoi Chat" (manifest.ts); the icons are visual-core's, pinned in cores.lock.json.
  applicationName: "Kakkoi Chat",
  appleWebApp: { title: "Kakkoi Chat", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/kakkoi-icon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/icons/kakkoi-icon-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = { themeColor: "#000000" };

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
