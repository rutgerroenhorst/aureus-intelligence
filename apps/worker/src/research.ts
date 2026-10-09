import type { Pool } from "pg";
import { computePaperTracking, computeResearchSummary, type SeriesPoint } from "@aureus/research";

/**
 * Compute + persist paper tracking and the research summary for one candidate,
 * from the price/liquidity/volume time-series already stored. Automatic (called
 * by the worker each cycle) and idempotent (upserts). No new signals collected.
 */
export async function computeAndPersistResearch(pool: Pool, candidateId: string, nowMs: number): Promise<void> {
  const meta = await pool.query<{ pool_id: string; discovered_ms: string; state: string; created_src_ms: string | null }>(
    `SELECT c.pool_id, extract(epoch from c.discovered_at)*1000 AS discovered_ms, c.current_state AS state,
            extract(epoch from p.created_at_src)*1000 AS created_src_ms
     FROM candidates c LEFT JOIN pools p ON p.id=c.pool_id WHERE c.id=$1`,
    [candidateId],
  );
  const row = meta.rows[0];
  if (!row || !row.pool_id) return;
  const discoveryAtMs = Number(row.discovered_ms);

  const s = await pool.query<{ at: string; price_usd: string | null; fdv_usd: string | null; liquidity_usd: string | null; volume_usd: string | null }>(
    `SELECT extract(epoch from p.observed_at)*1000 AS at, p.price_usd, p.fdv_usd, l.liquidity_usd, t.volume_usd
     FROM prices p
     LEFT JOIN liquidity_snapshots l ON l.pool_id=p.pool_id AND l.observed_at=p.observed_at
     LEFT JOIN transaction_aggregates t ON t.pool_id=p.pool_id AND t.observed_at=p.observed_at
     WHERE p.pool_id=$1 ORDER BY p.observed_at`,
    [row.pool_id],
  );
  if (s.rows.length === 0) return;

  const series: SeriesPoint[] = s.rows
    .filter((r) => r.price_usd != null)
    .map((r) => ({ atMs: Number(r.at), price: Number(r.price_usd), liquidityUsd: r.liquidity_usd != null ? Number(r.liquidity_usd) : null, volumeUsd: r.volume_usd != null ? Number(r.volume_usd) : null }));
  if (series.length === 0) return;

  const anchorFdv = s.rows.find((r) => r.fdv_usd != null)?.fdv_usd ?? null;
  const summary = computeResearchSummary(series, discoveryAtMs, nowMs);
  const points = computePaperTracking(series, discoveryAtMs, nowMs);
  const pairAge = row.created_src_ms ? Math.round((discoveryAtMs - Number(row.created_src_ms)) / 1000) : null;

  for (const p of points) {
    await pool.query(
      `INSERT INTO paper_tracking (candidate_id, horizon, anchor_at, target_at, measured_at, anchor_price, price, return_pct, max_drawdown_pct, max_runup_pct, liquidity_usd, volume_usd, window_complete)
       VALUES ($1,$2,to_timestamp($3),to_timestamp($4),to_timestamp($5),$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (candidate_id, horizon) DO UPDATE SET
         target_at=EXCLUDED.target_at, measured_at=EXCLUDED.measured_at, anchor_price=EXCLUDED.anchor_price,
         price=EXCLUDED.price, return_pct=EXCLUDED.return_pct, max_drawdown_pct=EXCLUDED.max_drawdown_pct,
         max_runup_pct=EXCLUDED.max_runup_pct, liquidity_usd=EXCLUDED.liquidity_usd, volume_usd=EXCLUDED.volume_usd,
         window_complete=EXCLUDED.window_complete`,
      [candidateId, p.horizon, p.anchorAtMs / 1000, p.targetAtMs / 1000, nowMs / 1000, p.anchorPrice, p.price, p.returnPct, p.maxDrawdownPct, p.maxRunupPct, p.liquidityUsd, p.volumeUsd, p.windowComplete],
    );
  }

  await pool.query(
    `INSERT INTO candidate_research
       (candidate_id, discovered_at, discovery_price, discovery_liquidity_usd, discovery_fdv_usd, discovery_volume_usd,
        pair_age_at_discovery_s, observations, last_observed_at, final_return_pct, return_24h_pct, window_24h_complete,
        peak_return_pct, max_drawdown_pct, time_to_peak_s, liquidity_growth_pct, volume_growth_pct, lifespan_s, is_rug, reached_state, computed_at)
     VALUES ($1,to_timestamp($2),$3,$4,$5,$6,$7,$8,to_timestamp($9),$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,now())
     ON CONFLICT (candidate_id) DO UPDATE SET
       observations=EXCLUDED.observations, last_observed_at=EXCLUDED.last_observed_at, final_return_pct=EXCLUDED.final_return_pct,
       return_24h_pct=EXCLUDED.return_24h_pct, window_24h_complete=EXCLUDED.window_24h_complete, peak_return_pct=EXCLUDED.peak_return_pct,
       max_drawdown_pct=EXCLUDED.max_drawdown_pct, time_to_peak_s=EXCLUDED.time_to_peak_s, liquidity_growth_pct=EXCLUDED.liquidity_growth_pct,
       volume_growth_pct=EXCLUDED.volume_growth_pct, lifespan_s=EXCLUDED.lifespan_s, is_rug=EXCLUDED.is_rug,
       reached_state=EXCLUDED.reached_state, discovery_fdv_usd=EXCLUDED.discovery_fdv_usd, computed_at=now()`,
    [
      candidateId, discoveryAtMs / 1000, summary.discoveryPrice, summary.discoveryLiquidityUsd, anchorFdv != null ? Number(anchorFdv) : null,
      summary.discoveryVolumeUsd, pairAge, summary.observations, (series[series.length - 1]!.atMs) / 1000,
      summary.finalReturnPct, summary.return24hPct, summary.window24hComplete, summary.peakReturnPct, summary.maxDrawdownPct,
      summary.timeToPeakS, summary.liquidityGrowthPct, summary.volumeGrowthPct, summary.lifespanS, summary.isRug, row.state,
    ],
  );
}
