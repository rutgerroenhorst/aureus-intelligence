import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Check if enrichment data exists
const enrCount = await pool.query("SELECT COUNT(*) as count FROM onchain_enrichment");
console.log(`Total enrichment records: ${enrCount.rows[0]?.count ?? 0}`);

// Check latest enrichment
const latest = await pool.query(`
  SELECT
    oe.candidate_id,
    oe.intel,
    oe.datasets,
    c.id as candidate_id_check
  FROM onchain_enrichment oe
  JOIN candidates c ON oe.candidate_id = c.id
  ORDER BY oe.computed_at DESC
  LIMIT 3
`);

console.log("\n=== Latest Enrichment Records ===");
for (const row of latest.rows) {
  console.log(`\nCandidate: ${row.candidate_id}`);
  const intel = row.intel as any;
  console.log(`OnChain available: ${intel.available}`);
  console.log(`Freeze Authority: ${intel.freezeAuthority ?? "NOT SET"}`);
  console.log(`  holderTop10Pct: ${intel.holderTop10Pct ?? "undefined"}`);
  console.log(`  fundingRiskScore: ${intel.fundingRiskScore ?? "undefined"}`);

  const datasets = row.datasets as any;
  if (datasets) {
    console.log("Datasets status:");
    const keys = ["authorities", "deployer_identity", "deployer_funding", "holders"];
    for (const key of keys) {
      const ds = datasets[key];
      if (ds) console.log(`  ${key}: ${ds.status}`);
    }
  }
}

// Check if there's deployer_identity data
const withDeployer = await pool.query(`
  SELECT
    candidate_id,
    datasets->'deployer_identity' as deployer_info
  FROM onchain_enrichment
  WHERE datasets->'deployer_identity' IS NOT NULL
  LIMIT 3
`);

console.log(`\n=== Deployer Identity Data ===`);
console.log(`Records with deployer_identity: ${withDeployer.rowCount}`);
for (const row of withDeployer.rows) {
  console.log(`Candidate: ${row.candidate_id}`);
  console.log(`  ${JSON.stringify(row.deployer_info, null, 2)}`);
}

await pool.end();
