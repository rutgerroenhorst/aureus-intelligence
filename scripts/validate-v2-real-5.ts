import { Pool } from "pg";
import { loadEnrichmentWithDatasets } from "../apps/worker/src/enrichment.js";
import { evaluateVerificationGates, type VerificationGatesInput } from "../packages/intelligence-v2/src/index.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

console.log("=".repeat(80));
console.log("V2 REAL CANDIDATE VALIDATION TEST");
console.log("=".repeat(80));

// SELECT 5 REAL DIVERSE CANDIDATES
console.log("\nSelecting 5 diverse real candidates with complete enrichment...\n");

const candidates = await pool.query(`
  SELECT
    oe.candidate_id,
    oe.intel->'onChain'->>'available' as onchain_available,
    (oe.intel->'onChain'->>'holderTop10Pct')::numeric as holderTop10Pct,
    (oe.intel->'onChain'->>'insiderPct')::numeric as insiderPct,
    (oe.intel->'onChain'->>'fundingRiskScore')::numeric as fundingRiskScore,
    (oe.intel->'flags'->>'freezeAuthorityActive')::boolean as freezeAuthorityActive,
    (oe.intel->'flags'->>'mintAuthorityActive')::boolean as mintAuthorityActive,
    (oe.datasets->'deployer_identity'->'evidence'->>'creator')::text as creator,
    (oe.datasets->'holders'->>'status')::text as holders_status,
    (oe.datasets->'authorities'->>'status')::text as auth_status
  FROM onchain_enrichment oe
  WHERE oe.intel->'onChain'->>'holderTop10Pct' IS NOT NULL
  AND oe.intel->'onChain'->>'holderTop10Pct' != 'null'
  ORDER BY RANDOM()
  LIMIT 5
`);

const candidateIds = candidates.rows.map(r => r.candidate_id);

console.log(`Found ${candidates.rows.length} candidates:\n`);
candidates.rows.forEach((c, i) => {
  console.log(`${i + 1}. ${c.candidate_id}`);
  console.log(`   Holder 10%: ${c.holderTop10Pct}, Insider: ${c.insiderPct}`);
  console.log(`   Freeze Auth: ${c.freezeAuthorityActive}, Mint Auth: ${c.mintAuthorityActive}`);
  console.log(`   Creator: ${c.creator?.slice(0, 20)}...`);
});

// AUDIT EACH CANDIDATE
console.log("\n" + "=".repeat(80));
console.log("AUDITING 5 REAL CANDIDATES");
console.log("=".repeat(80));

const results: any[] = [];

