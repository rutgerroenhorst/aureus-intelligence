import type { Pool } from "pg";
import type { HeliusAdapter, JupiterAdapter } from "@aureus/ingestion";
import type { OnChainIntel } from "@aureus/feature-engine";
import type { RuleFlags } from "@aureus/rule-engine";
import {
  analyzeInsider, analyzeSellability, analyzeDeployer, analyzeBundle, analyzeLiquidityDrain,
  analyzeDeployerSelling,
  DATASET_REGISTRY, SAFETY_ENGINE_VERSION, type AnalysisResult, type LiqPoint, type SellQuote, analyzeRugRisk } from "@aureus/safety-engine";
import { stableHash } from "./changeDetect.js";

export const ENRICHMENT_DATA_VERSION = `helius-enrich-${SAFETY_ENGINE_VERSION}`;
export const ENRICHMENT_TTL_MS = Number(process.env.ENRICHMENT_TTL_MINUTES ?? 360) * 60_000;
const SELL_SIZES_USD = [50, 250, 500, 1000];

export type DatasetStatus = "OK" | "FAIL" | "INCOMPLETE" | "UNAVAILABLE";
/** Per-dataset record persisted for the UI/rules — carries evidence + freshness. */
export interface DatasetInfo {
  status: DatasetStatus;
  reason?: string;
  value?: number;
  evidence?: Record<string, unknown>;
  observedAtMs?: number;
  sources?: string[];
  implemented?: boolean;
  requiredForSafety?: boolean;
}

export interface StoredIntel {
  onChain: OnChainIntel;
  flags: Pick<RuleFlags, "mintAuthorityActive" | "freezeAuthorityActive" | "sellable" | "blacklistMatch">;
}

export interface EnrichmentResult {
  intel: StoredIntel;
  datasets: Record<string, DatasetInfo>;
  statusOverall: "PARTIAL" | "COMPLETE";
  responseHash: string;
}

/** Everything the pure builder needs (fetched by the orchestrator). */
export interface EnrichContext {
  nowMs: number;
  supply: { amount: string; decimals: number } | null;
  largest: Array<{ address: string; amount: string }> | null;
  mintAcc: { mintAuthority: string | null; freezeAuthority: string | null; supply: string; decimals: number } | null;
  owners: Map<string, string | null>;
  deployer: { creator: string | null; creationSig: string | null; reachedOldest: boolean; balanceRaw: number | null };
  sellQuotes: SellQuote[];
  sellAttempts: number;
  buyRouteExists: boolean | null;
  poolFresh: boolean;
  freezeActive: boolean | null;
  liqHistory: LiqPoint[];
  /** The candidate's own pool/vault + mint — never beneficial holders. */
  poolAddress: string | null;
  mint: string;
  /** Deployer exposure from the PREVIOUS enrichment — enables dev-sell detection. */
  prevDeployerExposure: number | null;
}

export const HELIUS_DEPENDENT_RULES = [
  "SAFE-01-CRITICAL-DATA", "SAFE-02-BLACKLIST-FUNDING", "SAFE-03-INSIDER-CONCENTRATION",
  "SAFE-04-BUNDLE-CONTAMINATION", "SAFE-06-AUTHORITY-SELLABILITY", "QUAL-03-SMART-PARTICIPATION",
];

function rec(id: string, a: Pick<AnalysisResult, "status" | "value" | "reason" | "evidence" | "observedAtMs" | "sources">): DatasetInfo {
  const spec = DATASET_REGISTRY[id];
  return {
    status: a.status, reason: a.reason, value: a.value, evidence: a.evidence,
    observedAtMs: a.observedAtMs, sources: a.sources,
    implemented: spec?.implemented, requiredForSafety: spec?.requiredForSafety,
  };
}

