import type { Metadata } from "next";
import "../app/globals.css";
import AppShellElite from "../components/AppShellElite";

export const metadata: Metadata = {
  title: "Aureus Intelligence",
  description: "Private Solana early-coin intelligence — elite",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" style={{ height: "100%" }}>
      <head />
      <body style={{ height: "100%", margin: 0, padding: 0, background: "#0a0908", fontFamily: "'Inter', -apple-system, sans-serif" }}>
        <AppShellElite>{children}</AppShellElite>
      </body>
    </html>
  );
}
