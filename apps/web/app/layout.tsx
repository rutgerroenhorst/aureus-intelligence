import type { Metadata, Viewport } from "next";
import { Jost } from "next/font/google";
import "../app/globals.css";
import "./mobile.css";
import AppShellElite from "../components/AppShellElite";
import { brand } from "@/lib/brand";

// The wordmark's typeface: Jost Bold, a free Futura look-alike. Only the wordmark uses it (WORDMARK_FONT in lib/brand.ts).
const wordmark = Jost({ subsets: ["latin"], weight: "700", display: "swap", variable: "--font-wordmark" });

export const metadata: Metadata = {
  title: brand.name,
  description: "Private Solana early-coin intelligence",
  applicationName: brand.name,
  appleWebApp: { capable: true, title: brand.name, statusBarStyle: "black-translucent" },
  icons: {
    icon: [
      { url: "/icons/auriga.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: brand.bg,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={wordmark.variable} style={{ height: "100%" }}>
      <head>
        {/* use-credentials: the site sits behind Vercel Authentication, so the manifest needs the login cookie */}
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
      </head>
      <body style={{ height: "100%", margin: 0, padding: 0, background: brand.bg, fontFamily: "'Inter', -apple-system, sans-serif" }}>
        <AppShellElite>{children}</AppShellElite>
      </body>
    </html>
  );
}