/** Pure: run all analyzers over fetched data → intel + flags + per-dataset results. */
export function buildIntel(ctx: EnrichContext): EnrichmentResult {
  const datasets: Record<string, DatasetInfo> = {};
  const onChain: OnChainIntel = { available: true };
  const flags: StoredIntel["flags"] = {};

  const supplyRaw = ctx.supply ? Number(ctx.supply.amount) : ctx.mintAcc ? Number(ctx.mintAcc.supply) : 0;
  const decimals = ctx.supply?.decimals ?? ctx.mintAcc?.decimals ?? 0;
  datasets.supply = supplyRaw > 0 ? { status: "OK", implemented: true, requiredForSafety: true } : { status: "INCOMPLETE", reason: "token supply not returned", implemented: true, requiredForSafety: true };

  // Authorities.
  if (ctx.mintAcc) {
    flags.mintAuthorityActive = ctx.mintAcc.mintAuthority != null;
    flags.freezeAuthorityActive = ctx.mintAcc.freezeAuthority != null;
    const active = flags.mintAuthorityActive || flags.freezeAuthorityActive;
    datasets.authorities = { status: active ? "FAIL" : "OK", reason: active ? "mint/freeze authority still active" : "authorities renounced", evidence: { mint: ctx.mintAcc.mintAuthority, freeze: ctx.mintAcc.freezeAuthority }, implemented: true, requiredForSafety: true };
  } else {
    datasets.authorities = { status: "INCOMPLETE", reason: "mint account not parsed", implemented: true, requiredForSafety: true };
  }

  // Holders (raw top-10) + insider (unique beneficial owners).
  const holdings = (ctx.largest ?? []).map((a) => ({ tokenAccount: a.address, owner: ctx.owners.get(a.address) ?? null, amountRaw: Number(a.amount) }));
  if (holdings.length && supplyRaw > 0) {
    const rawTop10 = [...holdings].sort((a, b) => b.amountRaw - a.amountRaw).slice(0, 10).reduce((s, h) => s + h.amountRaw, 0) / supplyRaw;
    onChain.holderTop10Pct = Math.min(1, rawTop10);
    datasets.holders = { status: "OK", implemented: true, requiredForSafety: true };
    datasets.holder_concentration = { status: "OK", value: onChain.holderTop10Pct, implemented: true, requiredForSafety: true };
  } else {
    datasets.holders = { status: "INCOMPLETE", reason: "largest accounts unavailable", implemented: true, requiredForSafety: true };
    datasets.holder_concentration = { status: "INCOMPLETE", reason: "need supply + holders", implemented: true, requiredForSafety: true };
  }

  // The pool vault and the mint itself are NOT beneficial holders. Without this the
  // LP vault counts as an "insider" and inflates concentration (pumpswap pools hold
  // ~8-10% of supply), which can wrongly REJECT a clean token.
  const excludeOwners = new Set<string>([ctx.mint, ...(ctx.poolAddress ? [ctx.poolAddress] : [])]);
  const insider = analyzeInsider({ holdings, supplyRaw, nowMs: ctx.nowMs, excludeOwners });
  if (insider.uniqueOwnerTop10Pct != null) onChain.insiderPct = insider.uniqueOwnerTop10Pct;
  datasets.insider_concentration = rec("insider_concentration", insider);

  // Rug risk at $5-50k, where a top-10 aggregate hides the case that actually ends a
  // coin: one wallet holding enough to exit through the entire float.
  const rug = analyzeRugRisk({
    mintAuthorityActive: flags.mintAuthorityActive ?? null,
    freezeAuthorityActive: flags.freezeAuthorityActive ?? null,
    ownerShares: insider.ownerShares,
    deployerShare: null,   // set below once the deployer analysis has run
    activity: null,        // market activity is judged in the pipeline, not here
  });
  onChain.largestHolderPct = rug.largestHolderPct ?? undefined;
  onChain.top5Pct = rug.top5Pct ?? undefined;
  datasets.rug_risk = {
    status: rug.verdict === "DANGER" ? "FAIL" : rug.verdict === "UNKNOWN" ? "INCOMPLETE" : "OK",
    value: rug.largestHolderPct ?? undefined,
    reason: rug.blocking[0] ?? rug.concerns[0] ?? "no rug signal on the checks available",
    evidence: { verdict: rug.verdict, largestHolderPct: rug.largestHolderPct, top5Pct: rug.top5Pct,
                blocking: rug.blocking, concerns: rug.concerns },
    implemented: true, requiredForSafety: true,
  };

  // Sellability (Jupiter) — classified; only a CONFIRMED fail sets sellable=false.
  const sell = analyzeSellability({
    quotes: ctx.sellQuotes, freezeAuthorityActive: ctx.freezeActive, nowMs: ctx.nowMs,
    buyRouteExists: ctx.buyRouteExists, poolFresh: ctx.poolFresh, attempts: ctx.sellAttempts,
  });
  if (sell.sellable != null) flags.sellable = sell.sellable;
  datasets.sellability = { ...rec("sellability", sell), classification: sell.classification } as DatasetInfo & { classification: string };

  // Deployer identity + funding exposure.
  const dep = analyzeDeployer({ creator: ctx.deployer.creator, creationSig: ctx.deployer.creationSig, reachedOldest: ctx.deployer.reachedOldest, deployerBalanceRaw: ctx.deployer.balanceRaw, supplyRaw, nowMs: ctx.nowMs });
  if (dep.fundingRiskScore != null) onChain.fundingRiskScore = dep.fundingRiskScore;
  flags.blacklistMatch = false; // no reputation source on free tier → not a match (advisory)
  datasets.deployer_identity = rec("deployer_identity", { ...dep, status: dep.creator ? "OK" : dep.status });
  datasets.deployer_funding = rec("deployer_funding", dep);

  // Bundle — honest: free RPC can't reliably reconstruct the launch window.
  const bundle = analyzeBundle({ earlyBuys: [], supplyRaw, nowMs: ctx.nowMs, hasLaunchData: false });
  if (bundle.bundleSupplyPct != null) onChain.bundleSupplyPct = bundle.bundleSupplyPct;
  datasets.bundle_contamination = rec("bundle_contamination", bundle);
  // Deployer selling — free proxy: did the creator's balance fall since last enrichment?
  const devSell = analyzeDeployerSelling(ctx.prevDeployerExposure, dep.deployerExposurePct, ctx.nowMs);
  datasets.deployer_sales = rec("deployer_sales", devSell);
  if (devSell.sold === true) {
    // A confirmed dev dump is a hard risk — surface it on the funding-risk score too.
    onChain.fundingRiskScore = Math.max(onChain.fundingRiskScore ?? 0, 0.9);
  }
  datasets.wallet_clusters = { status: "UNAVAILABLE", reason: DATASET_REGISTRY.wallet_clusters!.paidUpgrade, implemented: false, requiredForSafety: false };

  // Liquidity drain (derived from history).
  const drain = analyzeLiquidityDrain(ctx.liqHistory, ctx.nowMs);
  datasets.liquidity_drain = rec("liquidity_drain", drain);

  // COMPLETE only when every REQUIRED dataset is OK (never on advisory gaps).
  const required = Object.values(DATASET_REGISTRY).filter((d) => d.requiredForSafety).map((d) => d.id);
  const allRequiredOk = required.every((id) => datasets[id]?.status === "OK");
  const statusOverall = allRequiredOk ? "COMPLETE" : "PARTIAL";

  const responseHash = stableHash({
    supply: ctx.supply?.amount, top10: onChain.holderTop10Pct, insider: onChain.insiderPct,
    auth: [ctx.mintAcc?.mintAuthority, ctx.mintAcc?.freezeAuthority], sellable: flags.sellable,
    deployer: dep.creator, exposure: dep.deployerExposurePct, drain: drain.severity,
  });
  return { intel: { onChain, flags }, datasets, statusOverall, responseHash };
}

