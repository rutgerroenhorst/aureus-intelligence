import { NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";
import { egressOver } from "@/lib/cloudScan";

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
  runners: "/api/runners",
  graduates: "/api/graduates",
  checks: "/api/coin-checks",
} as const;

// Shared by every device that asks within the window, so a second phone or tablet costs no extra CPU. One build reads about 200 KB from the
// hosted database (more than 1 MB on the laptop's much bigger one), and that is what Supabase's free plan counts as egress (5 GB a month), so
// on the hosted site the answer is kept for a minute, and for five when today's egress allowance is used up.
const TTL_MS = process.env.VERCEL ? 60_000 : 15_000;
const TTL_OVER_BUDGET_MS = 5 * 60_000;
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
  const ttl = process.env.VERCEL && (await egressOver().catch(() => false)) ? TTL_OVER_BUDGET_MS : TTL_MS;
  if (!memo || Date.now() - memo.at > ttl) {
    inflight ??= build().finally(() => {
      inflight = null;
    });
    await inflight;
  }
  // The edge may keep a complete answer for half a minute (every request it answers is a function that does not run); an incomplete one is never kept.
  const complete = memo!.at > 0 && !memo!.body.includes('"failed":["');
  return new NextResponse(memo!.body, {
    headers: { "content-type": "application/json", "cache-control": process.env.VERCEL && complete ? "public, s-maxage=30, stale-while-revalidate=30" : "no-store" },
  });
}
