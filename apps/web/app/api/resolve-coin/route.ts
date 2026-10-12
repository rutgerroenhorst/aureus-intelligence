import { NextResponse } from "next/server";
import { CHAINS } from "@/lib/chains";
import { extractCandidates, pickCoin, type DexPair } from "@/lib/pasteCoin";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store, max-age=0" };
const HEADERS = { accept: "application/json", "user-agent": "Auriga-Paste/1.0" };
const DEX = "https://api.dexscreener.com/latest/dex";

/**
 * "Paste a coin" (lib/pasteCoin.ts): an address or a link in, the coin out, so the Check and the dossier can be used on a coin that is on no tab.
 * The site is public, so the input is bounded (a few hundred characters, at most three addresses tried, fixed DexScreener URLs only: nothing the
 * person typed ever becomes part of a URL except an address that matched the address shapes) and the whole site answers at most 30 pastes a minute.
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const recent: number[] = [];
const overLimit = (now: number) => {
  while (recent.length && now - recent[0]! > WINDOW_MS) recent.shift();
  if (recent.length >= MAX_PER_WINDOW) return true;
  recent.push(now);
  return false;
};

async function pairsOf(url: string): Promise<DexPair[]> {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(6000), cache: "no-store" });
    if (!res.ok) return [];
    const j = await res.json();
    return Array.isArray(j?.pairs) ? (j.pairs as DexPair[]) : [];
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > 4000) return NextResponse.json({ error: "That is too much text." }, { status: 413, headers: noStore });
    let text: unknown;
    try {
      text = JSON.parse(raw)?.text;
    } catch {
      return NextResponse.json({ error: "Not understood." }, { status: 400, headers: noStore });
    }
    const candidates = extractCandidates(text);
    if (!candidates.length) return NextResponse.json({ error: "I did not find a coin address in that. Paste the address, or a DexScreener, pump.fun or Birdeye link." }, { status: 400, headers: noStore });
    if (overLimit(Date.now())) return NextResponse.json({ error: "Too many pastes just now. Try again in a minute." }, { status: 429, headers: noStore });

    const known = new Set(CHAINS.map((c) => c.dex));
    for (const c of candidates.slice(0, 3)) {
      // 1. the address as a token, on any network
      let pairs = await pairsOf(`${DEX}/tokens/${encodeURIComponent(c.value)}`);
      let coin = pickCoin(c.value, pairs);
      // 2. a link that names the network: the address may be a pool
      if (!coin && c.chainHint && known.has(c.chainHint)) {
        pairs = await pairsOf(`${DEX}/pairs/${encodeURIComponent(c.chainHint)}/${encodeURIComponent(c.value)}`);
        coin = pickCoin(c.value, pairs);
      }
      // 3. anything else: DexScreener's own search knows pool addresses too
      if (!coin) {
        pairs = await pairsOf(`${DEX}/search?q=${encodeURIComponent(c.value)}`);
        coin = pickCoin(c.value, pairs);
      }
      if (coin) return NextResponse.json({ ok: true, coin }, { headers: noStore });
    }
    return NextResponse.json({ error: "DexScreener has no pool for that address (a new coin without a pool yet, a wallet, or a network I do not know)." }, { status: 404, headers: noStore });
  } catch (err) {
    console.error("[resolve-coin] failed", err);
    return NextResponse.json({ error: "That did not work. Try again." }, { status: 500, headers: noStore });
  }
}
