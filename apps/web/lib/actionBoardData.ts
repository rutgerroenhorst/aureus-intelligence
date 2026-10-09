import "server-only";
import { q } from "./db";
import { workerStatus } from "./queries";
import { computeAction, bucketOf, type ActionInput, type FamilyStatus, type BoardCandidate, type BoardData, type WatchDetail } from "./actionBoard";
import { safetyLayers } from "@aureus/safety-engine";

export type { BoardCandidate, BoardData } from "./actionBoard";

interface RawRow {
  id: string; candidate_code: string; symbol_label: string | null; name_label: string | null;
  mint: string; pool_address: string | null; current_state: string; monitoring_tier: string;
  enrichment_status: string; stop_monitoring_reason: string | null; downgrade_reason: string | null;
  price_usd: string | null; market_cap_usd: string | null; fdv_usd: string | null; liquidity_usd: string | null;
  volume_usd: string | null; avg_vol_30m: string | null; buys: number | null; sells: number | null;
  price_at: string | null; p5: string | null; p15: string | null; p30: string | null;
  liq5: string | null; liq15: string | null; liq30: string | null; liq_disc: string | null;
  pair_age_ms: string | null; last_scan_at: string | null; next_scan_at: string | null;
  top10: string | null; mint_auth: boolean | null; freeze_auth: boolean | null;
  datasets: Record<string, { status: string; value?: number }> | null; enrich_age_ms: string | null;
  // persisted two-decision status (single source of truth, written by the worker)
  v2_status: string | null; v2_proximity: string | null; v2_fund: string | null;
  v2_quality: number | null; v2_entry_rank: number | null; v2_since: string | null;
  v2_scans: number | null; v2_trend: string | null; v2_prev: string | null;
  v2_reasons: Record<string, unknown> | null; v2_plan: Record<string, unknown> | null;
}

const num = (v: string | null): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Map the worker-persisted status row into the UI's two-decision view. */
function buildWatch(r: RawRow, nowMs: number): WatchDetail | undefined {
  if (!r.v2_status) return undefined;
  const reasons = (r.v2_reasons ?? {}) as {
    positives?: string[]; waiting?: string[]; confirmed?: string[]; blocker?: string;
    best?: { type?: string };
  };
  const p = (r.v2_plan ?? null) as WatchDetail["plan"];
  return {
    status: r.v2_status, proximity: r.v2_proximity ?? "NO_STRUCTURE", fundVerdict: r.v2_fund ?? "OBSERVATION",
    qualityRank: r.v2_quality, entryRank: r.v2_entry_rank, priority: "OBSERVATION", // assigned after ranking
    sinceMs: r.v2_since ? nowMs - Date.parse(r.v2_since) : null,
    scans: r.v2_scans, trend: r.v2_trend ?? "NEW", prevStatus: r.v2_prev,
    positives: reasons.positives ?? [], waiting: reasons.waiting ?? [], confirmed: reasons.confirmed ?? [],
    blocker: reasons.blocker ?? "", bestEntryType: reasons.best?.type ?? null,
    plan: p && p.triggerType ? p : null,
  };
}

function familyMap(rules: Array<{ family: string; result: string }>): {
  safety: FamilyStatus; quality: FamilyStatus; entry: FamilyStatus;
} {
  const agg = (fam: string): FamilyStatus => {
    const rs = rules.filter((r) => r.family === fam).map((r) => r.result);
    if (rs.length === 0) return "NA";
    if (rs.includes("FAIL")) return "FAIL";
    if (rs.includes("INCOMPLETE")) return "INCOMPLETE";
    if (rs.includes("PASS")) return "PASS";
    return "NA";
  };
  return { safety: agg("SAFETY"), quality: agg("QUALITY"), entry: agg("ENTRY") };
}

