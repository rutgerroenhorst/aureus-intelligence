import "server-only";
import type { Readiness } from "@aureus/readiness";
import { q } from "./db";

export interface CandidateRow {
  id: string;
  candidate_code: string;
  current_state: string;
  discovered_at: string;
  discovery_source: string;
  mint: string;
  symbol_label: string | null;
  name_label: string | null;
  pool_address: string | null;
  dex: string | null;
  price_usd: string | null;
  market_cap_usd: string | null;
  fdv_usd: string | null;
  price_at: string | null;
  liquidity_usd: string | null;
  liq_at: string | null;
  buys: number | null;
  sells: number | null;
  volume_usd: string | null;
  readiness: Readiness | null;
  last_meaningful_change_at: string | null;
  enrichment_status: string;
  monitoring_tier: string;
  priority_score: string | null;
  next_scan_at: string | null;
}

const CANDIDATE_SELECT = `
  SELECT c.id, c.candidate_code, c.current_state, c.discovered_at, c.discovery_source,
    t.mint, t.symbol_label, t.name_label, p.pool_address, p.dex,
    pr.price_usd, pr.market_cap_usd, pr.fdv_usd, pr.observed_at AS price_at,
    lq.liquidity_usd, lq.observed_at AS liq_at,
    tx.buys, tx.sells, tx.volume_usd,
    c.readiness, c.last_meaningful_change_at,
    c.enrichment_status, c.monitoring_tier, c.priority_score, c.next_scan_at
  FROM candidates c
  JOIN tokens t ON t.id = c.token_id
  LEFT JOIN pools p ON p.id = c.pool_id
  LEFT JOIN LATERAL (SELECT price_usd, market_cap_usd, fdv_usd, observed_at FROM prices WHERE pool_id=c.pool_id ORDER BY observed_at DESC LIMIT 1) pr ON true
  LEFT JOIN LATERAL (SELECT liquidity_usd, observed_at FROM liquidity_snapshots WHERE pool_id=c.pool_id ORDER BY observed_at DESC LIMIT 1) lq ON true
  LEFT JOIN LATERAL (SELECT buys, sells, volume_usd FROM transaction_aggregates WHERE pool_id=c.pool_id ORDER BY observed_at DESC LIMIT 1) tx ON true
`;

// Fixtures/test rows (source 'mock' or 'manual') are never shown as live data.
const LIVE_ONLY = `c.discovery_source NOT IN ('mock','manual')`;

export async function stateCounts(): Promise<Record<string, number>> {
  const rows = await q<{ current_state: string; n: string }>(
    `SELECT current_state, count(*)::int AS n FROM candidates c WHERE ${LIVE_ONLY} GROUP BY current_state`,
  );
  const out: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    out[r.current_state] = Number(r.n);
    total += Number(r.n);
  }
  out.TOTAL = total;
  return out;
}

export async function recentCandidates(limit = 10): Promise<CandidateRow[]> {
  return q<CandidateRow>(`${CANDIDATE_SELECT} WHERE ${LIVE_ONLY} ORDER BY c.discovered_at DESC LIMIT $1`, [limit]);
}

export interface DiscoverFilters {
  state?: string;
  minLiquidity?: number;
  minVolume?: number;
  maxPairAgeHours?: number;
  search?: string;
  sort?: string;
  enrichment?: string;
  tier?: string;
}

// Whitelisted sort expressions (no user SQL injection).
const SORTS: Record<string, string> = {
  discovered: "s.discovered_at DESC",
  freshness: "s.price_at DESC NULLS LAST",
  liquidity: "coalesce(s.liquidity_usd::numeric,0) DESC",
  volume: "coalesce(s.volume_usd::numeric,0) DESC",
  pair_age: "s.discovered_at ASC",
  data_completeness: "coalesce((s.readiness->>'dataCompleteness')::numeric,0) DESC",
  incomplete_critical: "coalesce((s.readiness->>'incompleteCritical')::int,0) DESC",
  last_change: "s.last_meaningful_change_at DESC NULLS LAST",
  priority: "s.priority_score DESC",
  enrichment: "s.enrichment_status",
};

