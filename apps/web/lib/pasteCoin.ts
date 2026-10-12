/**
 * Pasting a coin (the box at the top of the Radar and Home): what a person pastes is an address, or a link that contains one (DexScreener, pump.fun, Birdeye,
 * Solscan, GMGN ...). So the rule is simple: pull every address-shaped piece out of the text, then ask DexScreener what it is. A DexScreener link names the
 * network, and holds a POOL address as often as a token address, so the lookup (pickCoin) accepts both.
 */
import { CHAINS } from "./chains";

export interface Candidate {
  value: string;
  /** the network when a DexScreener link names it (DexScreener's own id, such as "solana", "base" or "bsc") */
  chainHint?: string;
}

const B58 = "1-9A-HJ-NP-Za-km-z";
const MAX_TEXT = 600;
const MAX_CANDIDATES = 4;

/** Every piece of the text that could be a coin address, in the order the person gave them, DexScreener links first (they know the network). */
export function extractCandidates(text: unknown): Candidate[] {
  const t = typeof text === "string" ? text.slice(0, MAX_TEXT) : "";
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const add = (value: string, chainHint?: string) => {
    const key = value.startsWith("0x") ? value.toLowerCase() : value;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(chainHint ? { value, chainHint } : { value });
  };
  for (const m of t.matchAll(new RegExp(`dexscreener\\.com/([a-z0-9-]+)/(0x[0-9a-fA-F]{40}|[${B58}]{32,44})`, "gi"))) add(m[2]!, m[1]!.toLowerCase());
  for (const m of t.matchAll(/(?<![0-9a-zA-Z])0x[0-9a-fA-F]{40}(?![0-9a-zA-Z])/g)) add(m[0]);
  for (const m of t.matchAll(new RegExp(`(?<![${B58}])[${B58}]{32,44}(?![${B58}])`, "g"))) add(m[0]);
  return out.slice(0, MAX_CANDIDATES);
}

/** The parts of a DexScreener pair that the lookup reads. */
export interface DexPair {
  chainId?: string;
  pairAddress?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string | number | null;
  liquidity?: { usd?: number | null } | null;
  marketCap?: number | null;
  fdv?: number | null;
  pairCreatedAt?: number | null;
}

/** The coin a paste resolved to: what the card needs and what the Check and the journal take (our network id, the token address). */
export interface Resolved {
  chain: string;
  mint: string;
  symbol: string;
  name: string;
  pair: string;
  priceUsd: number | null;
  mcap: number | null;
  liq: number | null;
  ageH: number | null;
}

/** The money side of a pair: when the pasted pool address is a pool of SOL/USDC/ETH against a coin, the coin is the other side. */
const QUOTE_SYMBOLS = new Set(["SOL", "WSOL", "USDC", "USDT", "WETH", "ETH", "WBNB", "BNB", "WMON", "MON", "DAI", "USD1"]);

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/**
 * Which coin is this address? The address can be the token itself (on either side of a pool), or a pool. Tokens win over pools; among the pools of a
 * token the deepest one wins; pools on networks the Radar does not know are ignored (null when nothing is left).
 */
export function pickCoin(value: string, pairs: DexPair[] | null | undefined, nowMs = Date.now()): Resolved | null {
  const evm = value.startsWith("0x");
  const same = (a: string | undefined) => (a ? (evm ? a.toLowerCase() === value.toLowerCase() : a === value) : false);
  const ours = (p: DexPair) => CHAINS.find((c) => c.dex === p.chainId);
  const usable = (pairs ?? []).filter((p) => p && ours(p) && p.baseToken?.address && p.quoteToken?.address);
  const deepest = (l: DexPair[]) => [...l].sort((a, b) => (num(b.liquidity?.usd) ?? 0) - (num(a.liquidity?.usd) ?? 0))[0];

  const asBase = usable.filter((p) => same(p.baseToken!.address));
  const asQuote = usable.filter((p) => same(p.quoteToken!.address));
  const asPool = usable.filter((p) => same(p.pairAddress));
  let pair: DexPair | undefined;
  let side: "base" | "quote" = "base";
  if (asBase.length) pair = deepest(asBase);
  else if (asQuote.length) {
    pair = deepest(asQuote);
    side = "quote";
  } else if (asPool.length) {
    pair = deepest(asPool);
    // a pool link: the coin is the base token unless that side is the money
    if (QUOTE_SYMBOLS.has((pair!.baseToken!.symbol ?? "").toUpperCase()) && !QUOTE_SYMBOLS.has((pair!.quoteToken!.symbol ?? "").toUpperCase())) side = "quote";
  }
  if (!pair) return null;
  const token = side === "base" ? pair.baseToken! : pair.quoteToken!;
  const created = num(pair.pairCreatedAt);
  return {
    chain: ours(pair)!.id,
    mint: token.address!,
    symbol: token.symbol ?? "?",
    name: token.name ?? "",
    pair: pair.pairAddress ?? "",
    priceUsd: side === "base" ? num(pair.priceUsd) : null,
    mcap: side === "base" ? num(pair.marketCap) ?? num(pair.fdv) : null,
    liq: num(pair.liquidity?.usd),
    ageH: created ? Math.max(0, (nowMs - created) / 3_600_000) : null,
  };
}
