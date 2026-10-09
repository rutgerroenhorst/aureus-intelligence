import { Pool } from "pg";
import { loadEnrichmentWithDatasets } from "../apps/worker/src/enrichment.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Get a candidate with enrichment data
const cand = await pool.query(`
  SELECT candidate_id FROM onchain_enrichment LIMIT 1
`);

if (cand.rows.length > 0) {
  const candidateId = cand.rows[0].candidate_id;
  console.log(`Testing loadEnrichmentWithDatasets with candidate: ${candidateId}`);

  const enr = await loadEnrichmentWithDatasets(pool, candidateId);

  if (enr) {
    console.log("\n=== Enrichment Loaded Successfully ===");
    console.log("Intel keys:", Object.keys(enr.intel));
    console.log("intel.onChain available:", enr.intel.onChain.available);
    console.log("intel.flags:", enr.intel.flags);

    const deployerDataset = enr.datasets.deployer_identity as any;
    console.log("\nDeployer dataset:");
    console.log("Status:", deployerDataset?.status);
    console.log("Creator:", deployerDataset?.evidence?.creator);

    // Now test extracting the deployer address like pipeline.ts does
    const deployerInfo = enr.datasets.deployer_identity as any;
    const deployerAddress = deployerInfo?.evidence?.creator;

    console.log("\nExtracted deployer address:", deployerAddress);
  } else {
    console.log("No enrichment found");
  }
}

await pool.end();
