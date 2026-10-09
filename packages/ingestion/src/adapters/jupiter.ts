/**
 * Jupiter sell-route quotes (read-only). Used by the sellability analysis to detect
 * honeypots / non-sellable tokens and price impact. NEVER submits a transaction —
 * this only calls the public quote API.
 */
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_DECIMALS = 6;

export interface JupSellQuote {
  sizeUsd: number;
  outUsd: number | null;
  priceImpactPct: number | null; // percent (1.23 = 1.23%)
  routed: boolean;
  failReason?: string;
}

export interface JupiterOptions {
  baseUrl?: string;
  slippageBps?: number;
  timeoutMs?: number;
}

export class JupiterAdapter {
  readonly source = "jupiter" as const;
  private readonly baseUrl: string;
  private readonly slippageBps: number;
  private readonly timeoutMs: number;
  constructor(opts: JupiterOptions = {}) {
    // Free tier. (quote-api.jup.ag was retired; lite-api is the keyless endpoint.)
    this.baseUrl = opts.baseUrl ?? "https://lite-api.jup.ag/swap/v1";
    this.slippageBps = opts.slippageBps ?? 200;
    this.timeoutMs = opts.timeoutMs ?? 8000;
  }

  /** Quote selling `sizeUsd` worth of `mint` into USDC. */
  private async quoteOne(mint: string, decimals: number, priceUsd: number, sizeUsd: number): Promise<JupSellQuote> {
    if (!(priceUsd > 0)) return { sizeUsd, outUsd: null, priceImpactPct: null, routed: false, failReason: "no price" };
    const amountRaw = Math.max(1, Math.floor((sizeUsd / priceUsd) * 10 ** decimals));
    const url = `${this.baseUrl}/quote?inputMint=${mint}&outputMint=${USDC_MINT}&amount=${amountRaw}&slippageBps=${this.slippageBps}&swapMode=ExactIn`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
      if (res.status === 400 || res.status === 404) return { sizeUsd, outUsd: null, priceImpactPct: null, routed: false, failReason: "no route" };
      if (!res.ok) return { sizeUsd, outUsd: null, priceImpactPct: null, routed: false, failReason: `http ${res.status}` };
      const body = (await res.json().catch(() => ({}))) as { outAmount?: string; priceImpactPct?: string; routePlan?: unknown[]; error?: string };
      if (body.error || !body.outAmount || !(body.routePlan && body.routePlan.length > 0)) {
        return { sizeUsd, outUsd: null, priceImpactPct: null, routed: false, failReason: body.error ?? "no route" };
      }
      const outUsd = Number(body.outAmount) / 10 ** USDC_DECIMALS;
      const impact = body.priceImpactPct != null ? Number(body.priceImpactPct) * 100 : null;
      return { sizeUsd, outUsd, priceImpactPct: impact, routed: outUsd > 0 };
    } catch (err) {
      return { sizeUsd, outUsd: null, priceImpactPct: null, routed: false, failReason: (err as Error).name === "AbortError" ? "timeout" : "fetch error" };
    } finally {
      clearTimeout(t);
    }
  }

  /** Quote a set of sizes (sequential, gentle on the public API). Sizes above the
   *  pool's practical depth are skipped and reported as such by the analyzer. */
  async sellQuotes(mint: string, decimals: number, priceUsd: number, sizesUsd: number[]): Promise<JupSellQuote[]> {
    const out: JupSellQuote[] = [];
    for (const s of sizesUsd) {
      out.push(await this.quoteOne(mint, decimals, priceUsd, s));
      await new Promise((r) => setTimeout(r, 120)); // ~8 req/s ceiling
    }
    return out;
  }

  /** Does a BUY route (USDC → token) exist for ~$50? Distinguishes a honeypot
   *  (buyable, not sellable) from a dead/unindexed pool. Returns null on API error. */
  async buyRouteExists(mint: string, sizeUsd = 50): Promise<boolean | null> {
    const amountRaw = Math.max(1, Math.floor(sizeUsd * 10 ** USDC_DECIMALS));
    const url = `${this.baseUrl}/quote?inputMint=${USDC_MINT}&outputMint=${mint}&amount=${amountRaw}&slippageBps=${this.slippageBps}&swapMode=ExactIn`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
      if (res.status === 400 || res.status === 404) return false;
      if (!res.ok) return null; // temporary API error
      const body = (await res.json().catch(() => ({}))) as { outAmount?: string; routePlan?: unknown[]; error?: string };
      if (body.error) return null;
      return !!(body.outAmount && body.routePlan && body.routePlan.length > 0);
    } catch { return null; }
    finally { clearTimeout(t); }
  }
}