export async function discoverCandidates(f: DiscoverFilters, limit = 100): Promise<CandidateRow[]> {
  const where: string[] = [LIVE_ONLY];
  const params: unknown[] = [];
  if (f.state) { params.push(f.state); where.push(`c.current_state = $${params.length}`); }
  if (f.enrichment) { params.push(f.enrichment); where.push(`c.enrichment_status = $${params.length}`); }
  if (f.tier) { params.push(f.tier); where.push(`c.monitoring_tier = $${params.length}`); }
  if (f.search) { params.push(`%${f.search}%`); where.push(`(t.mint ILIKE $${params.length} OR coalesce(t.symbol_label,'') ILIKE $${params.length} OR coalesce(p.pool_address,'') ILIKE $${params.length})`); }
  if (f.maxPairAgeHours != null) { params.push(f.maxPairAgeHours); where.push(`c.discovered_at >= now() - ($${params.length} || ' hours')::interval`); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  // liquidity/volume filters apply to the LATERAL-derived columns → filter in an outer query.
  const outer: string[] = [];
  const outerParams: unknown[] = [...params];
  if (f.minLiquidity != null) { outerParams.push(f.minLiquidity); outer.push(`coalesce(liquidity_usd::numeric,0) >= $${outerParams.length}`); }
  if (f.minVolume != null) { outerParams.push(f.minVolume); outer.push(`coalesce(volume_usd::numeric,0) >= $${outerParams.length}`); }
  outerParams.push(limit);
  const outerWhere = outer.length ? `WHERE ${outer.join(" AND ")}` : "";
  const orderBy = SORTS[f.sort ?? "discovered"] ?? SORTS.discovered;
  return q<CandidateRow>(
    `SELECT * FROM (${CANDIDATE_SELECT} ${whereSql}) s ${outerWhere} ORDER BY ${orderBy} LIMIT $${outerParams.length}`,
    outerParams,
  );
}

export async function getCandidate(id: string): Promise<CandidateRow | null> {
  const rows = await q<CandidateRow>(`${CANDIDATE_SELECT} WHERE c.id = $1 LIMIT 1`, [id]);
  return rows[0] ?? null;
}

export interface RuleRow {
  candidate_id: string;
  rule_id: string;
  family: string;
  result: string;
  severity: string;
  explanation: string;
  invalidation: string;
  evidence: Record<string, unknown>;
  evaluated_at: string;
  evidence_hash: string | null;
}

/** Latest evaluation per rule for the given candidates. */
export async function latestRulesFor(ids: string[]): Promise<Map<string, RuleRow[]>> {
  const map = new Map<string, RuleRow[]>();
  if (ids.length === 0) return map;
  const rows = await q<RuleRow>(
    `SELECT candidate_id, rule_id, family, result, severity, explanation, invalidation, evidence, evaluated_at, evidence_hash
     FROM rule_evaluations_current WHERE candidate_id = ANY($1)`,
    [ids],
  );
  for (const r of rows) {
    const arr = map.get(r.candidate_id) ?? [];
    arr.push(r);
    map.set(r.candidate_id, arr);
  }
  return map;
}

export interface FeatureRow {
  feature_id: string;
  status: string;
  value: string | null;
  unit: string;
  data_quality: string | null;
  missing_reason: string | null;
  explanation: string;
  calculated_at: string;
  version: string;
  evidence_hash: string | null;
}

export async function latestFeatures(id: string): Promise<FeatureRow[]> {
  return q<FeatureRow>(
    `SELECT DISTINCT ON (feature_id) feature_id, status, value, unit, data_quality, missing_reason, explanation, calculated_at, version, evidence_hash
     FROM feature_values WHERE candidate_id=$1 ORDER BY feature_id, calculated_at DESC`,
    [id],
  );
}

export async function latestDecisionReason(id: string): Promise<{ reason: string; to_state: string; at: string } | null> {
  const rows = await q<{ reason: string; to_state: string; at: string }>(
    `SELECT reason, to_state, at FROM decision_state_history WHERE candidate_id=$1 ORDER BY at DESC LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

export interface StateHistoryRow {
  from_state: string | null;
  to_state: string;
  reason: string;
  safety_status: string | null;
  entry_status: string | null;
  at: string;
}

export async function stateHistory(id: string): Promise<StateHistoryRow[]> {
  return q<StateHistoryRow>(
    `SELECT from_state, to_state, reason, safety_status, entry_status, at
     FROM decision_state_history WHERE candidate_id=$1 ORDER BY at DESC LIMIT 50`,
    [id],
  );
}

export async function dataQualityStatus(id: string): Promise<string | null> {
  const rows = await q<{ data_quality_status: string }>(
    `SELECT data_quality_status FROM candidate_snapshots WHERE candidate_id=$1 ORDER BY taken_at DESC LIMIT 1`,
    [id],
  );
  return rows[0]?.data_quality_status ?? null;
}

export interface TimelineItem {
  at: string;
  type: string;
  label: string;
  detail: string | null;
}

export async function timeline(id: string): Promise<TimelineItem[]> {
  const rows = await q<TimelineItem>(
    `
    SELECT at, 'state' AS type, ('State → ' || to_state) AS label, reason AS detail
      FROM decision_state_history WHERE candidate_id=$1
    UNION ALL
    SELECT at, 'notebook' AS type, entry_type AS label, note AS detail
      FROM research_notebook_entries WHERE candidate_id=$1
    UNION ALL
    SELECT taken_at AS at, 'snapshot' AS type, ('Snapshot ' || kind) AS label, ('data quality: ' || data_quality_status) AS detail
      FROM candidate_snapshots WHERE candidate_id=$1
    UNION ALL
    SELECT ingested_at AS at, 'observation' AS type, kind AS label, NULL AS detail
      FROM observations WHERE candidate_id=$1
    ORDER BY at DESC LIMIT 40
    `,
    [id],
  );
  return rows;
}

// ── Enrichment / monitoring ────────────────────────────────────────────────
export const HELIUS_DEPENDENT_RULES = [
  "SAFE-01-CRITICAL-DATA", "SAFE-02-BLACKLIST-FUNDING", "SAFE-03-INSIDER-CONCENTRATION",
  "SAFE-04-BUNDLE-CONTAMINATION", "SAFE-06-AUTHORITY-SELLABILITY", "QUAL-03-SMART-PARTICIPATION",
];

export interface EnrichmentInfo {
  status: string;
  data_version: string | null;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  last_success_at: string | null;
  next_retry_at: string | null;
  attempts: number;
  last_error: string | null;
  monitoring_tier: string;
  priority_score: string | null;
  priority_components: Record<string, number> | null;
  next_scan_at: string | null;
  monitoring_expires_at: string | null;
  downgrade_reason: string | null;
  stop_monitoring_reason: string | null;
  datasets: Record<string, { status: string; reason?: string }> | null;
}

export async function getEnrichment(candidateId: string): Promise<EnrichmentInfo | null> {
  const rows = await q<EnrichmentInfo>(
    `SELECT c.enrichment_status AS status, c.enrichment_data_version AS data_version,
       c.enrichment_queued_at AS queued_at, c.enrichment_started_at AS started_at,
       c.enrichment_completed_at AS completed_at, c.enrichment_last_success_at AS last_success_at,
       c.enrichment_next_retry_at AS next_retry_at, c.enrichment_attempts AS attempts,
       c.enrichment_last_error AS last_error, c.monitoring_tier, c.priority_score, c.priority_components,
       c.next_scan_at, c.monitoring_expires_at, c.downgrade_reason, c.stop_monitoring_reason,
       oe.datasets
     FROM candidates c LEFT JOIN onchain_enrichment oe ON oe.candidate_id=c.id WHERE c.id=$1`,
    [candidateId],
  );
  return rows[0] ?? null;
}

export async function enrichmentCounts(): Promise<Record<string, number>> {
  const rows = await q<{ enrichment_status: string; n: string }>(
    `SELECT enrichment_status, count(*)::int n FROM candidates WHERE discovery_source NOT IN ('mock','manual') GROUP BY enrichment_status`,
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.enrichment_status] = Number(r.n);
  return out;
}

export async function tierCounts(): Promise<Record<string, number>> {
  const rows = await q<{ monitoring_tier: string; n: string }>(
    `SELECT monitoring_tier, count(*)::int n FROM candidates WHERE discovery_source NOT IN ('mock','manual') GROUP BY monitoring_tier`,
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.monitoring_tier] = Number(r.n);
  return out;
}

// ── Replay ─────────────────────────────────────────────────────────────────
export interface ReplayEvent { atMs: number; type: string; label: string }
export interface ReplayPoint { atMs: number; price: number; liquidity: number | null }
export interface ReplayData { events: ReplayEvent[]; prices: ReplayPoint[]; discoveredAtMs: number }

export async function replayData(candidateId: string): Promise<ReplayData> {
  const [meta, states, notes, snaps, alerts, prices] = await Promise.all([
    q<{ ms: string; pool_id: string }>(`SELECT extract(epoch from discovered_at)*1000 ms, pool_id FROM candidates WHERE id=$1`, [candidateId]),
    q<{ ms: string; to_state: string; reason: string }>(`SELECT extract(epoch from at)*1000 ms, to_state, reason FROM decision_state_history WHERE candidate_id=$1 ORDER BY at`, [candidateId]),
    q<{ ms: string; entry_type: string; note: string | null }>(`SELECT extract(epoch from at)*1000 ms, entry_type, note FROM research_notebook_entries WHERE candidate_id=$1 ORDER BY at`, [candidateId]),
    q<{ ms: string; kind: string }>(`SELECT extract(epoch from taken_at)*1000 ms, kind FROM candidate_snapshots WHERE candidate_id=$1`, [candidateId]),
    q<{ ms: string; level: string }>(`SELECT extract(epoch from created_at)*1000 ms, level FROM alert_events WHERE candidate_id=$1`, [candidateId]),
    q<{ ms: string; price_usd: string; liquidity_usd: string | null }>(
      `SELECT extract(epoch from p.observed_at)*1000 ms, p.price_usd, l.liquidity_usd
       FROM prices p LEFT JOIN liquidity_snapshots l ON l.pool_id=p.pool_id AND l.observed_at=p.observed_at
       JOIN candidates c ON c.pool_id=p.pool_id WHERE c.id=$1 ORDER BY p.observed_at`, [candidateId]),
  ]);
  const events: ReplayEvent[] = [
    ...states.map((s) => ({ atMs: Number(s.ms), type: "state", label: `→ ${s.to_state}: ${s.reason}` })),
    ...notes.map((n) => ({ atMs: Number(n.ms), type: "notebook", label: `${n.entry_type}${n.note ? `: ${n.note}` : ""}` })),
    ...snaps.map((s) => ({ atMs: Number(s.ms), type: "snapshot", label: `snapshot ${s.kind}` })),
    ...alerts.map((a) => ({ atMs: Number(a.ms), type: "alert", label: `alert ${a.level}` })),
  ].sort((a, b) => a.atMs - b.atMs);
  return {
    events,
    prices: prices.map((p) => ({ atMs: Number(p.ms), price: Number(p.price_usd), liquidity: p.liquidity_usd != null ? Number(p.liquidity_usd) : null })),
    discoveredAtMs: meta[0] ? Number(meta[0].ms) : 0,
  };
}

// ── System page ──────────────────────────────────────────────────────────
export interface SourceHealthRow {
  source: string;
  status: string;
  last_ok_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
}

export async function sourceHealth(): Promise<SourceHealthRow[]> {
  return q<SourceHealthRow>(`SELECT source, status, last_ok_at, last_error_at, last_error, consecutive_failures FROM source_health ORDER BY source`);
}

export async function lastWorkerRun(): Promise<string | null> {
  const rows = await q<{ t: string }>(`SELECT max(ingested_at) AS t FROM raw_events`);
  return rows[0]?.t ?? null;
}

export async function engineVersions(): Promise<Array<{ engine: string; version: string; param_hash: string }>> {
  return q(`SELECT engine, version, param_hash FROM engine_versions ORDER BY engine`);
}

export async function pendingOutcomeCount(): Promise<number> {
  const rows = await q<{ n: string }>(`SELECT count(*)::int AS n FROM outcome_schedules WHERE status='PENDING'`);
  return Number(rows[0]?.n ?? 0);
}

export async function recentErrors(): Promise<Array<{ source: string; error: string; failed_at: string }>> {
  return q(`SELECT source::text, error, failed_at FROM dead_letter_events ORDER BY failed_at DESC LIMIT 10`);
}

// ── Alerts ────────────────────────────────────────────────────────────────
export interface AlertRow {
  id: string;
  candidate_id: string;
  symbol_label: string | null;
  mint: string;
  level: string;
  policy_id: string;
  policy_version: string;
  state_from: string | null;
  state_to: string;
  message: string;
  created_at: string;
  delivery_status: string | null;
  telegram_message_id: string | null;
  attempts: number | null;
  last_error: string | null;
}

const ALERT_SELECT = `
  SELECT a.id, a.candidate_id, t.symbol_label, tk.mint, a.level, a.policy_id, a.policy_version,
    a.state_from, a.state_to, a.message, a.created_at,
    d.status AS delivery_status, d.telegram_message_id, d.attempts, d.last_error
  FROM alert_events a
  JOIN candidates c ON c.id = a.candidate_id
  JOIN tokens tk ON tk.id = c.token_id
  LEFT JOIN tokens t ON t.id = c.token_id
  LEFT JOIN LATERAL (SELECT status, telegram_message_id, attempts, last_error FROM notification_deliveries WHERE alert_event_id=a.id ORDER BY updated_at DESC LIMIT 1) d ON true
`;

export async function recentAlerts(limit = 100): Promise<AlertRow[]> {
  return q<AlertRow>(`${ALERT_SELECT} WHERE c.discovery_source NOT IN ('mock','manual') ORDER BY a.created_at DESC LIMIT $1`, [limit]);
}

export async function alertsForCandidate(candidateId: string): Promise<AlertRow[]> {
  return q<AlertRow>(`${ALERT_SELECT} WHERE a.candidate_id=$1 ORDER BY a.created_at DESC LIMIT 30`, [candidateId]);
}

// ── Live / worker status ──────────────────────────────────────────────────
export interface WorkerStatus {
  worker_id: string;
  status: string;
  cycle_count: number;
  last_cycle_at: string | null;
  last_cycle_ms: number | null;
  avg_cycle_ms: number | null;
  candidates_last_cycle: number | null;
  started_at: string;
  detail: Record<string, unknown>;
}

export async function workerStatus(): Promise<WorkerStatus | null> {
  const rows = await q<WorkerStatus>(`SELECT * FROM worker_heartbeats ORDER BY updated_at DESC LIMIT 1`);
  return rows[0] ?? null;
}

export interface LiveCounts {
  scannedToday: number;
  alertsToday: number;
  deliveredToday: number;
  queueDepth: number;
  latestAlert: { level: string; symbol_label: string | null; created_at: string } | null;
  telegramMode: string | null;
}

export async function liveCounts(): Promise<LiveCounts> {
  const LIVE = `c.discovery_source NOT IN ('mock','manual')`;
  const [scanned, alerts, delivered, queue, latest, channel] = await Promise.all([
    q<{ n: string }>(`SELECT count(*)::int n FROM candidates c WHERE ${LIVE} AND last_scan_at::date = current_date`),
    q<{ n: string }>(`SELECT count(*)::int n FROM alert_events a JOIN candidates c ON c.id=a.candidate_id WHERE ${LIVE} AND a.created_at::date = current_date`),
    q<{ n: string }>(`SELECT count(*)::int n FROM notification_deliveries d JOIN alert_events a ON a.id=d.alert_event_id JOIN candidates c ON c.id=a.candidate_id WHERE ${LIVE} AND d.status='SENT' AND d.delivered_at::date = current_date`),
    q<{ n: string }>(`SELECT count(*)::int n FROM notification_deliveries d JOIN alert_events a ON a.id=d.alert_event_id JOIN candidates c ON c.id=a.candidate_id WHERE ${LIVE} AND d.status IN ('PENDING','FAILED')`),
    q<{ level: string; symbol_label: string | null; created_at: string }>(
      `SELECT a.level, t.symbol_label, a.created_at FROM alert_events a JOIN candidates c ON c.id=a.candidate_id JOIN tokens t ON t.id=c.token_id WHERE ${LIVE} ORDER BY a.created_at DESC LIMIT 1`,
    ),
    q<{ mode: string }>(`SELECT mode FROM notification_channels WHERE kind='telegram' LIMIT 1`),
  ]);
  return {
    scannedToday: Number(scanned[0]?.n ?? 0),
    alertsToday: Number(alerts[0]?.n ?? 0),
    deliveredToday: Number(delivered[0]?.n ?? 0),
    queueDepth: Number(queue[0]?.n ?? 0),
    latestAlert: latest[0] ?? null,
    telegramMode: channel[0]?.mode ?? null,
  };
}
