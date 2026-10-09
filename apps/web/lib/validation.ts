import "server-only";
import { mean, median, winrate, welchSignificance, type SignificanceResult } from "@aureus/research";
import { ruleLabel, featureLabel } from "@aureus/readiness";
import { q } from "./db";

export interface ResearchRow {
  candidate_id: string;
  symbol_label: string | null;
  current_state: string;
  peak_return_pct: number | null;
  final_return_pct: number | null;
  max_drawdown_pct: number | null;
  is_rug: boolean;
  discovery_liquidity_usd: number | null;
  observations: number;
  window_24h_complete: boolean;
  lifespan_s: number | null;
  liquidity_growth_pct: number | null;
  volume_growth_pct: number | null;
  h1_return: number | null;
  h4_return: number | null;
  rules: Record<string, string> | null;
  features: Record<string, { status: string; value: number | null }> | null;
}

const NUM = (v: unknown) => (v == null ? null : Number(v));

export async function fetchResearchRows(): Promise<ResearchRow[]> {
  const rows = await q<Record<string, unknown>>(`
    -- The list of features does not depend on the candidate, so it is computed ONCE. Written inline as
    -- (SELECT DISTINCT feature_id FROM feature_values) inside the per-candidate subquery below, Postgres
    -- re-ran that scan of the whole feature table for every one of the 1,365 candidates: 215 s on the laptop
    -- database (1.6M rows), which the page's 10 s query timeout turned into a 500. With the CTE: 0.9 s.
    WITH feats AS MATERIALIZED (SELECT DISTINCT feature_id FROM feature_values)
    SELECT cr.candidate_id, t.symbol_label, c.current_state,
      cr.peak_return_pct, cr.final_return_pct, cr.max_drawdown_pct, cr.is_rug,
      cr.discovery_liquidity_usd, cr.observations, cr.window_24h_complete, cr.lifespan_s,
      cr.liquidity_growth_pct, cr.volume_growth_pct,
      ph1.return_pct AS h1_return, ph4.return_pct AS h4_return,
      (SELECT jsonb_object_agg(rule_id, result) FROM rule_evaluations_current WHERE candidate_id=cr.candidate_id) AS rules,
      -- One index lookup per (candidate, feature) rather than a per-candidate
      -- DISTINCT ON. feature_values has 643k rows and grows on every scan, so scanning
      -- a candidate's whole history to pick the newest of each feature cost 16.9s and
      -- starved the 5-connection pool, which is what took the rest of the site down
      -- with it. There are only 24 distinct features, so enumerating them and letting
      -- the (candidate_id, feature_id, calculated_at DESC) index answer each one is
      -- ~7x cheaper.
      (SELECT jsonb_object_agg(f.feature_id, jsonb_build_object('status', x.status, 'value', x.value))
         FROM feats f
         CROSS JOIN LATERAL (SELECT status, value FROM feature_values v
                              WHERE v.candidate_id=cr.candidate_id AND v.feature_id=f.feature_id
                              ORDER BY v.calculated_at DESC LIMIT 1) x) AS features
    FROM candidate_research cr
    JOIN candidates c ON c.id=cr.candidate_id JOIN tokens t ON t.id=c.token_id
    LEFT JOIN paper_tracking ph1 ON ph1.candidate_id=cr.candidate_id AND ph1.horizon='h1'
    LEFT JOIN paper_tracking ph4 ON ph4.candidate_id=cr.candidate_id AND ph4.horizon='h4'
    WHERE c.discovery_source NOT IN ('mock','manual')
  `);
  return rows.map((r) => ({
    candidate_id: r.candidate_id as string,
    symbol_label: (r.symbol_label as string) ?? null,
    current_state: r.current_state as string,
    peak_return_pct: NUM(r.peak_return_pct), final_return_pct: NUM(r.final_return_pct),
    max_drawdown_pct: NUM(r.max_drawdown_pct), is_rug: r.is_rug as boolean,
    discovery_liquidity_usd: NUM(r.discovery_liquidity_usd), observations: Number(r.observations),
    window_24h_complete: r.window_24h_complete as boolean, lifespan_s: NUM(r.lifespan_s),
    liquidity_growth_pct: NUM(r.liquidity_growth_pct), volume_growth_pct: NUM(r.volume_growth_pct),
    h1_return: NUM(r.h1_return), h4_return: NUM(r.h4_return),
    rules: (r.rules as Record<string, string>) ?? null,
    features: (r.features as Record<string, { status: string; value: number | null }>) ?? null,
  }));
}

