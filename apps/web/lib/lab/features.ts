/**
 * The lab's feature set: what a coin looks like at a decision moment, from the scanner's own stored readings
 * (price path, DexScreener snapshot, holder enrichment) plus what the lab collects itself. Every feature is a plain
 * number (or null when unknown), computed only from what was known AT that moment, never from what came later.
 */

import type { Obs } from "./paths";

/** The slice of a stored DexScreener snapshot that the lab reads (the builder extracts it with jsonb operators). */
export interface PayloadRow {
  pc_m5: number | null;
  pc_h1: number | null;
  pc_h6: number | null;
  pc_h24: number | null;
  v_m5: number | null;
  v_h1: number | null;
  v_h6: number | null;
  v_h24: number | null;
  b_m5: number | null;
  s_m5: number | null;
  b_h1: number | null;
  s_h1: number | null;
  b_h6: number | null;
  s_h6: number | null;
  b_h24: number | null;
  s_h24: number | null;
  liq: number | null;
  mcap: number | null;
  fdv: number | null;
  price: number | null;
  boosts: number | null;
  dex: string | null;
  quote: string | null;
  n_web: number | null;
  n_soc: number | null;
  site: string | null;
  created_ms: number | null;
}

/** Holder structure from the on-chain enrichment: fractions 0..1, pool and burn accounts already excluded. */
export interface Enrich {
  top1: number | null;
  top5: number | null;
  insider: number | null;
  top10: number | null;
}

/** What the lab's own collectors saw around the moment (null for coins collected before the collectors existed). */
export interface Signals {
  buyers_h1?: number | null;
  sellers_h1?: number | null;
  buys_h1?: number | null;
  sells_h1?: number | null;
  buyers_h24?: number | null;
  sellers_h24?: number | null;
  organic_score?: number | null;
  holders?: number | null;
  organic_buyers_h24?: number | null;
  traders_h24?: number | null;
  net_buyers_h24?: number | null;
  buy_vol_h24?: number | null;
  sell_vol_h24?: number | null;
  org_buy_vol_h24?: number | null;
  org_sell_vol_h24?: number | null;
}

export type FeatureValue = number | null;
export type Features = Record<string, FeatureValue>;

export interface SnapInput {
  tau: number;
  clean: Obs[];
  idx: number;
  first: { t0: number; p0: number; liq0: number | null };
  pay: PayloadRow | null;
  enr: Enrich | null;
  tags: string[];
  signals?: Signals | null;
  /** launchpad, developer and paid-promotion facts as they stood at this moment (lib/lab/statics.ts) */
  statics?: Record<string, number | null> | null;
  /** the market around the coin at this moment (lib/lab/regime.ts) */
  regime?: Record<string, number | null> | null;
}

const fin = (x: number | null | undefined): number | null => (x != null && Number.isFinite(x) ? x : null);
const ratio = (a: number | null, b: number | null): number | null => (a != null && b != null && b > 0 ? a / b : null);

/** Volatility of the last 6 hours: standard deviation of log returns per square-root hour (comparable across scan rates). */
function volNorm(clean: Obs[], idx: number): number | null {
  const tEnd = clean[idx]!.t;
  const rets: number[] = [];
  for (let k = idx; k > 0 && tEnd - clean[k - 1]!.t <= 6 * 3600; k--) {
    const a = clean[k - 1]!;
    const b = clean[k]!;
    if (a.p > 0 && b.p > 0) rets.push(Math.log(b.p / a.p) / Math.sqrt(Math.max(b.t - a.t, 30) / 3600));
  }
  if (rets.length < 5) return null;
  const m = rets.reduce((s, x) => s + x, 0) / rets.length;
  return Math.sqrt(rets.reduce((s, x) => s + (x - m) ** 2, 0) / rets.length);
}

