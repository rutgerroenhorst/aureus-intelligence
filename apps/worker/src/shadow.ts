/**
 * Shadow paper signals — RECORDED, never traded. A signal opens the moment a
 * candidate crosses the gate: CORE SAFETY PASS + ENTRY PASS + fresh data +
 * acceptable slippage + no critical drain. We then track return/MFE/MAE per
 * horizon (5m/15m/30m/1h/4h/24h) from the trigger price. No orders are sent.
 */
import type { Pool } from "pg";
import type { RuleEvaluation } from "@aureus/contracts";
import type { EntryResult } from "@aureus/entry-engine";

const REQUIRED_SAFETY = ["SAFE-02-BLACKLIST-FUNDING", "SAFE-03-INSIDER-CONCENTRATION", "SAFE-05-LIQUIDITY-DRAIN", "SAFE-06-AUTHORITY-SELLABILITY"];
const ENTRY_RULES = ["ENTRY-01-STRUCTURE-RECLAIM", "ENTRY-02-NOT-OVEREXTENDED", "ENTRY-03-INVALIDATION", "ENTRY-04-EXECUTION"];
const HORIZONS: Array<[string, number]> = [["m5", 5], ["m15", 15], ["m30", 30], ["h1", 60], ["h4", 240], ["h24", 1440]];
const SIGNAL_TTL_MS = 24 * 60 * 60_000;
const FRESH_MS = 15 * 60_000;

export interface GateResult { pass: boolean; coreSafety: "PASS" | "FAIL" | "INCOMPLETE"; entryPass: boolean; reason: string }

/** Deterministic gate from the just-computed rules + entry result. */
export function evaluateGate(rules: RuleEvaluation[], entry: EntryResult, priceAgeMs: number | null): GateResult {
  const res = (id: string) => rules.find((r) => r.ruleId === id)?.result;
  const anySafetyFail = rules.some((r) => r.family === "SAFETY" && r.result === "FAIL");
  const coreOk = REQUIRED_SAFETY.every((id) => res(id) === "PASS") && !anySafetyFail;
  const coreSafety = anySafetyFail ? "FAIL" : coreOk ? "PASS" : "INCOMPLETE";
  const entryPass = ENTRY_RULES.every((id) => res(id) === "PASS");
  const fresh = priceAgeMs != null && priceAgeMs < FRESH_MS;
  const pass = coreSafety === "PASS" && entryPass && fresh;
  const reason = !fresh ? "stale price data" : coreSafety !== "PASS" ? `core safety ${coreSafety}` : !entryPass ? "entry not confirmed" : "gate met";
  return { pass, coreSafety, entryPass, reason };
}

export interface OpenSignalInput {
  entry: EntryResult;
  priceUsd: number;
  liquidityUsd: number | null;
  estSlippagePct: number | null;
  maxChasePrice: number | null;
  advancedStatus: string;
  unknownDatasets: string[];
  ruleVersions: Record<string, string>;
}

/** Open a shadow signal if the gate is met and none is currently open. */
export async function maybeOpenSignal(pool: Pool, candidateId: string, gate: GateResult, s: OpenSignalInput, nowMs: number): Promise<boolean> {
  if (!gate.pass) return false;
  const lv = s.entry.levels;
  const r = await pool.query(
    `INSERT INTO shadow_signals (candidate_id, signal_at, trigger_price, entry_zone_low, entry_zone_high, invalidation, target, rr, max_chase_price, est_slippage_pct, anchor_liquidity_usd, core_safety, advanced_status, unknown_datasets, rule_versions)
     VALUES ($1, to_timestamp($2), $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (candidate_id) WHERE (status='OPEN') DO NOTHING RETURNING id`,
    [candidateId, nowMs / 1000, s.priceUsd, lv.rangeLow, lv.rangeHigh, lv.invalidation, lv.target, s.entry.rewardToRisk ?? null, s.maxChasePrice, s.estSlippagePct, s.liquidityUsd, gate.coreSafety, s.advancedStatus, JSON.stringify(s.unknownDatasets), JSON.stringify(s.ruleVersions)],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Measure every OPEN signal: per-horizon return + running MFE/MAE + liquidity change. */
export async function measureOpenSignals(pool: Pool, nowMs: number): Promise<{ measured: number; closed: number }> {
  const sigs = await pool.query<{ id: string; candidate_id: string; signal_at: string; trigger_price: string; invalidation: string | null; anchor_liquidity_usd: string | null }>(
    `SELECT id, candidate_id, extract(epoch from signal_at)*1000 AS signal_at, trigger_price, invalidation, anchor_liquidity_usd FROM shadow_signals WHERE status='OPEN'`,
  );
  let measured = 0, closed = 0;
  for (const sig of sigs.rows) {
    const anchorMs = Number(sig.signal_at);
    const trigger = Number(sig.trigger_price);
    const poolRow = await pool.query<{ pool_id: string }>(`SELECT pool_id FROM candidates WHERE id=$1`, [sig.candidate_id]);
    const poolId = poolRow.rows[0]?.pool_id;
    if (!poolId || !(trigger > 0)) continue;
    const px = await pool.query<{ t: string; p: string; l: string | null }>(
      `SELECT extract(epoch from pr.observed_at)*1000 t, pr.price_usd p,
        (SELECT liquidity_usd FROM liquidity_snapshots l WHERE l.pool_id=pr.pool_id AND l.observed_at<=pr.observed_at ORDER BY observed_at DESC LIMIT 1) l
       FROM prices pr WHERE pr.pool_id=$1 AND pr.observed_at >= to_timestamp($2) ORDER BY pr.observed_at`,
      [poolId, anchorMs / 1000],
    );
    const series = px.rows.map((r) => ({ atMs: Number(r.t), price: Number(r.p), liq: r.l != null ? Number(r.l) : null }));
    if (series.length === 0) continue;
    const rets = series.map((s) => (s.price - trigger) / trigger);
    const mfe = Math.max(0, ...rets);
    const mae = Math.min(0, ...rets);
    const measurements: Record<string, unknown> = {};
    for (const [key, mins] of HORIZONS) {
      const cutoff = anchorMs + mins * 60_000;
      const point = [...series].reverse().find((s) => s.atMs <= cutoff);
      const complete = nowMs >= cutoff;
      if (point) {
        const liqChange = sig.anchor_liquidity_usd != null && Number(sig.anchor_liquidity_usd) > 0 && point.liq != null ? (point.liq - Number(sig.anchor_liquidity_usd)) / Number(sig.anchor_liquidity_usd) : null;
        measurements[key] = { returnPct: (point.price - trigger) / trigger, liqChangePct: liqChange, atMs: point.atMs, complete };
      } else measurements[key] = { returnPct: null, complete };
    }
    // Close on invalidation (price lost the level) or after 24h.
    const last = series[series.length - 1]!;
    const invalidated = sig.invalidation != null && last.price <= Number(sig.invalidation);
    const expired = nowMs - anchorMs >= SIGNAL_TTL_MS;
    const status = invalidated ? "INVALIDATED" : expired ? "CLOSED" : "OPEN";
    const outcome = invalidated ? "invalidation level lost" : expired ? "24h window complete" : null;
    await pool.query(
      `UPDATE shadow_signals SET measurements=$2, mfe_pct=$3, mae_pct=$4, status=$5, outcome=$6, closed_at=CASE WHEN $5<>'OPEN' THEN now() ELSE closed_at END WHERE id=$1`,
      [sig.id, JSON.stringify(measurements), mfe, mae, status, outcome],
    );
    measured++;
    if (status !== "OPEN") closed++;
  }
  return { measured, closed };
}
