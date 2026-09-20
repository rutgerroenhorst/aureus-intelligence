/**
 * Helius adapter — the on-chain backbone.
 *
 * Binding behaviour (see decisions §3):
 *  - Without HELIUS_API_KEY the adapter is DEGRADED: every on-chain method returns
 *    evidenceStatus 'UNAVAILABLE' with payload null and a degradedReason. It NEVER
 *    fabricates live data.
 *  - The Safety engine treats any 'UNAVAILABLE' critical on-chain check as
 *    INCOMPLETE, so Safety can never reach PASSED while the key is missing.
 *  - An explicit MOCK mode (opt-in, tests/demo only) returns clearly-labelled
 *    placeholder data with evidenceStatus 'MOCK' — never 'VERIFIED'.
 */
import type { SourceMode } from "@aureus/contracts";
import type { SourceAdapter, AdapterResult } from "../types.js";
import { httpGet } from "../http.js";
import { TokenBucketLimiter } from "../rateLimiter.js";

export type HeliusMode = Extract<SourceMode, "LIVE" | "DEGRADED" | "MOCK">;

export interface HeliusOptions {
  apiKey?: string;
  /** Force MOCK mode for demos/tests. Ignored if a key is present unless explicit. */
  mock?: boolean;
  baseUrl?: string;
  rpcUrl?: string;
}

const WSOL_MINT = "So11111111111111111111111111111111111111112";

export class HeliusAdapter implements SourceAdapter {
  readonly source = "helius" as const;
  readonly mode: HeliusMode;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly limiter = new TokenBucketLimiter({ ratePerMinute: 120, burst: 5 });

  private readonly rpcUrl: string;
  // Free-plan safety: cap requests/sec (default 8 rps ≈ 480/min, burst 3).
  private readonly rpcLimiter: TokenBucketLimiter;
  constructor(opts: HeliusOptions = {}) {
    this.apiKey = opts.apiKey ?? "";
    this.baseUrl = opts.baseUrl ?? "https://api.helius.xyz";
    this.rpcUrl = opts.rpcUrl ?? `https://mainnet.helius-rpc.com/?api-key=${this.apiKey}`;
    this.mode = opts.mock ? "MOCK" : this.apiKey ? "LIVE" : "DEGRADED";
    const rps = Number(process.env.HELIUS_RPS ?? 8);
    this.rpcLimiter = new TokenBucketLimiter({ ratePerMinute: Math.max(1, rps) * 60, burst: 3 });
  }

