import type { Metadata, Viewport } from "next";
import "../app/globals.css";
import "./mobile.css";
import AppShellElite from "../components/AppShellElite";

export const metadata: Metadata = {
  title: "Aureus Intelligence",
  description: "Private Solana early-coin intelligence — elite",
  applicationName: "Aureus",
  appleWebApp: { capable: true, title: "Aureus", statusBarStyle: "black-translucent" },
  icons: {
    icon: [
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
  themeColor: "#0a0908",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" style={{ height: "100%" }}>
      <head>
        {/* use-credentials: the site sits behind Vercel Authentication, so the manifest needs the login cookie */}
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
      </head>
      <body style={{ height: "100%", margin: 0, padding: 0, background: "#0a0908", fontFamily: "'Inter', -apple-system, sans-serif" }}>
        <AppShellElite>{children}</AppShellElite>
      </body>
    </html>
  );
}