// ── Aggregation ─────────────────────────────────────────────────────────────
export interface Agg {
  n: number;
  winratePeak: number | null;   // fraction with peak run-up > 0.5 (50%+)
  winrateFinal: number | null;  // fraction with final return > 0
  meanPeak: number | null;
  medianPeak: number | null;
  meanFinal: number | null;
  medianFinal: number | null;
  meanDrawdown: number | null;
  rugPct: number | null;
  avgLifespanH: number | null;
  avgLiqGrowth: number | null;
  avgVolGrowth: number | null;
}

export function aggregate(rows: ResearchRow[]): Agg {
  const peaks = rows.map((r) => r.peak_return_pct).filter((v): v is number => v != null);
  const finals = rows.map((r) => r.final_return_pct).filter((v): v is number => v != null);
  const dds = rows.map((r) => r.max_drawdown_pct).filter((v): v is number => v != null);
  const lifes = rows.map((r) => r.lifespan_s).filter((v): v is number => v != null);
  const liqG = rows.map((r) => r.liquidity_growth_pct).filter((v): v is number => v != null);
  const volG = rows.map((r) => r.volume_growth_pct).filter((v): v is number => v != null);
  return {
    n: rows.length,
    winratePeak: peaks.length ? winrate(peaks, 0.5) : null,
    winrateFinal: finals.length ? winrate(finals, 0) : null,
    meanPeak: mean(peaks), medianPeak: median(peaks),
    meanFinal: mean(finals), medianFinal: median(finals),
    meanDrawdown: mean(dds),
    rugPct: rows.length ? rows.filter((r) => r.is_rug).length / rows.length : null,
    avgLifespanH: lifes.length ? (mean(lifes)! / 3600) : null,
    avgLiqGrowth: mean(liqG), avgVolGrowth: mean(volG),
  };
}

// ── Cohorts (compare engine) ────────────────────────────────────────────────
export interface Cohort {
  id: string;
  label: string;
  test: (r: ResearchRow) => boolean;
}

const rulePass = (r: ResearchRow, id: string) => r.rules?.[id] === "PASS";
const featVal = (r: ResearchRow, id: string) => r.features?.[id]?.value ?? null;

export const COHORTS: Cohort[] = [
  { id: "safe05", label: "SAFE-05 Liquidity stability PASS", test: (r) => rulePass(r, "SAFE-05-LIQUIDITY-DRAIN") },
  { id: "notover", label: "ENTRY-02 Not overextended PASS", test: (r) => rulePass(r, "ENTRY-02-NOT-OVEREXTENDED") },
  { id: "liq25k", label: "Discovery liquidity ≥ $25k", test: (r) => (r.discovery_liquidity_usd ?? 0) >= 25_000 },
  { id: "liq10k", label: "Discovery liquidity ≥ $10k", test: (r) => (r.discovery_liquidity_usd ?? 0) >= 10_000 },
  { id: "data80", label: "Data completeness ≥ 80%", test: (r) => (featVal(r, "data_completeness") ?? 0) >= 0.8 },
  { id: "data50", label: "Data completeness ≥ 50%", test: (r) => (featVal(r, "data_completeness") ?? 0) >= 0.5 },
  { id: "buyergrowth", label: "QUAL-01 Buyer growth PASS", test: (r) => rulePass(r, "QUAL-01-INDEPENDENT-DEMAND") },
  { id: "retention", label: "QUAL-02 Liquidity retention PASS", test: (r) => rulePass(r, "QUAL-02-CAPITAL-RETENTION") },
];

export interface CohortResult {
  cohort: Cohort;
  cohortAgg: Agg;
  restAgg: Agg;
}

export function compareCohorts(rows: ResearchRow[]): { all: Agg; cohorts: CohortResult[] } {
  const all = aggregate(rows);
  const cohorts = COHORTS.map((c) => {
    const inC = rows.filter(c.test);
    const rest = rows.filter((r) => !c.test(r));
    return { cohort: c, cohortAgg: aggregate(inC), restAgg: aggregate(rest) };
  });
  return { all, cohorts };
}

