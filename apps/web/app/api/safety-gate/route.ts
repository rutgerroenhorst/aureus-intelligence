import { internalFetch } from "@/lib/internalFetch";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CACHE_TTL = 15000; // 15s cache for real-time dump detection
const STALE_OK_MS = 5 * 60_000; // if DexScreener fails, a check at most this old is still better than none
const MEMO_TTL = 10_000; // all callers within this window share one computation
const BATCH_SIZE = 30; // DexScreener accepts up to 30 token addresses per request
const BATCH_PARALLEL = 3; // DexScreener allows ~300 requests/min per IP; never fire hundreds at once
const REQUEST_TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 3;
const DEADLINE_MS = 20_000; // stop fetching after this long; the rest is reported as unverified

interface DumpCheck {
  hasRug: boolean;
  hasActiveDump: boolean;
  riskScore: number;
  reasons: string[];
}

// ok: checked now | stale: DexScreener failed, reusing a recent check | no_data: DexScreener has no pair
// | unverified: could not be checked (the coin is NOT proven safe, it just was not rejected)
type CheckStatus = "ok" | "stale" | "no_data" | "unverified";

interface CheckResult {
  check: DumpCheck;
  txns?: any;
  status: CheckStatus;
}

const dumpCheckCache = new Map<string, { data: CheckResult; time: number }>();

const noRisk = (): DumpCheck => ({ hasRug: false, hasActiveDump: false, riskScore: 0, reasons: [] });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The detection rules. Unchanged: only the way the data is fetched was reworked.
function evaluatePair(pair: any): CheckResult {
  const check: DumpCheck = noRisk();

  // Log sample data for debugging
  if (pair.baseToken?.symbol === "DIFF") {
    console.log(`[DIFF_DEBUG] m5=${pair.priceChange?.m5}, h1=${pair.priceChange?.h1}, h6=${pair.priceChange?.h6}, h24=${pair.priceChange?.h24}`);
  }

  const m5Txns = pair.txns?.m5;
  const m5Price = pair.priceChange?.m5;

  if (m5Txns && m5Price !== null && m5Price !== undefined) {
    const ratio = m5Txns.sells / Math.max(m5Txns.buys, 1);
    // AGGRESSIVE: catch any massive crash in m5
    if (ratio > 4 && m5Price < -50) {
      check.hasRug = true;
      check.riskScore = 99;
      check.reasons.push("EXTREME_DUMP: Massive sell surge + collapse");
    } else if (ratio > 3 && m5Price < -40) {
      check.hasActiveDump = true;
      check.riskScore = 90;
      check.reasons.push("ACTIVE_DUMP: Severe sell surge + price drop");
    } else if (m5Price < -70) {
      // ANY crash >70% in m5 = rug pull
      check.hasRug = true;
      check.riskScore = 95;
      check.reasons.push(`M5_CRASH: ${Math.round(m5Price)}% drop in 5m`);
    }
  }

  const h1Txns = pair.txns?.h1;
  const h1Price = pair.priceChange?.h1;
  if (h1Txns && h1Price !== null && h1Price !== undefined && !check.hasRug && !check.hasActiveDump) {
    const ratio = h1Txns.sells / Math.max(h1Txns.buys, 1);
    if (ratio > 3.5 && h1Price < -60) {
      check.hasRug = true;
      check.riskScore = 95;
      check.reasons.push("SUSTAINED_RUG: Extreme 1h pattern");
    } else if (h1Price < -70) {
      // ANY crash >70% in h1 = rug pull
      check.hasRug = true;
      check.riskScore = 93;
      check.reasons.push(`H1_CRASH: ${Math.round(h1Price)}% drop in 1h`);
    }
  }

  // FALLBACK: If m5/h1/h6 priceChange unavailable, use m5 txn ratio as indicator
  if (!m5Price && m5Txns && m5Txns.buys) {
    const m5Ratio = m5Txns.sells / Math.max(m5Txns.buys, 1);
    if (m5Ratio > 5) {
      // Extreme sell/buy ratio indicates active dump
      check.hasRug = true;
      check.riskScore = 94;
      check.reasons.push(`TXNS_DUMP: Sell/buy ratio ${m5Ratio.toFixed(1)}x in 5m`);
      console.log(`[SAFETY] TXNS DUMP: ${pair.baseToken?.symbol} m5 ratio=${m5Ratio.toFixed(1)}x`);
    }
  }

  // 6H EXTREME COLLAPSE - catches recent rug pulls
  const h6Price = pair.priceChange?.h6;
  if (h6Price !== null && h6Price !== undefined && h6Price < -70) {
    check.hasRug = true;
    check.riskScore = 97;
    check.reasons.push(`RUG_PULL: Crashed ${Math.round(h6Price)}% in 6h`);
    console.log(`[SAFETY] RUG DETECTED: ${pair.baseToken?.symbol} h6=${h6Price}%`);
  }

  // HISTORICAL PRICE COLLAPSE (24h) - catches dead coins
  const h24Price = pair.priceChange?.h24;
  if (h24Price !== null && h24Price !== undefined && h24Price < -80) {
    check.hasRug = true;
    check.riskScore = 98;
    check.reasons.push(`DEAD_COIN: Crashed ${Math.round(h24Price)}% in 24h`);
    console.log(`[SAFETY] DEAD COIN DETECTED: ${pair.baseToken?.symbol} h24=${h24Price}%`);
  }

  return {
    check,
    txns: {
      m5: pair.txns?.m5,
      h1: pair.txns?.h1,
      h6: pair.txns?.h6,
      h24: pair.txns?.h24,
    },
    status: "ok",
  };
}

