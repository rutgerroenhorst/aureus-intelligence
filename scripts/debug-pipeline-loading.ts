import { Pool } from "pg";
import { loadEnrichmentWithDatasets } from "../apps/worker/src/enrichment.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const candidateId = "89a04eaa-7d21-4917-9d4c-fcfff6b77ce5";

console.log(`Testing pipeline enrichment loading for ${candidateId}\n`);

// Load with new function
const enr = await loadEnrichmentWithDatasets(pool, candidateId);

if (!enr) {
  console.log("ERROR: loadEnrichmentWithDatasets returned null!");
} else {
  console.log("Enrichment loaded successfully");
  console.log("intel.onChain.available:", enr.intel.onChain.available);
  console.log("intel.onChain.holderTop10Pct:", enr.intel.onChain.holderTop10Pct);
  console.log("intel.flags:", enr.intel.flags);

  // Simulate pipeline logic
  const onChain = enr.intel.onChain;
  console.log("\nSimulating pipeline V2 input construction:");
  console.log("onChain.holderTop10Pct != null?", onChain.holderTop10Pct != null);

  const topHolders = onChain.holderTop10Pct != null ? [
    { wallet: "top-10-aggregate", pct: onChain.holderTop10Pct },
  ] : undefined;

  console.log("topHolders:", topHolders);
}

await pool.end();