/** Fetch all inputs, run analyzers, persist. Returns whether intel changed. */
export async function enrichCandidate(pool: Pool, helius: HeliusAdapter, jupiter: JupiterAdapter, candidateId: string, mint: string, nowMs: number): Promise<{ changed: boolean; status: string }> {
  await pool.query(
    `UPDATE candidates SET enrichment_status='RUNNING', enrichment_started_at=to_timestamp($2), enrichment_attempts=enrichment_attempts+1 WHERE id=$1`,
    [candidateId, nowMs / 1000],
  );

  // Pool + latest price (+ its age → poolFresh) for sizing the sell quotes + drain history.
  const meta = await pool.query<{ pool_id: string | null; pool_address: string | null; price_usd: string | null; price_age_s: string | null }>(
    `SELECT c.pool_id, p.pool_address,
       (SELECT price_usd FROM prices WHERE pool_id=c.pool_id ORDER BY observed_at DESC LIMIT 1) price_usd,
       (SELECT extract(epoch FROM (now()-observed_at)) FROM prices WHERE pool_id=c.pool_id ORDER BY observed_at DESC LIMIT 1) price_age_s
     FROM candidates c LEFT JOIN pools p ON p.id=c.pool_id WHERE c.id=$1`, [candidateId]);
  const poolId = meta.rows[0]?.pool_id ?? null;
  const poolAddress = meta.rows[0]?.pool_address ?? null;
  const priceUsd = meta.rows[0]?.price_usd != null ? Number(meta.rows[0].price_usd) : 0;
  const poolFresh = meta.rows[0]?.price_age_s != null && Number(meta.rows[0].price_age_s) < 15 * 60;

  // Read the PREVIOUS deployer exposure before we overwrite the enrichment row.
  const prevRow = await pool.query<{ exposure: string | null }>(
    `SELECT (datasets->'deployer_funding'->'evidence'->>'exposure') AS exposure FROM onchain_enrichment WHERE candidate_id=$1`, [candidateId]);
  const prevDeployerExposure = prevRow.rows[0]?.exposure != null ? Number(prevRow.rows[0].exposure) : null;

  const [supply, largest, mintAcc] = await Promise.all([helius.tokenSupply(mint), helius.tokenLargestAccounts(mint), helius.mintAccount(mint)]);
  const decimals = supply?.decimals ?? mintAcc?.decimals ?? 0;
  const freezeActive = mintAcc ? mintAcc.freezeAuthority != null : null;

  // Owner resolution (insider), deployer trace, sellability (multi-attempt + buy route), liquidity history.
  const [owners, deployer, sellData, liqRows] = await Promise.all([
    helius.accountOwners((largest ?? []).map((a) => a.address)).catch(() => new Map<string, string | null>()),
    (async () => {
      try {
        const oldest = await helius.oldestSignature(mint, 3);
        if (!oldest) return { creator: null, creationSig: null, reachedOldest: false, balanceRaw: null };
        const creator = await helius.transactionSigner(oldest.signature);
        const balanceRaw = creator ? await helius.ownerTokenBalance(creator, mint).catch(() => null) : null;
        return { creator, creationSig: oldest.signature, reachedOldest: true, balanceRaw };
      } catch { return { creator: null, creationSig: null, reachedOldest: false, balanceRaw: null }; }
    })(),
    (async () => {
      if (!(priceUsd > 0)) return { quotes: [] as SellQuote[], attempts: 0, buyRouteExists: null as boolean | null };
      let quotes = await jupiter.sellQuotes(mint, decimals, priceUsd, SELL_SIZES_USD).catch(() => [] as SellQuote[]);
      let attempts = 1;
      const smallestRouted = quotes.sort((a, b) => a.sizeUsd - b.sizeUsd)[0]?.routed;
      // Second attempt on the smallest size if the first didn't route (reproducibility).
      if (smallestRouted === false) {
        const retry = await jupiter.sellQuotes(mint, decimals, priceUsd, [SELL_SIZES_USD[0]!]).catch(() => [] as SellQuote[]);
        quotes = [...quotes, ...retry]; attempts = 2;
      }
      const buyRouteExists = await jupiter.buyRouteExists(mint).catch(() => null);
      return { quotes, attempts, buyRouteExists };
    })(),
    poolId ? pool.query<{ t: string; l: string }>(`SELECT extract(epoch from observed_at)*1000 t, liquidity_usd l FROM liquidity_snapshots WHERE pool_id=$1 AND observed_at > now()-interval '6 hours' ORDER BY observed_at`, [poolId]) : Promise.resolve({ rows: [] as Array<{ t: string; l: string }> }),
  ]);
  const liqHistory: LiqPoint[] = liqRows.rows.map((r) => ({ atMs: Number(r.t), liquidityUsd: Number(r.l) }));

  const result = buildIntel({ nowMs, supply, largest, mintAcc, owners, deployer, sellQuotes: sellData.quotes, sellAttempts: sellData.attempts, buyRouteExists: sellData.buyRouteExists, poolFresh, freezeActive, liqHistory, poolAddress, mint, prevDeployerExposure });

  const prev = await pool.query<{ response_hash: string | null }>(`SELECT response_hash FROM onchain_enrichment WHERE candidate_id=$1`, [candidateId]);
  const changed = prev.rows[0]?.response_hash !== result.responseHash;

  await pool.query(
    `INSERT INTO onchain_enrichment (candidate_id, intel, datasets, data_version, response_hash, computed_at)
     VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT (candidate_id) DO UPDATE SET intel=EXCLUDED.intel, datasets=EXCLUDED.datasets, data_version=EXCLUDED.data_version, response_hash=EXCLUDED.response_hash, computed_at=now()`,
    [candidateId, JSON.stringify(result.intel), JSON.stringify(result.datasets), ENRICHMENT_DATA_VERSION, result.responseHash],
  );
  await pool.query(
    `UPDATE candidates SET enrichment_status=$2, enrichment_completed_at=to_timestamp($3), enrichment_last_success_at=to_timestamp($3),
       enrichment_data_version=$4, enrichment_next_retry_at=to_timestamp($5), enrichment_last_error=NULL WHERE id=$1`,
    [candidateId, result.statusOverall, nowMs / 1000, ENRICHMENT_DATA_VERSION, (nowMs + ENRICHMENT_TTL_MS) / 1000],
  );
  return { changed, status: result.statusOverall };
}

export async function loadEnrichment(pool: Pool, candidateId: string): Promise<StoredIntel | null> {
  const r = await pool.query<{ intel: StoredIntel }>(`SELECT intel FROM onchain_enrichment WHERE candidate_id=$1`, [candidateId]);
  return r.rows[0]?.intel ?? null;
}

export async function loadEnrichmentWithDatasets(pool: Pool, candidateId: string): Promise<{ intel: StoredIntel; datasets: Record<string, any> } | null> {
  const r = await pool.query<{ intel: StoredIntel; datasets: Record<string, any> }>(`SELECT intel, datasets FROM onchain_enrichment WHERE candidate_id=$1`, [candidateId]);
  return r.rows[0] ?? null;
}

export async function markEnrichmentFailed(pool: Pool, candidateId: string, error: string, deadLettered: boolean): Promise<void> {
  await pool.query(
    `UPDATE candidates SET enrichment_status=$2, enrichment_last_error=$3 WHERE id=$1`,
    [candidateId, deadLettered ? "FAILED" : "RETRYING", error.slice(0, 500)],
  );
}
