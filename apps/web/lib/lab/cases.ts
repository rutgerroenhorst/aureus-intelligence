/**
 * Case studies: one real coin told from start to finish with what can be checked today, and where the system's door stood
 * while it happened. The first is HOTBOT, the coin that showed the Radar's discovery blind spot.
 *
 * The numbers come from the same free sources the lab uses (DexScreener, Jupiter, GeckoTerminal hourly candles, RugCheck);
 * what the project says about itself is labelled as such. Computed by scripts/lab-case.ts and stored in lab_reports (kind
 * "cases"), so the hosted page needs no extra request.
 */

const HEADERS = { accept: "application/json", "user-agent": "Aureus-Lab/1.0" };

export interface CaseStudy {
  id: string;
  title: string;
  mint: string;
  builtAt: string;
  /** one paragraph each */
  about: string[];
  facts: Array<{ label: string; value: string; source: string }>;
  /** hourly closes since the pair was created: [epoch s, price in USD]; market cap = price x supply */
  series: Array<[number, number]>;
  supply: number | null;
  /** UTC day -> lowest market cap that day, to show the rising floor */
  dailyLows: Array<{ day: string; mcap: number }>;
  door: { maxMcap: number; minAgeMin: number; crossedAtH: number | null; mcapAtMinAge: number | null; graduatedAt: number | null };
  sources: Array<{ label: string; url: string }>;
}

async function getJson(url: string, tries = 5): Promise<any | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(25_000) });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 4_000 * (i + 1)));
        continue;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
  return null;
}

const usd = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}K` : `$${v.toFixed(0)}`);

/** What the project says about itself (its own site and the press about it), kept apart from what was measured. */
const HOTBOT_ABOUT = [
  "HOTBOT is not a joke coin and not a known company: it is the token of an AI-agent product for memecoin traders. According to its own site it is a private trading team of agents (a researcher, a sniper, a trader and a launcher) steered by HOTBOT, working across pump.fun, Axiom, GMGN, Bloom, Jupiter and Raydium, in an invite-only app built on ClawPump, an agent platform that took part in Solana's Frontier hackathon. The team is anonymous. These are the project's own claims and press about it; the lab has not checked any of them.",
  "It launched on pump.fun on 1 October 2026 at 23:59 UTC from a wallet that only made this coin, and graduated to PumpSwap after 5 hours and 47 minutes. What follows is what can be checked from market data.",
];

export async function buildHotbotCase(): Promise<CaseStudy | null> {
  const mint = "8nnaeWCw8mUypcGAgbmSuzAT85uWx4UN12adDrMhXrGF";
  const [dex, jupList, rug] = await Promise.all([
    getJson(`https://api.dexscreener.com/tokens/v1/solana/${mint}`),
    getJson(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`),
    getJson(`https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`),
  ]);
  const pair = Array.isArray(dex) ? [...dex].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0] : null;
  const jup = Array.isArray(jupList) ? jupList[0] : null;
  if (!pair) return null;
  const candles = await getJson(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pair.pairAddress}/ohlcv/hour?aggregate=1&limit=1000&currency=usd`);
  const list: Array<[number, number, number, number, number, number]> = candles?.data?.attributes?.ohlcv_list ?? [];
  const series = list.map((c) => [c[0] + 3600, c[4]] as [number, number]).filter((c) => c[1] > 0).sort((a, b) => a[0] - b[0]);
  const supply = Number(jup?.circSupply ?? jup?.totalSupply) || 1e9;
  const mcapAt = (price: number) => price * supply;
  const graduatedAt = pair.pairCreatedAt ? Math.round(pair.pairCreatedAt / 1000) : null;

  // where the Radar's door stood: the first look at 60 minutes of pair age, and when the $150K cap was passed
  const MAX = 150_000;
  const MIN_AGE_MIN = 60;
  const crossed = graduatedAt ? series.find((s) => s[0] > graduatedAt && mcapAt(s[1]) > MAX) : null;
  const atMin = graduatedAt ? series.find((s) => s[0] >= graduatedAt + MIN_AGE_MIN * 60) : null;

  const lows = new Map<string, number>();
  for (const c of list) {
    const day = new Date(c[0] * 1000).toISOString().slice(0, 10);
    const low = mcapAt(c[3]);
    if (c[3] > 0 && (lows.get(day) == null || low < lows.get(day)!)) lows.set(day, low);
  }
  const dailyLows = [...lows.entries()].sort().map(([day, mcap]) => ({ day, mcap }));
  const peak = series.length ? Math.max(...series.map((s) => mcapAt(s[1]))) : null;

  const facts: CaseStudy["facts"] = [];
  const add = (label: string, value: string | null, source: string) => value && facts.push({ label, value, source });
  add("Market cap now", usd(Number(jup?.mcap ?? pair.marketCap ?? 0)), "Jupiter");
  add("Highest market cap since graduating", peak ? usd(peak) : null, "GeckoTerminal hourly closes");
  add("Liquidity (main pool)", usd(pair.liquidity?.usd ?? 0), "DexScreener");
  add("Holders", jup?.holderCount ? Math.round(jup.holderCount).toLocaleString("en-US") : null, "Jupiter");
  add("Distinct traders, last 24 h", jup?.stats24h?.numTraders ? Math.round(jup.stats24h.numTraders).toLocaleString("en-US") : null, "Jupiter");
  add("Organic score", jup?.organicScore != null ? `${Math.round(jup.organicScore)} of 100 (${jup.organicScoreLabel ?? "?"})` : null, "Jupiter");
  add("Largest holders together (top 10)", jup?.audit?.topHoldersPercentage != null ? `${jup.audit.topHoldersPercentage.toFixed(0)}%` : null, "Jupiter");
  add("Developer still holds", jup?.audit?.devBalancePercentage != null ? `${jup.audit.devBalancePercentage.toFixed(1)}%` : null, "Jupiter");
  add("Mint and freeze authority", jup?.audit ? (jup.audit.mintAuthorityDisabled && jup.audit.freezeAuthorityDisabled ? "both disabled" : "not both disabled") : null, "Jupiter");
  add("Liquidity locked", rug?.lpLockedPct != null ? `${Number(rug.lpLockedPct).toFixed(0)}%` : null, "RugCheck");
  add("Risks listed", rug ? (Array.isArray(rug.risks) && rug.risks.length ? rug.risks.map((r: { name?: string }) => r.name).filter(Boolean).join(", ") : "none") : null, "RugCheck");
  add("Where it trades", pair.dexId ? `${pair.dexId} (${pair.quoteToken?.symbol ?? "?"} pair)` : null, "DexScreener");
  add("Launchpad", jup?.launchpad ?? null, "Jupiter");

  return {
    id: "hotbot", title: "HOTBOT", mint, builtAt: new Date().toISOString(), about: HOTBOT_ABOUT, facts,
    series, supply, dailyLows,
    door: { maxMcap: MAX, minAgeMin: MIN_AGE_MIN, crossedAtH: crossed && graduatedAt ? (crossed[0] - graduatedAt) / 3600 : null, mcapAtMinAge: atMin ? mcapAt(atMin[1]) : null, graduatedAt },
    sources: [
      { label: "The project's own site", url: "https://usehotbot.com/" },
      { label: "Bitrue on HOTBOT", url: "https://www.bitrue.com/blog/what-is-hotbot" },
      { label: "DexScreener", url: `https://dexscreener.com/solana/${pair.pairAddress}` },
    ],
  };
}
