import { Pool } from "pg";
import { loadEnrichmentWithDatasets } from "../apps/worker/src/enrichment.js";
import { evaluateVerificationGates, type VerificationGatesInput } from "../packages/intelligence-v2/src/index.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

console.log("V2 VALIDATION WITH REAL FEATURES\n");

// Get ONE candidate and load both enrichment AND latest features
const result = await pool.query(`
  SELECT
    c.id,
    c.pool_id,
    oe.candidate_id,
    oe.intel
  FROM candidates c
  LEFT JOIN onchain_enrichment oe ON c.id = oe.candidate_id
  WHERE oe.candidate_id IS NOT NULL
  LIMIT 1
`);

if (result.rows.length === 0) {
  console.log("No enriched candidates found");
  await pool.end();
  process.exit(0);
}

const candidateId = result.rows[0].id;
const poolId = result.rows[0].pool_id;
console.log(`Testing candidate ${candidateId}\n`);

// Load enrichment
const enr = await loadEnrichmentWithDatasets(pool, candidateId);
if (!enr) {
  console.log("No enrichment for candidate");
  await pool.end();
  process.exit(0);
}

// Load latest features
const featureResult = await pool.query(`
  SELECT feature_id, status, value
  FROM feature_values
  WHERE candidate_id = $1
  ORDER BY calculated_at DESC
`, [candidateId]);

const features = new Map(
  featureResult.rows.map(r => [
    r.feature_id,
    { status: r.status, value: r.value, dataQuality: "UNKNOWN" }
  ])
);

console.log(`Loaded features: ${features.size}`);
const relevantFeatures = ["deployer_funding_risk", "insider_concentration"];
relevantFeatures.forEach(f => {
  const v = features.get(f);
  console.log(`  ${f}: ${v ? `${v.status} = ${v.value}` : "NOT FOUND"}`);
});

// Build V2 input with REAL features
const topHolders = enr.intel.onChain.holderTop10Pct != null ? [
  { wallet: "top-10-aggregate", pct: enr.intel.onChain.holderTop10Pct },
] : undefined;

const deployerInfo = enr.datasets.deployer_identity as any;
const deployerAddress = deployerInfo?.evidence?.creator;

const v2Input: VerificationGatesInput = {
  features,
  mint: {
    freezeAuthority: enr.intel.flags.freezeAuthorityActive != null ? {
      address: "unknown",
      isMutable: enr.intel.flags.freezeAuthorityActive,
    } : undefined,
    mintAuthority: enr.intel.flags.mintAuthorityActive != null ? {
      address: "unknown",
      isMutable: enr.intel.flags.mintAuthorityActive,
    } : undefined,
  },
  topHolders,
  deployer: deployerAddress ? { address: deployerAddress } : undefined,
  createdAt: 0,
  knownRugs: [],
};

console.log("\nV2 Input state:");
console.log(`  topHolders: ${topHolders ? topHolders[0].pct : "undefined"}`);
console.log(`  deployer: ${deployerAddress?.slice(0, 20)}...`);
console.log(`  freezeAuth: ${v2Input.mint.freezeAuthority?.isMutable}`);

// Evaluate
const verdict = evaluateVerificationGates(v2Input);

console.log(`\nV2 Result:`);
console.log(`  Status: ${verdict.status}`);
console.log(`  Confidence: ${verdict.confidence}%`);
if (verdict.failedGates.length > 0) {
  console.log(`  Failed gates:`);
  verdict.failedGates.forEach(g => {
    console.log(`    - ${g.gateId}: ${g.reason}`);
  });
}
if (verdict.missingCriticalFields.length > 0) {
  console.log(`  Missing fields:`);
  verdict.missingCriticalFields.forEach(f => {
    console.log(`    - ${f}`);
  });
}
if (verdict.cautionGates.length > 0) {
  console.log(`  Caution gates:`);
  verdict.cautionGates.forEach(g => {
    console.log(`    - ${g.gateId}: ${g.reason}`);
  });
}

await pool.end();
