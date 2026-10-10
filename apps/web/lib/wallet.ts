/**
 * What a Solana wallet bought and sold, read from the chain with only its PUBLIC address (no key, no seed phrase, nothing to sign).
 *
 *   rpc / fetchSignatures / fetchTransaction   free public RPC endpoints, tried in turn, with back-off
 *   decodeFills                                one transaction -> the buys and sells of this wallet in it
 *   aggregatePositions                         fills -> one position per coin (cost, proceeds, what is still held)
 *
 * A swap shows up as balance changes of the wallet in one transaction: a coin goes up while SOL, wrapped SOL, USDC or USDT goes
 * down (a buy), or the other way round (a sell). Gasless swaps (the fee is paid by the router) leave the wallet's SOL untouched,
 * so USDC and USDT count as quote money next to SOL. Money spent on opening a token account is rent that comes back when the account
 * is closed, so it is taken out of the price.
 *
 * Everything is read-only. The wallet address is the user's own and is kept in the local database, never in the repository.
 */

export const WSOL = "So11111111111111111111111111111111111111112";
export const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNyFxjs1mwSyJb2gy";
const STABLES = new Set([USDC, USDT]);

/**
 * Free public endpoints. PublicNode is quick but keeps only the last day or so of signatures and transactions; the official endpoint
 * has the whole history but is slower and rate limited. Signature lists therefore ask the official one first, and a transaction a node
 * does not have makes the call move on to the next node.
 */
const PUBLICNODE = "https://solana-rpc.publicnode.com";
const OFFICIAL = "https://api.mainnet-beta.solana.com";
/** The network now has transaction version 1: asking for less makes the node refuse those transactions. */
const MAX_VERSION = 1;

export interface Fill {
  sig: string;
  /** epoch seconds */
  t: number;
  mint: string;
  side: "buy" | "sell";
  /** coins bought or sold (always positive) */
  tokens: number;
  /** what was paid or received, in the quote asset that was used */
  quote: "SOL" | "USD";
  quoteAmount: number;
  /** quote units per coin */
  price: number;
}

export interface Transfer {
  sig: string;
  t: number;
  mint: string;
  /** positive = received, negative = sent away */
  tokens: number;
}

export interface Decoded {
  fills: Fill[];
  transfers: Transfer[];
  /** token-for-token swaps: both sides are coins, so there is no price to read */
  swaps: Array<{ sig: string; t: number; out: string; into: string }>;
}

const num = (x: unknown): number => {
  const n = typeof x === "number" ? x : x == null ? NaN : Number(x);
  return Number.isFinite(n) ? n : 0;
};

const uiAmount = (b: any): number => num(b?.uiTokenAmount?.uiAmountString ?? b?.uiTokenAmount?.uiAmount);

/** Rent that a token account holds, from the balances of the account itself. */
function rentMoved(tx: any, keys: string[], wallet: string): { out: number; back: number } {
  const meta = tx.meta;
  const pre = new Map<number, string>();
  const post = new Map<number, string>();
  for (const b of meta.preTokenBalances ?? []) if (b.owner === wallet) pre.set(b.accountIndex, b.mint);
  for (const b of meta.postTokenBalances ?? []) if (b.owner === wallet) post.set(b.accountIndex, b.mint);
  let out = 0;
  let back = 0;
  for (const [idx] of post) if (!pre.has(idx)) out += num(meta.postBalances?.[idx]);
  for (const [idx] of pre) if (!post.has(idx)) back += num(meta.preBalances?.[idx]);
  void keys;
  return { out: out / 1e9, back: back / 1e9 };
}

