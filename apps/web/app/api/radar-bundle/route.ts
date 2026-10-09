import { NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";

export const dynamic = "force-dynamic";

// Everything the Radar page needs, in ONE request. It used to call these twelve routes itself every
// 10 s, which is ~3.4M requests a month for a single open tab against Vercel's free 1M.
const SOURCES = {
  candidates: "/api/candidates",
  elite: "/api/elite-validator",
  ultraEarly: "/api/ultra-early",
  ultraEarlyMomentum: "/api/ultra-early-momentum",
  incubation: "/api/incubation",
  cate: "/api/cate-hunter",
  signals: "/api/signals",
  positions: "/api/positions",
  trends: "/api/trends",
  momentum: "/api/momentum",
  performance: "/api/performance",
  networks: "/api/network-sentiment",
} as const;

// Shared by every device that asks within the window, so a second phone or tablet costs no extra CPU.
const TTL_MS = 15_000;
let memo: { at: number; body: string } | null = null;
let inflight: Promise<void> | null = null;

async function build(): Promise<void> {
  const entries = await Promise.all(
    Object.entries(SOURCES).map(async ([key, path]) => {
      try {
        const res = await internalFetch(path, { cache: "no-store" });
        return [key, res.ok ? await res.json() : null] as const;
      } catch {
        return [key, null] as const;
      }
    }),
  );
  // Health of the live safety check, so the page can warn when coins passed WITHOUT being checked.
  // (The gate result is already computed and shared by the routes above, so this costs nothing extra.)
  let safety: { total: number; safe: number; rejected: number; unverified: number; noData: number } | null = null;
  try {
    const res = await internalFetch("/api/safety-gate", { cache: "no-store" });
    if (res.ok) {
      const g = await res.json();
      safety = {
        total: g.total ?? 0,
        safe: g.safe ?? 0,
        rejected: g.rejected ?? 0,
        unverified: g.unverified ?? 0,
        noData: g.no_data ?? 0,
      };
    }
  } catch {
    safety = null;
  }
  // A source that failed comes back as null. Say so: the page used to print "refreshed" over lists that were
  // actually empty because the database was busy.
  const failed = entries.filter(([, v]) => v == null).map(([k]) => k);
  memo = {
    // A mostly failed answer must not be served for the next 15 s: back-date it so the next request retries.
    at: failed.length > entries.length / 2 ? 0 : Date.now(),
    body: JSON.stringify({ at: new Date().toISOString(), failed, data: { ...Object.fromEntries(entries), safety } }),
  };
}

export async function GET() {
  if (!memo || Date.now() - memo.at > TTL_MS) {
    inflight ??= build().finally(() => {
      inflight = null;
    });
    await inflight;
  }
  return new NextResponse(memo!.body, {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