  /**
   * JSON-RPC helper (LIVE only). Rate-limited (free-plan safe); 429/Retry-After is
   * surfaced as a retryable error so the queue backs off. Never logs the key.
   */
  private async rpc<T = unknown>(method: string, params: unknown[]): Promise<T> {
    await this.rpcLimiter.acquire();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(this.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: ctrl.signal,
      });
      if (res.status === 429) {
        const retryAfter = res.headers.get("retry-after") ?? "?";
        throw new Error(`rpc ${method}: 429 rate limited (retry-after ${retryAfter})`);
      }
      const body = (await res.json().catch(() => ({}))) as { result?: T; error?: { message?: string; code?: number } };
      if (!res.ok || body.error) throw new Error(this.sanitizeMsg(`rpc ${method}: ${body.error?.message ?? res.status}`));
      return body.result as T;
    } finally {
      clearTimeout(t);
    }
  }
  private sanitizeMsg(s: string): string { return this.apiKey ? s.split(this.apiKey).join("***") : s; }

  /** Total token supply (raw + decimals). */
  async tokenSupply(mint: string): Promise<{ amount: string; decimals: number } | null> {
    if (this.mode !== "LIVE") return null;
    const r = await this.rpc<{ value: { amount: string; decimals: number } }>("getTokenSupply", [mint]);
    return r?.value ?? null;
  }
  /** Top token accounts by balance (up to 20). */
  async tokenLargestAccounts(mint: string): Promise<Array<{ address: string; amount: string }> | null> {
    if (this.mode !== "LIVE") return null;
    const r = await this.rpc<{ value: Array<{ address: string; amount: string }> }>("getTokenLargestAccounts", [mint]);
    return r?.value ?? null;
  }
  /** Parsed mint account → mint/freeze authority + supply. */
  async mintAccount(mint: string): Promise<{ mintAuthority: string | null; freezeAuthority: string | null; supply: string; decimals: number } | null> {
    if (this.mode !== "LIVE") return null;
    const r = await this.rpc<{ value: { data: { parsed: { info: { mintAuthority: string | null; freezeAuthority: string | null; supply: string; decimals: number } } } } }>(
      "getAccountInfo", [mint, { encoding: "jsonParsed" }],
    );
    const info = r?.value?.data?.parsed?.info;
    return info ? { mintAuthority: info.mintAuthority ?? null, freezeAuthority: info.freezeAuthority ?? null, supply: info.supply, decimals: info.decimals } : null;
  }

  /** Resolve token-account → beneficial owner (jsonParsed getMultipleAccounts). */
  async accountOwners(tokenAccounts: string[]): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    if (this.mode !== "LIVE" || tokenAccounts.length === 0) return out;
    // getMultipleAccounts caps at 100 addresses/call.
    for (let i = 0; i < tokenAccounts.length; i += 100) {
      const batch = tokenAccounts.slice(i, i + 100);
      const r = await this.rpc<{ value: Array<{ data?: { parsed?: { info?: { owner?: string } } } } | null> }>("getMultipleAccounts", [batch, { encoding: "jsonParsed" }]);
      const vals = r?.value ?? [];
      batch.forEach((addr, j) => out.set(addr, vals[j]?.data?.parsed?.info?.owner ?? null));
    }
    return out;
  }

  /** Signatures for an address, newest-first (single page, ≤ limit). */
  async signaturesForAddress(address: string, limit = 1000, before?: string): Promise<Array<{ signature: string; slot: number; blockTime: number | null }>> {
    if (this.mode !== "LIVE") return [];
    const opts: Record<string, unknown> = { limit };
    if (before) opts.before = before;
    const r = await this.rpc<Array<{ signature: string; slot: number; blockTime: number | null }>>("getSignaturesForAddress", [address, opts]);
    return r ?? [];
  }

  /** Page back to the OLDEST signature of an address (bounded by maxPages). */
  async oldestSignature(address: string, maxPages = 5): Promise<{ signature: string; slot: number; blockTime: number | null } | null> {
    if (this.mode !== "LIVE") return null;
    let before: string | undefined;
    let last: { signature: string; slot: number; blockTime: number | null } | null = null;
    for (let page = 0; page < maxPages; page++) {
      const sigs = await this.signaturesForAddress(address, 1000, before);
      if (sigs.length === 0) break;
      last = sigs[sigs.length - 1]!;
      if (sigs.length < 1000) return last; // reached the beginning
      before = last.signature;
    }
    return last; // may not be the true oldest if maxPages hit
  }

  /** The fee-payer (first signer) of a transaction — used as the mint creator. */
  async transactionSigner(signature: string): Promise<string | null> {
    if (this.mode !== "LIVE") return null;
    const r = await this.rpc<{ transaction?: { message?: { accountKeys?: Array<string | { pubkey: string; signer?: boolean }> } } }>(
      "getTransaction", [signature, { maxSupportedTransactionVersion: 0, encoding: "jsonParsed" }],
    );
    const keys = r?.transaction?.message?.accountKeys ?? [];
    const first = keys[0];
    if (first == null) return null;
    return typeof first === "string" ? first : first.pubkey ?? null;
  }

  /** Sum an owner's balance of a specific mint (raw units). */
  async ownerTokenBalance(owner: string, mint: string): Promise<number | null> {
    if (this.mode !== "LIVE") return null;
    const r = await this.rpc<{ value: Array<{ account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }> }>(
      "getTokenAccountsByOwner", [owner, { mint }, { encoding: "jsonParsed" }],
    );
    const accounts = r?.value ?? [];
    if (accounts.length === 0) return 0;
    return accounts.reduce((s, a) => s + Number(a.account?.data?.parsed?.info?.tokenAmount?.amount ?? 0), 0);
  }

  /** True only when real on-chain data can be fetched. */
  get onChainAvailable(): boolean {
    return this.mode === "LIVE";
  }

  private unavailable(endpoint: string, naturalKey: string): AdapterResult<null> {
    return {
      source: this.source,
      endpoint,
      naturalKey,
      observedAt: null,
      evidenceStatus: "UNAVAILABLE",
      httpStatus: null,
      payload: null,
      degradedReason:
        "HELIUS_API_KEY not configured — on-chain check unavailable. Safety cannot PASS without it.",
    };
  }

  private mocked<T>(endpoint: string, naturalKey: string, payload: T): AdapterResult<T> {
    return {
      source: this.source,
      endpoint,
      naturalKey,
      observedAt: null,
      evidenceStatus: "MOCK",
      httpStatus: null,
      payload,
      degradedReason: "MOCK data — not real on-chain state.",
    };
  }

  private async live<T>(url: string, endpoint: string, naturalKey: string): Promise<AdapterResult<T>> {
    const res = await httpGet(url, { limiter: this.limiter });
    return {
      source: this.source,
      endpoint,
      naturalKey,
      observedAt: null,
      evidenceStatus: "VERIFIED",
      httpStatus: res.status,
      payload: res.json as T,
    };
  }

  /**
   * Mints currently transacting on a launch program — an on-chain discovery firehose.
   *
   * Measured reason this exists: Dexscreener surfaced ZERO new mints per discovery
   * cycle. Its search returns established pairs (median admitted age ~5-6 hours) and
   * its "latest" feeds are PAID-PROMOTION feeds, not launch feeds — the median coin
   * admitted from them was 33 hours old. Neither is a source of new coins; both are
   * sources of coins other people already found.
   *
   * This does NOT try to decode pool creation. It collects the mints touched by recent
   * transactions and hands them to the same admission test every other source passes
   * through, so a wrong guess costs one lookup and is rejected like anything else.
   * Parsing instruction data precisely would be more elegant and far easier to get
   * quietly wrong.
   */
  async launchProgramMints(programAddress: string, limit = 15): Promise<AdapterResult<string[]>> {
    const endpoint = "launch-program-mints";
    // An empty list, never null: callers iterate this, and a degraded source should
    // yield "no mints found" rather than a shape they have to special-case.
    if (this.mode === "DEGRADED") return { ...this.unavailable(endpoint, programAddress), payload: [] };
    if (this.mode === "MOCK") return { ...this.mocked(endpoint, programAddress, null), payload: [] };

    // The enhanced /v0/addresses/{program}/transactions endpoint returns 500 on these
    // programs — they have far too much history for it to page. Plain RPC handles the
    // same question in ~300ms, so this deliberately takes the less convenient route.
    const sigs = await this.signaturesForAddress(programAddress, limit);
    const mints = new Set<string>();
    const txs = await Promise.all(sigs.map((s) =>
      this.rpc<{ meta?: { postTokenBalances?: Array<{ mint?: string }> } } | null>(
        "getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }],
      ).catch(() => null)));
    for (const tx of txs) {
      for (const b of tx?.meta?.postTokenBalances ?? []) {
        // Wrapped SOL appears in essentially every swap and is never the coin.
        if (b.mint && b.mint !== WSOL_MINT) mints.add(b.mint);
      }
    }
    return {
      source: this.source, endpoint, naturalKey: programAddress, observedAt: null,
      evidenceStatus: "VERIFIED", httpStatus: 200, payload: [...mints],
    };
  }

  /** Deployer + creation info for a mint. */
  async deployerInfo(mint: string): Promise<AdapterResult> {
    const endpoint = "deployer-info";
    if (this.mode === "DEGRADED") return this.unavailable(endpoint, mint);
    if (this.mode === "MOCK") return this.mocked(endpoint, mint, { deployer: null, note: "mock" });
    return this.live(`${this.baseUrl}/v0/addresses/${mint}/transactions?api-key=${this.apiKey}`, endpoint, mint);
  }

  /** Backward funding chain for a wallet. */
  async fundingChain(wallet: string): Promise<AdapterResult> {
    const endpoint = "funding-chain";
    if (this.mode === "DEGRADED") return this.unavailable(endpoint, wallet);
    if (this.mode === "MOCK") return this.mocked(endpoint, wallet, { funders: [], note: "mock" });
    return this.live(`${this.baseUrl}/v0/addresses/${wallet}/transactions?api-key=${this.apiKey}`, endpoint, wallet);
  }

  /** Large holders / holder graph basis for cluster detection. */
  async holders(mint: string): Promise<AdapterResult> {
    const endpoint = "holders";
    if (this.mode === "DEGRADED") return this.unavailable(endpoint, mint);
    if (this.mode === "MOCK") return this.mocked(endpoint, mint, { holders: [], note: "mock" });
    return this.live(`${this.baseUrl}/v0/token/${mint}/holders?api-key=${this.apiKey}`, endpoint, mint);
  }

  /** Mint & freeze authority + sellability inputs. */
  async mintAuthorities(mint: string): Promise<AdapterResult> {
    const endpoint = "mint-authorities";
    if (this.mode === "DEGRADED") return this.unavailable(endpoint, mint);
    if (this.mode === "MOCK") return this.mocked(endpoint, mint, { mintAuthority: null, freezeAuthority: null, note: "mock" });
    return this.live(`${this.baseUrl}/v0/token/${mint}?api-key=${this.apiKey}`, endpoint, mint);
  }

  /** LP add/remove events for a pool. */
  async lpEvents(pool: string): Promise<AdapterResult> {
    const endpoint = "lp-events";
    if (this.mode === "DEGRADED") return this.unavailable(endpoint, pool);
    if (this.mode === "MOCK") return this.mocked(endpoint, pool, { events: [], note: "mock" });
    return this.live(`${this.baseUrl}/v0/addresses/${pool}/transactions?api-key=${this.apiKey}`, endpoint, pool);
  }
}
