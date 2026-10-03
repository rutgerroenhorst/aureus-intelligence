import "server-only";
import { q } from "./db";

export interface Signal {
  id: string;
  candidateId: string;
  eventType: string;
  eventCategory: string;
  eventPriority: string;
  eventLabel: string;
  eventDescription: string | null;
  changePct: number | null;
  changeRaw: string | null;
  durationMs: number | null;
  priceUsd: string | null;
  marketCapUsd: string | null;
  liquidityUsd: string | null;
  volume24hUsd: string | null;
  statusFrom: string | null;
  statusTo: string | null;
  walletCount: number | null;
  netFlowSol: string | null;
  metadata: Record<string, any>;
  createdAt: string;
  observedAt: string;
}

/**
 * Emit a signal event. Automatically deduplicates based on event_hash.
 */
export async function emitSignal(params: {
  candidateId: string;
  eventType: string;
  eventCategory: string;
  eventPriority: "CRITICAL" | "HIGH" | "INFORMATIONAL";
  eventLabel: string;
  eventDescription?: string;
  changePct?: number;
  changeRaw?: string;
  durationMs?: number;
  priceUsd?: string;
  marketCapUsd?: string;
  liquidityUsd?: string;
  volume24hUsd?: string;
  statusFrom?: string;
  statusTo?: string;
  walletCount?: number;
  netFlowSol?: string;
  metadata?: Record<string, any>;
}): Promise<Signal | null> {
  const eventHash = `${params.candidateId}:${params.eventType}:${params.statusFrom || ""}:${params.statusTo || ""}`;
  
  const result = await q<any>(
    `INSERT INTO signals (
      candidate_id, event_type, event_category, event_priority, event_label, event_description,
      change_pct, change_raw, duration_ms, price_usd, market_cap_usd, liquidity_usd, volume_24h_usd,
      status_from, status_to, wallet_count, net_flow_sol, metadata, event_hash
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    ON CONFLICT (event_hash) DO NOTHING
    RETURNING id, candidate_id, event_type, event_category, event_priority, event_label, event_description,
      change_pct, change_raw, duration_ms, price_usd, market_cap_usd, liquidity_usd, volume_24h_usd,
      status_from, status_to, wallet_count, net_flow_sol, metadata, created_at, observed_at`,
    [
      params.candidateId,
      params.eventType,
      params.eventCategory,
      params.eventPriority,
      params.eventLabel,
      params.eventDescription || null,
      params.changePct || null,
      params.changeRaw || null,
      params.durationMs || null,
      params.priceUsd || null,
      params.marketCapUsd || null,
      params.liquidityUsd || null,
      params.volume24hUsd || null,
      params.statusFrom || null,
      params.statusTo || null,
      params.walletCount || null,
      params.netFlowSol || null,
      JSON.stringify(params.metadata || {}),
      eventHash,
    ]
  );

  return result[0] ? mapSignalRow(result[0]) : null;
}

/**
 * Fetch recent signals with optional filtering.
 */
export async function fetchSignals(options?: {
  limit?: number;
  offset?: number;
  eventType?: string;
  eventCategory?: string;
  eventPriority?: string;
  since?: Date;
}): Promise<Signal[]> {
  const limit = options?.limit ?? 100;
  const offset = options?.offset ?? 0;
  
  let sql = "SELECT * FROM signals WHERE 1=1";
  const params: any[] = [];
  let paramIndex = 1;

  if (options?.eventType) {
    sql += ` AND event_type = $${paramIndex++}`;
    params.push(options.eventType);
  }
  if (options?.eventCategory) {
    sql += ` AND event_category = $${paramIndex++}`;
    params.push(options.eventCategory);
  }
  if (options?.eventPriority) {
    sql += ` AND event_priority = $${paramIndex++}`;
    params.push(options.eventPriority);
  }
  if (options?.since) {
    sql += ` AND created_at >= $${paramIndex++}`;
    params.push(options.since.toISOString());
  }

  sql += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
  params.push(limit, offset);

  const rows = await q<any>(sql, params);
  return rows.map(mapSignalRow);
}

function mapSignalRow(row: any): Signal {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    eventType: row.event_type,
    eventCategory: row.event_category,
    eventPriority: row.event_priority,
    eventLabel: row.event_label,
    eventDescription: row.event_description,
    changePct: row.change_pct ? Number(row.change_pct) : null,
    changeRaw: row.change_raw,
    durationMs: row.duration_ms,
    priceUsd: row.price_usd,
    marketCapUsd: row.market_cap_usd,
    liquidityUsd: row.liquidity_usd,
    volume24hUsd: row.volume_24h_usd,
    statusFrom: row.status_from,
    statusTo: row.status_to,
    walletCount: row.wallet_count,
    netFlowSol: row.net_flow_sol,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    observedAt: row.observed_at,
  };
}
