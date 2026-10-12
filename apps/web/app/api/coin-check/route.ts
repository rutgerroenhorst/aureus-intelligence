import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";
import { isTokenAddress, CHAIN_BY_ID } from "@/lib/chains";
import { CHECKS_PER_MINUTE, CHECK_TABS, fetchExtras, fetchFresh, judgeCoin, lastCheck, looksDead, recentCount, recordCheck } from "@/lib/coinCheck";

export const dynamic = "force-dynamic";
// DexScreener, then the test sale with RugCheck, Jupiter and the database asked together: each part has its own short timeout
export const maxDuration = 45;

const noStore = { "Cache-Control": "no-store, max-age=0" };

/**
 * The Check button: look at this coin again right now and say what is found (lib/coinCheck.ts). The site is public, so the input is validated
 * (a token address of a known network, a known tab), the same coin on the same tab is answered from the check of the last minute, and the whole
 * site does at most CHECKS_PER_MINUTE (15) checks a minute.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const chain = typeof body.chain === "string" ? body.chain : "solana";
    const tab = typeof body.tab === "string" ? body.tab : "";
    if (!CHAIN_BY_ID.has(chain) || !isTokenAddress(chain, body.mint) || !CHECK_TABS.has(tab)) return NextResponse.json({ error: "not a coin on a tab" }, { status: 400, headers: noStore });
    const mint: string = body.mint;
    const db = getPool();

    const again = await lastCheck(db, chain, mint, tab);
    if (again) return NextResponse.json({ ...again.judgement, at: again.at, tab, repeated: true }, { headers: noStore });
    if ((await recentCount(db)) >= CHECKS_PER_MINUTE) return NextResponse.json({ error: "too many checks just now; try again in a minute" }, { status: 429, headers: noStore });

    const fresh = await fetchFresh(chain, mint);
    // a coin that is dead on DexScreener's numbers needs no further proof; for the others the test sale, RugCheck, Jupiter's record and this system's memory are asked together
    const extras = fresh && fresh !== "error" && !looksDead(fresh) ? await fetchExtras(chain, mint, fresh, db) : {};
    const judgement = judgeCoin(fresh, { tab }, extras);
    const symbol = fresh && fresh !== "error" ? fresh.symbol : typeof body.symbol === "string" ? body.symbol.slice(0, 40) : null;
    // a check that could not be made (DexScreener did not answer) is not recorded: it would count as a doubt that was never looked at
    const at = fresh === "error" ? new Date().toISOString() : await recordCheck(db, { chain, mint, symbol, tab, judgement, fresh });
    return NextResponse.json({ ...judgement, at, tab }, { headers: noStore });
  } catch (err) {
    console.error("[coin-check] failed", String((err as Error)?.message ?? err).slice(0, 160));
    return NextResponse.json({ error: "the check could not be made" }, { status: 500, headers: noStore });
  }
}