/**
 * One DexScreener request for up to 30 mints, with retry on rate limits / server errors. null = gave up.
 * Uses tokens/v1/{chain}/{addresses} (the same endpoint the worker uses), which returns one pair per token.
 * The older latest/dex/tokens endpoint caps the WHOLE response at 30 pairs, so in a batch most coins got none.
 */
async function fetchBatch(mints: string[], deadline: number): Promise<any[] | null> {
  const url = `https://api.dexscreener.com/tokens/v1/solana/${mints.join(",")}`;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (Date.now() > deadline) return null;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (res.ok) {
        const data = await res.json();
        return Array.isArray(data) ? data : [];
      }
      if (res.status !== 429 && res.status < 500) return null; // other 4xx: retrying will not help
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 3000) : 400 * attempt);
    } catch {
      await sleep(300 * attempt);
    }
  }
  return null;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** Dump checks for many mints at once: cached, batched, rate-limit friendly. */
async function checkDumpPatterns(mints: string[]): Promise<Map<string, CheckResult>> {
  const results = new Map<string, CheckResult>();
  const now = Date.now();
  const todo: string[] = [];
  for (const mint of new Set(mints)) {
    const cached = dumpCheckCache.get(mint);
    if (cached && now - cached.time < CACHE_TTL) results.set(mint, cached.data);
    else todo.push(mint);
  }

  const chunks: string[][] = [];
  for (let i = 0; i < todo.length; i += BATCH_SIZE) chunks.push(todo.slice(i, i + BATCH_SIZE));
  const deadline = now + DEADLINE_MS;

  await mapPool(chunks, BATCH_PARALLEL, async (chunk) => {
    const pairs = await fetchBatch(chunk, deadline);
    for (const mint of chunk) {
      if (pairs === null) {
        const old = dumpCheckCache.get(mint);
        if (old && Date.now() - old.time < STALE_OK_MS) results.set(mint, { ...old.data, status: "stale" });
        else results.set(mint, { check: noRisk(), status: "unverified" });
        continue;
      }
      // best (deepest) pair of this token; a token can be the base or, rarely, the quote of a pair
      let best: any = null;
      for (const p of pairs) {
        const isBase = p.baseToken?.address === mint;
        const isQuote = p.quoteToken?.address === mint;
        if (!isBase && !isQuote) continue;
        const score = (p.liquidity?.usd ?? 0) + (isBase ? 1e-9 : 0);
        if (!best || score > best.score) best = { p, score };
      }
      const result: CheckResult = best ? evaluatePair(best.p) : { check: noRisk(), status: "no_data" };
      dumpCheckCache.set(mint, { data: result, time: Date.now() });
      results.set(mint, result);
    }
  });
  return results;
}

let memo: { at: number; body: any } | null = null;
let inflight: Promise<void> | null = null;

async function compute(): Promise<void> {
  try {
    const res = await internalFetch(`/api/candidates`, {
      cache: "no-store",
    });

    if (!res.ok) {
      memo = null;
      return;
    }

    const data = await res.json();
    const candidates = data.candidates || [];

    const safeCandidates = candidates.filter((c: any) => {
      const mcap = Number(c.marketCapUsd || 0);
      const liq = Number(c.liquidityUsd || 0);

      if (mcap < 1000 || liq < 1000) return false;

      if (
        c.tokenSupply &&
        Number(c.tokenSupply) > 1e12 &&
        Number(c.decimals || 6) <= 6
      ) {
        return false;
      }

      if (mcap > 0) {
        const liqRatio = liq / mcap;
        if (liqRatio < 0.005 && liq < 10000) return false;
      }

      const topHolders = c.topHolders || [];
      if (topHolders.length >= 5) {
        const top5Sum = topHolders
          .slice(0, 5)
          .reduce((sum: number, h: any) => sum + Number(h.pct || 0), 0);
        if (top5Sum > 0.85) return false;
      }

      if (topHolders.length > 0 && topHolders[0].pct > 0.7) return false;

      return true;
    });

    // Live dump checks for all remaining candidates, batched
    const dumpResults = await checkDumpPatterns(safeCandidates.map((c: any) => c.mint));

    let unverified = 0;
    let noData = 0;
    const filteredCandidates = safeCandidates.filter((c: any) => {
      const result = dumpResults.get(c.mint);
      if (!result) return true;
      c.txns = result.txns;
      c.dumpCheck = result.status;
      if (result.status === "unverified") unverified++;
      if (result.status === "no_data") noData++;

      // Reject coins with active dumps or rugs
      if (result.check.hasRug || result.check.hasActiveDump) {
        console.log(`[SAFETY-GATE] FILTERED OUT: ${c.symbol} - ${result.check.reasons.join(", ")}`);
        return false;
      }
      return true;
    });

    console.log(`[SAFETY-GATE] Input: ${safeCandidates.length}, Output: ${filteredCandidates.length}, unverified: ${unverified}`);

    memo = {
      at: Date.now(),
      body: {
        safe_candidates: filteredCandidates,
        total: candidates.length,
        safe: filteredCandidates.length,
        rejected: candidates.length - filteredCandidates.length,
        // coins that passed only because the live check could not run (DexScreener busy/down)
        unverified,
        // coins DexScreener has no market data for (nothing to check)
        no_data: noData,
      },
    };
  } catch (err) {
    console.error("Safety gate error:", err);
    memo = null;
  }
}

export async function GET(request: Request) {
  // Four other routes call this one on every Radar update: share a single computation between them.
  if (!memo || Date.now() - memo.at > MEMO_TTL) {
    inflight ??= compute().finally(() => {
      inflight = null;
    });
    await inflight;
  }
  if (!memo) return NextResponse.json({ safe_candidates: [] });
  return NextResponse.json(memo.body, { headers: { "Cache-Control": "no-store, max-age=30" } });
}
