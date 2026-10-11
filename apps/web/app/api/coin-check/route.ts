import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";
import { isTokenAddress, CHAIN_BY_ID } from "@/lib/chains";
import { CHECKS_PER_MINUTE, CHECK_TABS, fetchFresh, judgeCoin, lastCheck, recentCount, recordCheck } from "@/lib/coinCheck";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const noStore = { "Cache-Control": "no-store, max-age=0" };

/**
 * The Check button: look at this coin again right now and say what is found (lib/coinCheck.ts). The site is public, so the input is validated
 * (a token address of a known network, a known tab), the same coin on the same tab is answered from the check of the last minute, and the whole
 * site does at most 30 checks a minute.
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
    const judgement = judgeCoin(fresh, { tab });
    const symbol = fresh && fresh !== "error" ? fresh.symbol : typeof body.symbol === "string" ? body.symbol.slice(0, 40) : null;
    // a check that could not be made (DexScreener did not answer) is not recorded: it would count as a doubt that was never looked at
    const at = fresh === "error" ? new Date().toISOString() : await recordCheck(db, { chain, mint, symbol, tab, judgement, fresh });
    return NextResponse.json({ ...judgement, at, tab }, { headers: noStore });
  } catch (err) {
    console.error("[coin-check] failed", String((err as Error)?.message ?? err).slice(0, 160));
    return NextResponse.json({ error: "the check could not be made" }, { status: 500, headers: noStore });
  }
}