for (const candidateId of candidateIds) {
  const enr = await loadEnrichmentWithDatasets(pool, candidateId);

  if (!enr) {
    console.log(`\nCandidate ${candidateId}: NO ENRICHMENT (should be INSUFFICIENT_DATA)`);
    continue;
  }

  const intel = enr.intel;
  const datasets = enr.datasets;

  // BUILD V2 INPUT USING REAL MAPPING
  const topHolders = intel.onChain.holderTop10Pct != null ? [
    { wallet: "top-10-aggregate", pct: intel.onChain.holderTop10Pct },
  ] : undefined;

  const deployerInfo = datasets.deployer_identity as any;
  const deployerAddress = deployerInfo?.evidence?.creator;

  const v2Input: VerificationGatesInput = {
    features: new Map(),
    mint: {
      freezeAuthority: intel.flags.freezeAuthorityActive != null ? {
        address: "unknown",
        isMutable: intel.flags.freezeAuthorityActive,
      } : undefined,
      mintAuthority: intel.flags.mintAuthorityActive != null ? {
        address: "unknown",
        isMutable: intel.flags.mintAuthorityActive,
      } : undefined,
    },
    topHolders,
    deployer: deployerAddress ? { address: deployerAddress } : undefined,
    createdAt: 0,
    knownRugs: [],
  };

  // EVALUATE
  const verdict = evaluateVerificationGates(v2Input);

  // RECORD
  results.push({
    candidateId,
    status: verdict.status,
    confidence: verdict.confidence,
    freezeAuth: v2Input.mint.freezeAuthority?.isMutable,
    creator: deployerAddress?.slice(0, 20),
    holderTop10Pct: intel.onChain.holderTop10Pct,
    insiderPct: intel.onChain.insiderPct,
    fundingRiskScore: intel.onChain.fundingRiskScore,
    failedGates: verdict.failedGates.map(g => g.gateId),
    missingFields: verdict.missingCriticalFields,
    suppressionReasons: verdict.suppressionReasons,
  });

  // PRINT
  console.log(`\n${candidateId}`);
  console.log(`  Status: ${verdict.status} (confidence: ${verdict.confidence}%)`);
  console.log(`  Freeze Authority Mutable: ${v2Input.mint.freezeAuthority?.isMutable}`);
  console.log(`  Creator: ${deployerAddress?.slice(0, 20)}...`);
  console.log(`  Top 10 Holders: ${(intel.onChain.holderTop10Pct * 100).toFixed(1)}%`);
  console.log(`  Insider: ${(intel.onChain.insiderPct * 100).toFixed(1)}%`);
  if (verdict.failedGates.length > 0) {
    console.log(`  Failed gates: ${verdict.failedGates.map(g => g.gateId).join(", ")}`);
  }
  if (verdict.missingCriticalFields.length > 0) {
    console.log(`  Missing fields: ${verdict.missingCriticalFields.join(", ")}`);
  }
}

// TEST MISSING-DATA CANDIDATE
console.log("\n" + "=".repeat(80));
console.log("TESTING CANDIDATE WITHOUT ENRICHMENT");
console.log("=".repeat(80));

const noEnr = await pool.query(`
  SELECT id FROM candidates
  WHERE id NOT IN (SELECT candidate_id FROM onchain_enrichment)
  LIMIT 1
`);

if (noEnr.rows.length > 0) {
  const noEnrId = noEnr.rows[0].id;
  console.log(`\nCandidate ${noEnrId} (no enrichment):`);

  const v2Input: VerificationGatesInput = {
    features: new Map(),
    mint: { },
    topHolders: undefined,
    deployer: undefined,
    createdAt: 0,
    knownRugs: [],
  };

  const verdict = evaluateVerificationGates(v2Input);
  console.log(`  Expected: INSUFFICIENT_DATA`);
  console.log(`  Actual: ${verdict.status}`);
  console.log(`  Confidence: ${verdict.confidence}%`);
  console.log(`  Missing fields: ${verdict.missingCriticalFields.join(", ")}`);

  if (verdict.status === "INSUFFICIENT_DATA") {
    console.log(`  ✓ CORRECT: Missing data properly marked as INSUFFICIENT_DATA`);
  } else {
    console.log(`  ✗ WRONG: Expected INSUFFICIENT_DATA but got ${verdict.status}`);
  }
}

// SUMMARY TABLE
console.log("\n" + "=".repeat(80));
console.log("SUMMARY TABLE");
console.log("=".repeat(80) + "\n");

console.log("Candidate | Status | Confidence | Freeze | Creator | Top10 | Insider | Failed Gates");
console.log("-".repeat(100));

results.forEach(r => {
  const candidate = r.candidateId.slice(0, 8);
  const freeze = r.freezeAuth === true ? "MUTABLE" : r.freezeAuth === false ? "SAFE" : "UNKNOWN";
  const creator = r.creator || "NONE";
  const top10 = (r.holderTop10Pct * 100).toFixed(1) + "%";
  const insider = (r.insiderPct * 100).toFixed(1) + "%";
  const gates = r.failedGates.join(",") || "NONE";

  console.log(
    `${candidate} | ${r.status.padEnd(15)} | ${r.confidence.toString().padStart(3)}% | ${freeze.padEnd(7)} | ${creator.padEnd(10)} | ${top10.padEnd(6)} | ${insider.padEnd(7)} | ${gates}`,
  );
});

await pool.end();