export async function getActionBoard(nowMs = Date.now()): Promise<BoardData> {
  // 1) Active (non-expired) live candidates with market, 5/15/30m trends, enrichment intel.
  const rows = await q<RawRow>(
    `
    SELECT c.id, c.candidate_code, t.symbol_label, t.name_label, t.mint, p.pool_address,
      c.current_state, c.monitoring_tier, c.enrichment_status, c.stop_monitoring_reason, c.downgrade_reason,
      pr.price_usd, pr.market_cap_usd, pr.fdv_usd, pr.observed_at AS price_at,
      lq.liquidity_usd, tx.buys, tx.sells, tx.volume_usd,
      extract(epoch FROM (now() - c.discovered_at))*1000 AS pair_age_ms,
      c.last_scan_at, c.next_scan_at,
      (oe.intel->'onChain'->>'holderTop10Pct') AS top10,
      (oe.intel->'flags'->>'mintAuthorityActive')::boolean AS mint_auth,
      (oe.intel->'flags'->>'freezeAuthorityActive')::boolean AS freeze_auth,
      oe.datasets,
      extract(epoch FROM (now() - oe.computed_at))*1000 AS enrich_age_ms,
      cas.status AS v2_status, cas.entry_proximity AS v2_proximity, cas.fund_verdict AS v2_fund,
      cas.quality_rank AS v2_quality, cas.entry_rank AS v2_entry_rank, cas.since AS v2_since,
      cas.confirming_scans AS v2_scans, cas.trend AS v2_trend, cas.prev_status AS v2_prev,
      cas.reasons AS v2_reasons, cas.plan AS v2_plan,
      (SELECT price_usd FROM prices WHERE pool_id=c.pool_id AND observed_at <= now()-interval '5 min'  ORDER BY observed_at DESC LIMIT 1) AS p5,
      (SELECT price_usd FROM prices WHERE pool_id=c.pool_id AND observed_at <= now()-interval '15 min' ORDER BY observed_at DESC LIMIT 1) AS p15,
      (SELECT price_usd FROM prices WHERE pool_id=c.pool_id AND observed_at <= now()-interval '30 min' ORDER BY observed_at DESC LIMIT 1) AS p30,
      (SELECT liquidity_usd FROM liquidity_snapshots WHERE pool_id=c.pool_id AND observed_at <= now()-interval '5 min'  ORDER BY observed_at DESC LIMIT 1) AS liq5,
      (SELECT liquidity_usd FROM liquidity_snapshots WHERE pool_id=c.pool_id AND observed_at <= now()-interval '15 min' ORDER BY observed_at DESC LIMIT 1) AS liq15,
      (SELECT liquidity_usd FROM liquidity_snapshots WHERE pool_id=c.pool_id AND observed_at <= now()-interval '30 min' ORDER BY observed_at DESC LIMIT 1) AS liq30,
      (SELECT liquidity_usd FROM liquidity_snapshots WHERE pool_id=c.pool_id ORDER BY observed_at ASC LIMIT 1) AS liq_disc,
      (SELECT round(avg(volume_usd)) FROM transaction_aggregates WHERE pool_id=c.pool_id AND observed_at > now()-interval '30 min') AS avg_vol_30m
    FROM candidates c
    JOIN tokens t ON t.id=c.token_id
    LEFT JOIN pools p ON p.id=c.pool_id
    LEFT JOIN LATERAL (SELECT price_usd, market_cap_usd, fdv_usd, observed_at FROM prices WHERE pool_id=c.pool_id ORDER BY observed_at DESC LIMIT 1) pr ON true
    LEFT JOIN LATERAL (SELECT liquidity_usd FROM liquidity_snapshots WHERE pool_id=c.pool_id ORDER BY observed_at DESC LIMIT 1) lq ON true
    LEFT JOIN LATERAL (SELECT buys, sells, volume_usd FROM transaction_aggregates WHERE pool_id=c.pool_id ORDER BY observed_at DESC LIMIT 1) tx ON true
    LEFT JOIN onchain_enrichment oe ON oe.candidate_id=c.id
    LEFT JOIN candidate_action_status cas ON cas.candidate_id=c.id
    WHERE c.discovery_source NOT IN ('mock','manual')
      AND c.current_state <> 'EXPIRED'
      AND pr.price_usd IS NOT NULL
    ORDER BY c.monitoring_tier DESC, lq.liquidity_usd DESC NULLS LAST
    LIMIT 150
    `,
  );
  const ids = rows.map((r) => r.id);

  // 2) Latest rule per (candidate, rule) → family aggregation + specific flags.
  const ruleRows = ids.length
    ? await q<{ candidate_id: string; rule_id: string; family: string; result: string }>(
        `SELECT candidate_id, rule_id, family, result
         FROM rule_evaluations_current WHERE candidate_id = ANY($1)`,
        [ids],
      )
    : [];
  const rulesByCand = new Map<string, Array<{ rule_id: string; family: string; result: string }>>();
  for (const r of ruleRows) {
    const arr = rulesByCand.get(r.candidate_id) ?? [];
    arr.push({ rule_id: r.rule_id, family: r.family, result: r.result });
    rulesByCand.set(r.candidate_id, arr);
  }

  // 3) Worker / Helius status + last enrichment time.
  const [ws, enrRow] = await Promise.all([
    workerStatus(),
    q<{ t: string | null }>(`SELECT max(computed_at) AS t FROM onchain_enrichment`),
  ]);
  const lastCycleAt = ws?.last_cycle_at ? Date.parse(ws.last_cycle_at) : null;
  const tickMs = Number((ws?.detail as { tickMs?: number })?.tickMs ?? 10000);
  const heliusMode = String((ws?.detail as { heliusMode?: string })?.heliusMode ?? "UNKNOWN");
  const online = lastCycleAt != null && nowMs - lastCycleAt < Math.max(tickMs * 3, 90_000);

  // 4) Build → compute → rank.
  const built: BoardCandidate[] = rows.map((r) => {
    const rules = rulesByCand.get(r.id) ?? [];
    const fam = familyMap(rules);
    const entryOverextended = rules.some((x) => x.rule_id === "ENTRY-02-NOT-OVEREXTENDED" && x.result === "FAIL");
    const safetyLiquidityDrainFail = rules.some((x) => x.rule_id === "SAFE-05-LIQUIDITY-DRAIN" && x.result === "FAIL");
    const missingDatasets = r.datasets
      ? Object.entries(r.datasets).filter(([, v]) => v?.status === "INCOMPLETE").map(([k]) => k)
      : [];
    // Registry-aware SAFETY verdict: required datasets must PASS; advisory
    // (bundle) INCOMPLETE does not permanently block; any FAIL blocks.
    const datasetStatus: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.datasets ?? {})) datasetStatus[k] = v?.status;
    const safetyRules = rules.filter((x) => x.family === "SAFETY").map((x) => ({ ruleId: x.rule_id, result: x.result }));
    const layers = safetyLayers(safetyRules, datasetStatus);
    const dsVal = (k: string) => (r.datasets?.[k]?.value ?? null);
    const dsStat = (k: string) => (r.datasets?.[k]?.status ?? null);
    const sellClass = (r.datasets?.sellability as { classification?: string } | undefined)?.classification ?? null;
    // KNOWN risks = things we measured and found risky. UNKNOWN = advanced data we couldn't get.
    const knownRisks: string[] = [];
    if (dsStat("sellability") === "FAIL") knownRisks.push(`sellability: ${sellClass ?? "FAIL"}`);
    if (dsStat("authorities") === "FAIL") knownRisks.push("mint/freeze authority active");
    if (dsStat("liquidity_drain") === "FAIL") knownRisks.push("liquidity draining");
    const ins = dsVal("insider_concentration");
    if (safetyRules.some((x) => x.ruleId === "SAFE-03-INSIDER-CONCENTRATION" && x.result === "FAIL")) knownRisks.push(`insider concentration ${ins != null ? (ins * 100).toFixed(0) + "%" : "high"}`);
    if (dsStat("deployer_funding") === "FAIL") knownRisks.push("deployer supply exposure high");
    const unknownRisks: string[] = layers.advancedMissing.map((d) => d.replace(/_/g, " "));
    const safetyDetail = {
      core: layers.core, coreBlocker: layers.coreBlocker, advanced: layers.advanced,
      deployer: dsStat("deployer_funding"), insiderPct: ins,
      bundle: dsStat("bundle_contamination"), sellability: dsStat("sellability"), sellClass,
      liquidityDrain: dsStat("liquidity_drain"), authorities: dsStat("authorities"),
      knownRisks, unknownRisks,
    };
    const input: ActionInput = {
      nowMs,
      currentState: r.current_state, monitoringTier: r.monitoring_tier,
      stopMonitoringReason: r.stop_monitoring_reason, downgradeReason: r.downgrade_reason,
      priceUsd: num(r.price_usd), liquidityUsd: num(r.liquidity_usd), volumeUsd: num(r.volume_usd),
      avgVolume30m: num(r.avg_vol_30m), buys: r.buys, sells: r.sells,
      priceAtMs: r.price_at ? Date.parse(r.price_at) : null,
      price5mAgo: num(r.p5), price15mAgo: num(r.p15), price30mAgo: num(r.p30),
      liq5mAgo: num(r.liq5), liq15mAgo: num(r.liq15), liq30mAgo: num(r.liq30), liqAtDiscovery: num(r.liq_disc),
      pairAgeMs: num(r.pair_age_ms),
      enrichmentStatus: r.enrichment_status, enrichmentAgeMs: num(r.enrich_age_ms),
      holderTop10: num(r.top10), mintAuthorityActive: r.mint_auth, freezeAuthorityActive: r.freeze_auth,
      missingDatasets, safety: layers.core as FamilyStatus, quality: fam.quality, entry: fam.entry,
      entryOverextended, safetyLiquidityDrainFail,
    };
    const action = computeAction(input);
    return {
      id: r.id, candidateCode: r.candidate_code, symbol: r.symbol_label, name: r.name_label,
      mint: r.mint, pool: r.pool_address, currentState: r.current_state, monitoringTier: r.monitoring_tier,
      enrichmentStatus: r.enrichment_status, priceUsd: num(r.price_usd),
      marketCapUsd: num(r.market_cap_usd) ?? num(r.fdv_usd), liquidityUsd: num(r.liquidity_usd),
      volumeUsd: num(r.volume_usd), buys: r.buys, sells: r.sells, holderTop10: num(r.top10),
      mintAuthorityActive: r.mint_auth, freezeAuthorityActive: r.freeze_auth,
      pairAgeMs: num(r.pair_age_ms), priceAtMs: r.price_at ? Date.parse(r.price_at) : null,
      lastScanAt: r.last_scan_at, nextScanAt: r.next_scan_at, action, safetyDetail,
      watch: buildWatch(r, nowMs),
    };
  });

  built.sort((a, b) => b.action.rankingScore - a.action.rankingScore);

  const buckets = { A: [] as BoardCandidate[], B: [] as BoardCandidate[], C: [] as BoardCandidate[], D: [] as BoardCandidate[] };
  for (const c of built) buckets[bucketOf(c.action.status)].push(c);
  // Bucket D (invalidated/rejected) — cap to the most recent/relevant for the UI.
  buckets.D = buckets.D.slice(0, 12);

  // ── §3/§9: two-decision sections + watch priority (PRIMARY ≤5, SECONDARY ≤10) ──
  const byStatus = (s: string) => built.filter((c) => c.watch?.status === s);
  // Combined watch rank = fundamental quality + entry readiness (shown separately in UI).
  const combined = (c: BoardCandidate) => (c.watch?.qualityRank ?? 0) + (c.watch?.entryRank ?? 0);
  const watchPool = [...byStatus("FUNDAMENTAL_WATCH")].sort((a, b) => combined(b) - combined(a));
  const primary = watchPool.slice(0, 5);
  const secondary = watchPool.slice(5, 15);
  const observation = [...watchPool.slice(15), ...byStatus("DISCOVERED")];
  for (const c of primary) if (c.watch) c.watch.priority = "PRIMARY";
  for (const c of secondary) if (c.watch) c.watch.priority = "SECONDARY";
  for (const c of observation) if (c.watch) c.watch.priority = "OBSERVATION";

  const sortByEntry = (arr: BoardCandidate[]) => [...arr].sort((a, b) => (b.watch?.entryRank ?? 0) - (a.watch?.entryRank ?? 0));
  const sections = {
    ENTRY_READY: sortByEntry(byStatus("ENTRY_READY")),
    ENTRY_APPROACHING: sortByEntry(byStatus("ENTRY_APPROACHING")),
    PRIMARY_WATCH: primary,
    SETUP_FORMING: sortByEntry(byStatus("SETUP_FORMING")),
    TOO_EXTENDED: byStatus("TOO_EXTENDED"),
    SECONDARY_WATCH: secondary,
    INVALID_REJECTED: [...byStatus("INVALIDATED"), ...byStatus("REJECTED")].slice(0, 12),
  };

  // BEST CURRENT OPPORTUNITY: furthest along the ladder, then best combined rank.
  const LADDER = ["ENTRY_READY", "ENTRY_APPROACHING", "SETUP_FORMING", "FUNDAMENTAL_WATCH"];
  const bestV2 = LADDER.flatMap((s) => (s === "FUNDAMENTAL_WATCH" ? primary : sortByEntry(byStatus(s))))[0] ?? null;
  const best = bestV2 ?? built.find((c) => c.action.status !== "REJECTED" && c.action.status !== "INVALIDATED") ?? null;

  return {
    generatedAt: new Date(nowMs).toISOString(),
    worker: {
      online, status: ws?.status ?? "UNKNOWN", heliusMode,
      lastCycleAt: ws?.last_cycle_at ?? null, lastEnrichmentAt: enrRow[0]?.t ?? null,
      activeMonitored: built.filter((c) => c.action.status !== "REJECTED").length,
    },
    counts: {
      actionable: buckets.A.length, wait: buckets.B.length, tooExtended: buckets.C.length,
      invalidatedRejected: built.filter((c) => c.action.status === "INVALIDATED" || c.action.status === "REJECTED").length,
      fundamentalWatch: watchPool.length, setupForming: sections.SETUP_FORMING.length,
      entryApproaching: sections.ENTRY_APPROACHING.length, entryReady: sections.ENTRY_READY.length,
    },
    best, buckets, sections,
  };
}