export function buildFeatures(inp: SnapInput): Features {
  const { clean, idx, first, pay, enr, tags } = inp;
  const here = clean[idx]!;
  let hi = first.p0;
  let lo = first.p0;
  let tHi = clean[0]!.t;
  for (let k = 0; k <= idx; k++) {
    const o = clean[k]!;
    if (o.p > hi) {
      hi = o.p;
      tHi = o.t;
    }
    if (o.p < lo) lo = o.p;
  }
  const liq = fin(pay?.liq) ?? fin(here.liq);
  const mcap = fin(pay?.mcap) ?? fin(pay?.fdv) ?? fin(here.mcap ?? null);
  const trades1 = pay && pay.b_h1 != null && pay.s_h1 != null ? pay.b_h1 + pay.s_h1 : null;
  const trades6 = pay && pay.b_h6 != null && pay.s_h6 != null ? pay.b_h6 + pay.s_h6 : null;
  const sig = inp.signals ?? null;
  const walletTrades =
    sig && sig.buyers_h1 != null && sig.sellers_h1 != null && sig.buys_h1 != null && sig.sells_h1 != null && sig.buyers_h1 + sig.sellers_h1 > 0
      ? (sig.buys_h1 + sig.sells_h1) / (sig.buyers_h1 + sig.sellers_h1)
      : null;
  const f: Features = {
    // market
    mcap,
    liq,
    liq_mcap: ratio(liq, mcap),
    pc_m5: fin(pay?.pc_m5),
    pc_h1: fin(pay?.pc_h1),
    pc_h6: fin(pay?.pc_h6),
    pc_h24: fin(pay?.pc_h24),
    // raw counts, kept so the production gate's rules can be replayed exactly (not part of the catalogue)
    b_m5: fin(pay?.b_m5),
    s_m5: fin(pay?.s_m5),
    b_h1: fin(pay?.b_h1),
    s_h1: fin(pay?.s_h1),
    // activity
    trades_h1: trades1,
    trades_h6: trades6,
    buy_share_h1: pay && trades1 != null && trades1 >= 20 ? ratio(pay.b_h1, trades1) : null,
    buy_share_h6: pay && trades6 != null && trades6 >= 60 ? ratio(pay.b_h6, trades6) : null,
    vol_h1: fin(pay?.v_h1),
    vol_h6: fin(pay?.v_h6),
    vol_liq_h1: ratio(fin(pay?.v_h1), liq),
    vol_liq_h6: ratio(fin(pay?.v_h6), liq),
    vol_decay: pay && pay.v_h1 != null && pay.v_h6 != null && pay.v_h6 > 0 ? pay.v_h1 / (pay.v_h6 / 6) : null,
    trade_decay: trades1 != null && trades6 != null && trades6 >= 30 ? trades1 / (trades6 / 6) : null,
    avg_trade_h1: pay && pay.v_h1 != null && trades1 ? pay.v_h1 / trades1 : null,
    // path since the first look
    mult: here.p / first.p0,
    run: hi / first.p0,
    dd: here.p / hi,
    hrs_since_high: (here.t - tHi) / 3600,
    min_so_far: lo / first.p0,
    vol_norm: volNorm(clean, idx),
    liq_vs_first: ratio(liq, first.liq0),
    age_h: (here.t - first.t0) / 3600,
    pair_age_h: pay?.created_ms ? (here.t - pay.created_ms / 1000) / 3600 : null,
    // holders (static, from the enrichment)
    top1: fin(enr?.top1),
    top5: fin(enr?.top5),
    insider: fin(enr?.insider),
    top10: fin(enr?.top10),
    // project facts known at that moment
    has_site: pay ? (pay.n_web ?? 0) > 0 ? 1 : 0 : null,
    has_social: pay ? (pay.n_soc ?? 0) > 0 ? 1 : 0 : null,
    boosted: pay ? (pay.boosts ?? 0) > 0 ? 1 : 0 : null,
    dex_pumpswap: pay?.dex ? (pay.dex === "pumpswap" ? 1 : 0) : null,
    dex_raydium: pay?.dex ? (pay.dex === "raydium" ? 1 : 0) : null,
    quote_sol: pay?.quote ? (pay.quote === "SOL" ? 1 : 0) : null,
    // narrative (from the name)
    tag_ai: tags.includes("ai_agent") ? 1 : 0,
    tag_tool: tags.includes("tool") ? 1 : 0,
    tag_product: tags.includes("product") ? 1 : 0,
    tag_animal: tags.includes("animal") ? 1 : 0,
    tag_person: tags.includes("person") ? 1 : 0,
    // collected by the lab itself (only present for coins seen after the collectors started)
    uniq_buyers_h1: fin(sig?.buyers_h1),
    uniq_sellers_h1: fin(sig?.sellers_h1),
    wallet_trades: walletTrades,
    organic_score: fin(sig?.organic_score),
    holders: fin(sig?.holders),
    net_buyer_share: sig && sig.net_buyers_h24 != null && sig.traders_h24 != null && sig.traders_h24 > 0 ? sig.net_buyers_h24 / sig.traders_h24 : null,
    organic_vol_share:
      sig && sig.org_buy_vol_h24 != null && sig.org_sell_vol_h24 != null && sig.buy_vol_h24 != null && sig.sell_vol_h24 != null && sig.buy_vol_h24 + sig.sell_vol_h24 > 0
        ? (sig.org_buy_vol_h24 + sig.org_sell_vol_h24) / (sig.buy_vol_h24 + sig.sell_vol_h24)
        : null,
  };
  for (const [k, v] of Object.entries(inp.statics ?? {})) f[k] = fin(v);
  for (const [k, v] of Object.entries(inp.regime ?? {})) f[k] = fin(v);
  return f;
}

