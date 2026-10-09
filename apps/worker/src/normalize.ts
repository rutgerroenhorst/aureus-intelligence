import type { PoolClient, Pool } from "pg";
import type { FeatureInput, OnChainIntel } from "@aureus/feature-engine";

/** Minimal shape of a Dex Screener pair we rely on. */
export interface DexPair {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string; symbol?: string };
  priceUsd?: string;
  priceNative?: string;
  liquidity?: { usd?: number; base?: number; quote?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  volume?: { h24?: number; h6?: number; h1?: number; m5?: number };
  txns?: { h24?: { buys?: number; sells?: number }; h6?: { buys?: number; sells?: number }; h1?: { buys?: number; sells?: number }; m5?: { buys?: number; sells?: number } };
  /** Multi-horizon price change from Dex Screener — used by the evidence-based gates. */
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
}

export interface PersistResult {
  candidateId: string;
  tokenId: string;
  poolId: string;
  discoveredAtMs: number;
  isNewCandidate: boolean;
}

/** Pick the primary pair for a mint (highest USD liquidity). */
export function primaryPair(pairs: unknown): DexPair | null {
  if (!Array.isArray(pairs) || pairs.length === 0) return null;
  const withPair = (pairs as DexPair[]).filter((p) => p.pairAddress && p.chainId);
  if (withPair.length === 0) return null;
  return withPair.reduce((best, p) => ((p.liquidity?.usd ?? 0) > (best.liquidity?.usd ?? 0) ? p : best));
}

/**
 * Idempotently persist identities + a time-series observation for one pair.
 * Candidate identity is deduped on (token, pool): re-polling the same pair maps
 * to the same candidate — no duplicate candidates.
 */