// ── Rule attribution ─────────────────────────────────────────────────────────
export interface RuleAttribution {
  ruleId: string;
  label: string;
  n: number;
  pass: number;
  fail: number;
  incomplete: number;
  meanPeakPass: number | null;
  meanPeakFail: number | null;
  rugPctPass: number | null;
  rugPctFail: number | null;
  significance: SignificanceResult;
  verdict: "edge" | "no measurable edge" | "not yet measurable";
}

export function ruleAttribution(rows: ResearchRow[]): RuleAttribution[] {
  const ruleIds = new Set<string>();
  for (const r of rows) if (r.rules) for (const k of Object.keys(r.rules)) ruleIds.add(k);
  const out: RuleAttribution[] = [];
  for (const ruleId of [...ruleIds].sort()) {
    const withResult = rows.filter((r) => r.rules?.[ruleId] != null);
    const pass = withResult.filter((r) => r.rules![ruleId] === "PASS");
    const fail = withResult.filter((r) => r.rules![ruleId] === "FAIL");
    const inc = withResult.filter((r) => r.rules![ruleId] === "INCOMPLETE");
    const peaksPass = pass.map((r) => r.peak_return_pct).filter((v): v is number => v != null);
    const peaksFail = fail.map((r) => r.peak_return_pct).filter((v): v is number => v != null);
    const sig = welchSignificance(peaksPass, peaksFail);
    let verdict: RuleAttribution["verdict"];
    if (pass.length < 5 || fail.length < 5) verdict = "not yet measurable";
    else verdict = sig.significant ? "edge" : "no measurable edge";
    out.push({
      ruleId, label: ruleLabel(ruleId), n: withResult.length,
      pass: pass.length, fail: fail.length, incomplete: inc.length,
      meanPeakPass: mean(peaksPass), meanPeakFail: mean(peaksFail),
      rugPctPass: pass.length ? pass.filter((r) => r.is_rug).length / pass.length : null,
      rugPctFail: fail.length ? fail.filter((r) => r.is_rug).length / fail.length : null,
      significance: sig, verdict,
    });
  }
  return out;
}

// ── Research mode ─────────────────────────────────────────────────────────────
export interface ResearchQueryResult {
  matched: ResearchRow[];
  commonRulesPass: Array<{ ruleId: string; label: string; passFraction: number }>;
  strongestFeatures: Array<{ featureId: string; label: string; okFraction: number }>;
  blockersNeverPresent: string[]; // safety rules that never FAILed in the matched set
}

export function researchQuery(rows: ResearchRow[], metric: "peak" | "h4" | "final", minPct: number): ResearchQueryResult {
  const pick = (r: ResearchRow) => metric === "peak" ? r.peak_return_pct : metric === "h4" ? r.h4_return : r.final_return_pct;
  const matched = rows.filter((r) => (pick(r) ?? -Infinity) >= minPct);
  const ruleIds = new Set<string>();
  const featIds = new Set<string>();
  for (const r of matched) {
    if (r.rules) for (const k of Object.keys(r.rules)) ruleIds.add(k);
    if (r.features) for (const k of Object.keys(r.features)) featIds.add(k);
  }
  const commonRulesPass = [...ruleIds].map((id) => ({
    ruleId: id, label: ruleLabel(id),
    passFraction: matched.length ? matched.filter((r) => r.rules?.[id] === "PASS").length / matched.length : 0,
  })).filter((x) => x.passFraction > 0).sort((a, b) => b.passFraction - a.passFraction);
  const strongestFeatures = [...featIds].map((id) => ({
    featureId: id, label: featureLabel(id),
    okFraction: matched.length ? matched.filter((r) => r.features?.[id]?.status === "OK").length / matched.length : 0,
  })).filter((x) => x.okFraction > 0).sort((a, b) => b.okFraction - a.okFraction);
  const safetyRuleIds = [...ruleIds].filter((id) => id.startsWith("SAFE-"));
  const blockersNeverPresent = safetyRuleIds.filter((id) => !matched.some((r) => r.rules?.[id] === "FAIL")).map(ruleLabel);
  return { matched, commonRulesPass, strongestFeatures, blockersNeverPresent };
}