// ── feature catalogue (labels, display, how the model sees them) ───────────────────────────────────────────

export type Fmt = "pct" | "frac" | "usd" | "x" | "num" | "hours" | "bool";
export type Group = "Market" | "Activity" | "Path" | "Holders" | "Project" | "Narrative" | "Collected";

export interface FeatureMeta {
  key: string;
  label: string;
  group: Group;
  fmt: Fmt;
  /** one line for the page */
  about: string;
  /** model input transform: compresses heavy tails; null = not used by the model */
  model?: { transform: "log10" | "slog" | "id"; usesMissing?: boolean };
}

export const FEATURES: FeatureMeta[] = [
  { key: "mcap", label: "Market cap", group: "Market", fmt: "usd", about: "Market cap at that moment.", model: { transform: "log10" } },
  { key: "liq", label: "Liquidity", group: "Market", fmt: "usd", about: "Pool liquidity at that moment.", model: { transform: "log10" } },
  { key: "liq_mcap", label: "Liquidity / market cap", group: "Market", fmt: "frac", about: "How deep the pool is compared with the coin's value.", model: { transform: "id" } },
  { key: "pc_m5", label: "Price change, 5 min", group: "Market", fmt: "pct", about: "Change in the last 5 minutes." },
  { key: "pc_h1", label: "Price change, 1 h", group: "Market", fmt: "pct", about: "Change in the last hour." },
  { key: "pc_h6", label: "Price change, 6 h", group: "Market", fmt: "pct", about: "Change in the last 6 hours.", model: { transform: "slog" } },
  { key: "pc_h24", label: "Price change, 24 h", group: "Market", fmt: "pct", about: "Change in the last 24 hours.", model: { transform: "slog" } },
  { key: "trades_h1", label: "Trades, last hour", group: "Activity", fmt: "num", about: "Buys plus sells in the last hour.", model: { transform: "log10" } },
  { key: "trades_h6", label: "Trades, last 6 h", group: "Activity", fmt: "num", about: "Buys plus sells in the last 6 hours." },
  { key: "buy_share_h1", label: "Buy share, last hour", group: "Activity", fmt: "frac", about: "Share of last hour's trades that were buys (needs 20+ trades).", model: { transform: "id", usesMissing: true } },
  { key: "buy_share_h6", label: "Buy share, last 6 h", group: "Activity", fmt: "frac", about: "Share of the last 6 hours' trades that were buys." },
  { key: "vol_h1", label: "Volume, last hour", group: "Activity", fmt: "usd", about: "Dollar volume in the last hour." },
  { key: "vol_h6", label: "Volume, last 6 h", group: "Activity", fmt: "usd", about: "Dollar volume in the last 6 hours." },
  { key: "vol_liq_h1", label: "Volume / liquidity, 1 h", group: "Activity", fmt: "x", about: "Last hour's volume as a multiple of the pool's liquidity.", model: { transform: "log10" } },
  { key: "vol_liq_h6", label: "Volume / liquidity, 6 h", group: "Activity", fmt: "x", about: "Last 6 hours' volume as a multiple of the pool's liquidity." },
  { key: "vol_decay", label: "Volume now vs 6 h average", group: "Activity", fmt: "x", about: "Last hour's volume divided by the 6-hour hourly average. Below 0.1 means the volume has dried up.", model: { transform: "log10" } },
  { key: "trade_decay", label: "Trades now vs 6 h average", group: "Activity", fmt: "x", about: "Last hour's trade count divided by the 6-hour hourly average." },
  { key: "avg_trade_h1", label: "Average trade size, 1 h", group: "Activity", fmt: "usd", about: "Dollar volume per trade in the last hour." },
  { key: "mult", label: "Price vs first look", group: "Path", fmt: "x", about: "Price now divided by the price when the system first saw the coin.", model: { transform: "log10" } },
  { key: "run", label: "Highest price vs first look", group: "Path", fmt: "x", about: "How far the coin already ran since the first look.", model: { transform: "log10" } },
  { key: "dd", label: "Price vs its own high", group: "Path", fmt: "frac", about: "Price divided by its highest price since the first look (1.0 = standing at the high).", model: { transform: "id" } },
  { key: "hrs_since_high", label: "Hours since its high", group: "Path", fmt: "hours", about: "How long ago the coin made its highest price.", model: { transform: "log10" } },
  { key: "min_so_far", label: "Lowest price vs first look", group: "Path", fmt: "x", about: "The lowest price so far as a multiple of the first price." },
  { key: "vol_norm", label: "Volatility, last 6 h", group: "Path", fmt: "num", about: "How wildly the price moved in the last 6 hours.", model: { transform: "id", usesMissing: true } },
  { key: "liq_vs_first", label: "Liquidity vs first look", group: "Path", fmt: "x", about: "Liquidity now divided by liquidity at the first look.", model: { transform: "log10", usesMissing: true } },
  { key: "age_h", label: "Age since first look", group: "Path", fmt: "hours", about: "Hours since the system first saw the coin." },
  { key: "pair_age_h", label: "Pair age", group: "Path", fmt: "hours", about: "Hours since the trading pair was created." },
  { key: "top1", label: "Largest holder", group: "Holders", fmt: "frac", about: "Share held by the largest wallet (pools and burn accounts excluded)." },
  { key: "top5", label: "Top 5 holders", group: "Holders", fmt: "frac", about: "Share held by the five largest wallets." },
  { key: "insider", label: "Insider share", group: "Holders", fmt: "frac", about: "Share held by wallets linked to the deployer." },
  { key: "top10", label: "Top 10 holders", group: "Holders", fmt: "frac", about: "Share held by the ten largest wallets." },
  { key: "has_site", label: "Has a website", group: "Project", fmt: "bool", about: "A website was on its profile at that moment." },
  { key: "has_social", label: "Has a social link", group: "Project", fmt: "bool", about: "A social link was on its profile at that moment." },
  { key: "boosted", label: "Boosted", group: "Project", fmt: "bool", about: "Paid DexScreener boosts were active." },
  { key: "dex_pumpswap", label: "Trades on PumpSwap", group: "Project", fmt: "bool", about: "The main pool is on PumpSwap (a pump.fun graduate)." },
  { key: "dex_raydium", label: "Trades on Raydium", group: "Project", fmt: "bool", about: "The main pool is on Raydium." },
  { key: "quote_sol", label: "Quoted in SOL", group: "Project", fmt: "bool", about: "The pool is priced in SOL (not in another token)." },
  { key: "tag_ai", label: "AI / agent / bot name", group: "Narrative", fmt: "bool", about: "The name or symbol points at AI, agents or bots." },
  { key: "tag_tool", label: "Tool / app / finance name", group: "Narrative", fmt: "bool", about: "The name or symbol points at a tool, app, finance or tech product." },
  { key: "tag_product", label: "AI or tool name", group: "Narrative", fmt: "bool", about: "Either of the two above." },
  { key: "tag_animal", label: "Animal meme name", group: "Narrative", fmt: "bool", about: "The name or symbol is an animal." },
  { key: "tag_person", label: "Person / celebrity name", group: "Narrative", fmt: "bool", about: "The name or symbol is a public figure." },
  { key: "lp_pump", label: "Launched on pump.fun", group: "Project", fmt: "bool", about: "The coin came from the pump.fun launchpad (Jupiter's launchpad field)." },
  { key: "lp_other", label: "Launched on another launchpad", group: "Project", fmt: "bool", about: "From a launchpad other than pump.fun: stonk.fun, bags.fun, LetsBonk, Meteora DBC and others." },
  { key: "paid_profile", label: "Token profile paid by then", group: "Project", fmt: "bool", about: "The team had paid DexScreener for an enhanced token profile at that moment." },
  { key: "profile_delay_min", label: "Minutes until the profile was paid", group: "Project", fmt: "num", about: "Minutes between the pair being created and the token profile being paid for (only once it was paid)." },
  { key: "boost_amount", label: "Boosts bought so far", group: "Project", fmt: "num", about: "Total of DexScreener boost purchases up to that moment (paid attention)." },
  { key: "boost_n", label: "Boost purchases so far", group: "Project", fmt: "num", about: "How many separate boost purchases had been made." },
  { key: "ad_n", label: "Ads bought so far", group: "Project", fmt: "num", about: "DexScreener ads bought for the coin up to that moment." },
  { key: "cto", label: "Community takeover claimed", group: "Project", fmt: "bool", about: "A community takeover of the coin's profile had been claimed (often after the original team left)." },
  { key: "dev_serial", label: "Developer launched 5+ coins", group: "Collected", fmt: "bool", about: "Jupiter's count of coins this developer has launched is 5 or more (only for coins seen from now on)." },
  { key: "regime_sol_24h", label: "SOL, previous 24 h", group: "Market", fmt: "pct", about: "How much SOL's price changed in the 24 hours before that moment: the market's mood." },
  { key: "regime_dex_vol", label: "Solana DEX volume, previous day", group: "Market", fmt: "x", about: "The last full day's volume on Solana's exchanges against the average of the 7 days before it. Above 1 = trading heating up." },
  { key: "pump_mayhem", label: "Launched in Mayhem Mode", group: "Collected", fmt: "bool", about: "pump.fun's Mayhem Mode: an AI agent trades the coin for its first 24 hours and the supply is 2 billion instead of 1 billion, so early volume is partly the agent's (only for coins whose graduation the lab saw live)." },
  { key: "dev_buy_sol", label: "Creator's first buy (SOL)", group: "Collected", fmt: "num", about: "What the creator bought in the very transaction that created the coin (only for graduations the lab saw live)." },
  { key: "grad_minutes", label: "Minutes from launch to graduation", group: "Collected", fmt: "num", about: "How long the coin took to fill its bonding curve and graduate to PumpSwap (HOTBOT took 347)." },
  { key: "creator_launches", label: "Creator's launches in the 72 h before", group: "Collected", fmt: "num", about: "How many coins the same wallet created in the 72 hours before this one: 1 = a one-off project, many = a serial launcher." },
  { key: "uniq_buyers_h1", label: "Unique buyers, 1 h", group: "Collected", fmt: "num", about: "Different wallets that bought in the last hour (GeckoTerminal)." },
  { key: "uniq_sellers_h1", label: "Unique sellers, 1 h", group: "Collected", fmt: "num", about: "Different wallets that sold in the last hour." },
  { key: "wallet_trades", label: "Trades per wallet, 1 h", group: "Collected", fmt: "num", about: "Trades divided by distinct wallets: high means a few wallets trading with each other." },
  { key: "organic_score", label: "Organic score", group: "Collected", fmt: "num", about: "Jupiter's score for how organic the trading looks (0-100)." },
  { key: "holders", label: "Holders", group: "Collected", fmt: "num", about: "Number of holder wallets (Jupiter)." },
  { key: "net_buyer_share", label: "Net buyers / traders, 24 h", group: "Collected", fmt: "frac", about: "Of the wallets that traded in the last 24 hours, the share that bought more than they sold (Jupiter). Low = mostly sellers." },
  { key: "rc_top1", label: "Largest holder (RugCheck)", group: "Holders", fmt: "frac", about: "Share of the supply held by the largest wallet, pool and burn accounts excluded, at RugCheck's first look at the coin (the 20 largest holders it lists)." },
  { key: "rc_top10", label: "Top 10 holders (RugCheck)", group: "Holders", fmt: "frac", about: "Share held by the ten largest wallets, pool and burn accounts excluded, at RugCheck's first look." },
  { key: "rc_insider_pct", label: "Insider networks' share (RugCheck)", group: "Holders", fmt: "frac", about: "Share of the supply still held by networks of wallets that funded each other (RugCheck's insider graph), at its first look." },
  { key: "rc_insiders", label: "Wallets in insider networks", group: "Holders", fmt: "num", about: "How many wallets RugCheck puts in insider networks around the coin (an airdrop-style spread can make this very large)." },
  { key: "rc_lp_locked", label: "Liquidity locked or burned (RugCheck)", group: "Holders", fmt: "frac", about: "Share of the pool's liquidity tokens that are locked or burned at RugCheck's first look." },
  { key: "rc_risk_n", label: "RugCheck risks listed", group: "Holders", fmt: "num", about: "How many risks RugCheck lists for the coin (low liquidity, high concentration, creator history, ...)." },
  { key: "rc_creator_rugs", label: "Creator has rugged before (RugCheck)", group: "Holders", fmt: "bool", about: "RugCheck lists a history of rugged tokens for the wallet that created the coin." },
  { key: "rc_holders", label: "Holders (RugCheck)", group: "Holders", fmt: "num", about: "Number of holder wallets at RugCheck's first look." },
  { key: "organic_vol_share", label: "Organic share of volume, 24 h", group: "Collected", fmt: "frac", about: "Share of the last 24 hours' volume that Jupiter counts as organic (real traders, not bots or the same wallets) (only for coins seen from now on)." },
];