/** The buys and sells this wallet made in one transaction (a transaction from getTransaction with jsonParsed encoding). */
export function decodeFills(tx: any, wallet: string): Decoded {
  const none: Decoded = { fills: [], transfers: [], swaps: [] };
  const meta = tx?.meta;
  if (!meta || meta.err != null) return none;
  const sig: string = tx.transaction?.signatures?.[0] ?? "";
  const t: number = num(tx.blockTime);
  const keys: string[] = (tx.transaction?.message?.accountKeys ?? []).map((k: any) => (typeof k === "string" ? k : k.pubkey));
  const idx = keys.indexOf(wallet);

  // coin and stablecoin balance changes of this wallet, per mint
  const delta = new Map<string, number>();
  for (const b of meta.preTokenBalances ?? []) if (b.owner === wallet) delta.set(b.mint, (delta.get(b.mint) ?? 0) - uiAmount(b));
  for (const b of meta.postTokenBalances ?? []) if (b.owner === wallet) delta.set(b.mint, (delta.get(b.mint) ?? 0) + uiAmount(b));

  // SOL: native balance (fee added back when the wallet paid it, rent for opening token accounts taken out) plus wrapped SOL
  let sol = 0;
  if (idx >= 0) {
    const raw = (num(meta.postBalances?.[idx]) - num(meta.preBalances?.[idx])) / 1e9;
    const fee = idx === 0 ? num(meta.fee) / 1e9 : 0;
    const rent = rentMoved(tx, keys, wallet);
    sol = raw + fee + rent.out - rent.back;
  }
  sol += delta.get(WSOL) ?? 0;
  const usd = (delta.get(USDC) ?? 0) + (delta.get(USDT) ?? 0);

  const coins = [...delta.entries()].filter(([m, d]) => m !== WSOL && !STABLES.has(m) && Math.abs(d) > 0);
  if (!coins.length) return none;
  const out: Decoded = { fills: [], transfers: [], swaps: [] };
  const tiny = 1e-6;
  const quoteSol = Math.abs(sol) > 1e-5 ? sol : 0; // dust from rounding is not a trade
  const quoteUsd = Math.abs(usd) > 0.01 ? usd : 0;

  if (coins.length === 1) {
    const [mint, d] = coins[0]!;
    if (d > 0 && (quoteSol < 0 || quoteUsd < 0)) {
      const useUsd = quoteUsd < 0 && (quoteSol >= 0 || Math.abs(quoteUsd) > 0);
      const amount = useUsd ? -quoteUsd : -quoteSol;
      out.fills.push({ sig, t, mint, side: "buy", tokens: d, quote: useUsd ? "USD" : "SOL", quoteAmount: amount, price: amount / d });
    } else if (d < 0 && (quoteSol > 0 || quoteUsd > 0)) {
      const useUsd = quoteUsd > 0;
      const amount = useUsd ? quoteUsd : quoteSol;
      out.fills.push({ sig, t, mint, side: "sell", tokens: -d, quote: useUsd ? "USD" : "SOL", quoteAmount: amount, price: amount / -d });
    } else if (Math.abs(d) > tiny) {
      out.transfers.push({ sig, t, mint, tokens: d });
    }
    return out;
  }
  // several coins moved at once
  const gained = coins.filter(([, d]) => d > 0);
  const lost = coins.filter(([, d]) => d < 0);
  if (gained.length === 1 && lost.length === 1 && !quoteSol && !quoteUsd) out.swaps.push({ sig, t, out: lost[0]![0], into: gained[0]![0] });
  else for (const [mint, d] of coins) out.transfers.push({ sig, t, mint, tokens: d });
  return out;
}

export interface Position {
  mint: string;
  buys: number;
  sells: number;
  tokensBought: number;
  tokensSold: number;
  /** dollars paid in / received, with SOL turned into dollars at the price of that hour */
  usdIn: number;
  usdOut: number;
  /** average price paid per coin in dollars, over all buys */
  avgEntryUsd: number | null;
  firstBuyAt: number | null;
  lastTradeAt: number;
  /** coins still held according to the fills (the chain's own balance is the authority) */
  openTokens: number;
  /** dollars received for what was sold minus what that part cost on average (null when nothing was sold) */
  realizedUsd: number | null;
}

/** Fills -> one position per coin. `solUsd(t)` turns a SOL amount into dollars at second `t`. */
export function aggregatePositions(fills: Fill[], solUsd: (t: number) => number): Position[] {
  const by = new Map<string, Position>();
  for (const f of [...fills].sort((a, b) => a.t - b.t)) {
    const p = by.get(f.mint) ?? { mint: f.mint, buys: 0, sells: 0, tokensBought: 0, tokensSold: 0, usdIn: 0, usdOut: 0, avgEntryUsd: null, firstBuyAt: null, lastTradeAt: f.t, openTokens: 0, realizedUsd: null };
    const usd = f.quote === "USD" ? f.quoteAmount : f.quoteAmount * solUsd(f.t);
    if (f.side === "buy") {
      p.buys++;
      p.tokensBought += f.tokens;
      p.usdIn += usd;
      p.firstBuyAt ??= f.t;
    } else {
      p.sells++;
      p.tokensSold += f.tokens;
      p.usdOut += usd;
    }
    p.lastTradeAt = f.t;
    by.set(f.mint, p);
  }
  for (const p of by.values()) {
    p.avgEntryUsd = p.tokensBought > 0 ? p.usdIn / p.tokensBought : null;
    p.openTokens = Math.max(0, p.tokensBought - p.tokensSold);
    p.realizedUsd = p.tokensSold > 0 && p.avgEntryUsd != null ? p.usdOut - p.avgEntryUsd * Math.min(p.tokensSold, p.tokensBought) : null;
  }
  return [...by.values()].sort((a, b) => b.lastTradeAt - a.lastTradeAt);
}