export async function persistMarketData(
  client: PoolClient,
  pair: DexPair,
  pollMs: number,
): Promise<PersistResult> {
  const mint = pair.baseToken!.address!;
  const poolAddr = pair.pairAddress!;
  const discoveredAtMs = pair.pairCreatedAt ?? pollMs;
  const tok = await client.query<{ id: string }>(
    `INSERT INTO tokens (chain, mint, symbol_label, name_label)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (chain, mint) DO UPDATE SET symbol_label=COALESCE(EXCLUDED.symbol_label, tokens.symbol_label)
     RETURNING id`,
    [pair.chainId ?? 'solana', mint, pair.baseToken?.symbol ?? null, pair.baseToken?.name ?? null],
  );
  const tokenId = tok.rows[0]!.id;

  const pl = await client.query<{ id: string }>(
    `INSERT INTO pools (chain, pool_address, token_id, quote_mint, dex, created_at_src)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (chain, pool_address) DO UPDATE SET dex=COALESCE(EXCLUDED.dex, pools.dex)
     RETURNING id`,
    [pair.chainId ?? 'solana', poolAddr, tokenId, pair.quoteToken?.address ?? null, pair.dexId ?? null, pair.pairCreatedAt ? new Date(pair.pairCreatedAt).toISOString() : null],
  );
  const poolId = pl.rows[0]!.id;

  // Candidate dedup on (token, pool).
  const existing = await client.query<{ id: string; discovered_at: string }>(
    `SELECT id, discovered_at FROM candidates WHERE token_id=$1 AND pool_id=$2 LIMIT 1`,
    [tokenId, poolId],
  );
  let candidateId: string;
  let isNewCandidate = false;
  if (existing.rows[0]) {
    candidateId = existing.rows[0].id;
  } else {
    const code = `AUR-${poolAddr.slice(0, 10)}`;
    const ins = await client.query<{ id: string }>(
      `INSERT INTO candidates (candidate_code, token_id, pool_id, discovered_at, discovery_source, current_state)
       VALUES ($1,$2,$3,to_timestamp($4),'dexscreener','RESEARCHING')
       ON CONFLICT (candidate_code) DO NOTHING RETURNING id`,
      [code, tokenId, poolId, discoveredAtMs / 1000],
    );
    if (ins.rows[0]) {
      candidateId = ins.rows[0].id;
      isNewCandidate = true;
      await client.query(
        `INSERT INTO discovery_snapshots (candidate_id, snapshot, source, observed_at)
         VALUES ($1,$2,'dexscreener',to_timestamp($3)) ON CONFLICT (candidate_id) DO NOTHING`,
        [candidateId, JSON.stringify({ pair }), discoveredAtMs / 1000],
      );
    } else {
      const again = await client.query<{ id: string }>(`SELECT id FROM candidates WHERE candidate_code=$1`, [code]);
      candidateId = again.rows[0]!.id;
    }
  }

  // Raw event (idempotent) + time-series observations.
  const idem = `dexscreener:tokens:${mint}:${pollMs}`;
  const raw = await client.query<{ id: string }>(
    `INSERT INTO raw_events (source, endpoint, natural_key, idempotency_key, observed_at, http_status, payload)
     VALUES ('dexscreener','/tokens/v1',$1,$2,to_timestamp($3),200,$4)
     ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
    [mint, idem, pollMs / 1000, JSON.stringify(pair)],
  );
  const rawId = raw.rows[0]?.id ?? null;

  if (pair.priceUsd) {
    await client.query(
      `INSERT INTO prices (pool_id, price_usd, price_native, market_cap_usd, fdv_usd, source, observed_at, raw_event_id)
       VALUES ($1,$2,$3,$4,$5,'dexscreener',to_timestamp($6),$7)`,
      [poolId, pair.priceUsd, pair.priceNative ?? null, pair.marketCap ?? null, pair.fdv ?? null, pollMs / 1000, rawId],
    );
  }
  if (pair.liquidity?.usd != null) {
    await client.query(
      `INSERT INTO liquidity_snapshots (pool_id, liquidity_usd, base_reserve, quote_reserve, source, observed_at, raw_event_id)
       VALUES ($1,$2,$3,$4,'dexscreener',to_timestamp($5),$6)`,
      [poolId, pair.liquidity.usd, pair.liquidity.base ?? null, pair.liquidity.quote ?? null, pollMs / 1000, rawId],
    );
  }
  if (pair.txns?.h1) {
    await client.query(
      `INSERT INTO transaction_aggregates (pool_id, window_seconds, buys, sells, volume_usd, source, observed_at, raw_event_id)
       VALUES ($1,3600,$2,$3,$4,'dexscreener',to_timestamp($5),$6)`,
      [poolId, pair.txns.h1.buys ?? null, pair.txns.h1.sells ?? null, pair.volume?.h1 ?? null, pollMs / 1000, rawId],
    );
  }
  await client.query(
    `INSERT INTO observations (candidate_id, kind, value, source, observed_at, evidence_status, raw_event_id)
     VALUES ($1,'market_snapshot',$2,'dexscreener',to_timestamp($3),'VERIFIED',$4)`,
    [candidateId, JSON.stringify({ priceUsd: pair.priceUsd, liquidity: pair.liquidity?.usd, marketCap: pair.marketCap, fdv: pair.fdv }), pollMs / 1000, rawId],
  );

  return { candidateId, tokenId, poolId, discoveredAtMs, isNewCandidate };
}

/** Assemble the feature-engine input from persisted rows for a pool. */
export async function assembleFeatureInput(
  pool: Pool,
  poolId: string,
  discoveredAtMs: number,
  nowMs: number,
  onChain: OnChainIntel,
): Promise<FeatureInput> {
  const sinceIso = new Date(nowMs - 6 * 60 * 60_000).toISOString();
  const [prices, liq, tx] = await Promise.all([
    pool.query(`SELECT extract(epoch from observed_at)*1000 AS t, price_usd, market_cap_usd, source FROM prices WHERE pool_id=$1 AND observed_at>=$2 ORDER BY observed_at`, [poolId, sinceIso]),
    pool.query(`SELECT extract(epoch from observed_at)*1000 AS t, liquidity_usd, source FROM liquidity_snapshots WHERE pool_id=$1 AND observed_at>=$2 ORDER BY observed_at`, [poolId, sinceIso]),
    pool.query(`SELECT extract(epoch from observed_at)*1000 AS t, window_seconds, buys, sells, buyers, sellers, volume_usd, source FROM transaction_aggregates WHERE pool_id=$1 AND observed_at>=$2 ORDER BY observed_at`, [poolId, sinceIso]),
  ]);
  return {
    nowMs,
    discoveryAtMs: discoveredAtMs,
    prices: prices.rows.map((r) => ({ observedAtMs: Number(r.t), priceUsd: Number(r.price_usd), marketCapUsd: r.market_cap_usd != null ? Number(r.market_cap_usd) : undefined, source: r.source })),
    liquidity: liq.rows.map((r) => ({ observedAtMs: Number(r.t), liquidityUsd: Number(r.liquidity_usd), source: r.source })),
    txAggregates: tx.rows.map((r) => ({ observedAtMs: Number(r.t), windowSeconds: Number(r.window_seconds), buys: r.buys ?? undefined, sells: r.sells ?? undefined, buyers: r.buyers ?? undefined, sellers: r.sellers ?? undefined, netFlowUsd: undefined, source: r.source })),
    holders: [],
    social: [],
    onChain,
    sourcesPresent: onChain.available ? ["dexscreener", "helius"] : ["dexscreener"],
  };
}