export const FEATURE_BY_KEY = new Map(FEATURES.map((f) => [f.key, f]));

const num = (v: number, d = 1) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(d));

/** Human text for a value of a feature: "$12.3K", "45%", "2.4x", "3.5 h". */
export function fmtValue(fmt: Fmt, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "-";
  switch (fmt) {
    case "pct":
      return `${v >= 0 ? "+" : ""}${num(v, 0)}%`;
    case "frac":
      return `${num(v * 100, 0)}%`;
    case "usd": {
      const a = Math.abs(v);
      return a >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : a >= 1e3 ? `$${(v / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K` : `$${v.toFixed(0)}`;
    }
    case "x":
      return v >= 100 ? `${v.toFixed(0)}x` : `${v.toFixed(v >= 10 ? 1 : 2)}x`;
    case "hours":
      return v >= 48 ? `${(v / 24).toFixed(1)} d` : `${v.toFixed(1)} h`;
    case "bool":
      return v >= 0.5 ? "yes" : "no";
    default:
      return num(v, v >= 10 ? 0 : 2);
  }
}

/** Model transform of a raw value. */
export function modelValue(transform: "log10" | "slog" | "id", v: number): number {
  switch (transform) {
    case "log10":
      return Math.log10(Math.max(v, 1e-4) + 1e-3);
    case "slog":
      return Math.sign(v) * Math.log1p(Math.abs(v) / 100);
    default:
      return v;
  }
}