// ── reading the chain ─────────────────────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One JSON-RPC call against the free public endpoints, trying each in turn; back-off on rate limits. null when all fail. */
export async function rpc(method: string, params: unknown[], opts: { tries?: number; timeoutMs?: number; endpoints?: string[]; nullIsMiss?: boolean } = {}): Promise<any | null> {
  const tries = opts.tries ?? 4;
  const endpoints = opts.endpoints ?? [PUBLICNODE, OFFICIAL];
  for (let attempt = 0; attempt < tries; attempt++) {
    const url = endpoints[attempt % endpoints.length]!;
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000) });
      if (res.status === 429 || res.status >= 500) {
        await sleep(1_200 * (attempt + 1));
        continue;
      }
      const j: any = await res.json();
      if (j?.error) {
        // -32015 = this node does not serve the transaction version; -32004/-32009 = not available on this node: try the next endpoint
        if ([-32015, -32004, -32009, -32007].includes(j.error.code)) continue;
        if (j.error.code === 429 || /rate|too many/i.test(String(j.error.message))) {
          await sleep(1_500 * (attempt + 1));
          continue;
        }
        return null;
      }
      if (j.result == null && opts.nullIsMiss) continue; // this node does not have it: ask the next one
      return j.result ?? null;
    } catch {
      await sleep(600 * (attempt + 1));
    }
  }
  return null;
}

export interface SigInfo {
  signature: string;
  blockTime: number | null;
  err: unknown;
}

/** Newest-first transaction signatures of the address, newer than `untilSig` (exclusive) and not older than `sinceT` (epoch seconds). */
export async function fetchSignatures(address: string, opts: { untilSig?: string; sinceT?: number; max?: number } = {}): Promise<SigInfo[]> {
  const out: SigInfo[] = [];
  let before: string | undefined;
  const max = opts.max ?? 2000;
  for (;;) {
    const page: SigInfo[] | null = await rpc("getSignaturesForAddress", [address, { limit: 1000, ...(before ? { before } : {}), ...(opts.untilSig ? { until: opts.untilSig } : {}) }], { endpoints: [OFFICIAL, PUBLICNODE] });
    if (!page || !page.length) break;
    for (const s of page) {
      if (opts.sinceT != null && s.blockTime != null && s.blockTime < opts.sinceT) return out;
      out.push(s);
      if (out.length >= max) return out;
    }
    if (page.length < 1000) break;
    before = page[page.length - 1]!.signature;
    await sleep(250);
  }
  return out;
}

export async function fetchTransaction(sig: string): Promise<any | null> {
  return rpc("getTransaction", [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: MAX_VERSION, commitment: "confirmed" }], { nullIsMiss: true, tries: 5 });
}

/** Current balances of the coins the wallet holds, from Jupiter's free holdings call: mint -> amount in whole coins (SOL under WSOL). */
export async function fetchHoldings(address: string): Promise<Map<string, number> | null> {
  try {
    const res = await fetch(`https://lite-api.jup.ag/ultra/v1/holdings/${address}`, { signal: AbortSignal.timeout(20_000), headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const j: any = await res.json();
    const out = new Map<string, number>();
    if (num(j.uiAmount) > 0) out.set(WSOL, num(j.uiAmount));
    for (const [mint, accts] of Object.entries(j.tokens ?? {})) {
      const total = (accts as any[]).reduce((a, x) => a + num(x.uiAmount), 0);
      if (total > 0) out.set(mint, total);
    }
    return out;
  } catch {
    return null;
  }
}

/** SOL price in dollars, hourly, from DefiLlama; returns a lookup that picks the nearest hour (and the latest price outside the range). */
export async function solUsdLookup(fromT: number): Promise<(t: number) => number> {
  const pts: Array<[number, number]> = [];
  try {
    const span = Math.min(1000, Math.ceil((Date.now() / 1000 - fromT) / 3600) + 6);
    const res = await fetch(`https://coins.llama.fi/chart/coingecko:solana?start=${Math.floor(fromT - 3600)}&span=${span}&period=1h`, { signal: AbortSignal.timeout(20_000) });
    const j: any = await res.json();
    for (const p of j?.coins?.["coingecko:solana"]?.prices ?? []) if (Number.isFinite(p.timestamp) && Number.isFinite(p.price)) pts.push([p.timestamp, p.price]);
  } catch {
    /* fall through to the fallback below */
  }
  if (!pts.length) {
    try {
      const j: any = await (await fetch("https://lite-api.jup.ag/price/v3?ids=" + WSOL, { signal: AbortSignal.timeout(15_000) })).json();
      const p = num(j?.[WSOL]?.usdPrice);
      if (p > 0) pts.push([Date.now() / 1000, p]);
    } catch {
      /* no price: dollars stay 0 and the caller says so */
    }
  }
  pts.sort((a, b) => a[0] - b[0]);
  return (t: number) => {
    if (!pts.length) return 0;
    let best = pts[0]!;
    for (const p of pts) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
    return best[1];
  };
}
