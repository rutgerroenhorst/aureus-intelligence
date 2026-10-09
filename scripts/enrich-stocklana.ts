import { Pool } from "pg";
import { HeliusAdapter, JupiterAdapter } from "@aureus/ingestion";
import { enrichCandidate } from "../apps/worker/src/enrichment.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://aureus:aureus@localhost:5432/aureus",
});

const helius = new HeliusAdapter({
  apiKey: process.env.HELIUS_API_KEY || "",
});

const jupiter = new JupiterAdapter({
  agentAddress: process.env.AGENT_ADDRESS || "98pjRuQjK3qDBsFW2DtF5rDHSRiGzDnyakCFAgjKMAsJ",
});

const candidateId = "947e9919-5184-426e-bb7f-13e3bfa8b33a";
const mint = "C5tGuxaPnbxHHP6RTpAQs34x8TN8A9ZfJxcfizd2WF3u";

console.log(`\n=== Enriching Stocklana ===`);
console.log(`Candidate ID: ${candidateId}`);
console.log(`Mint: ${mint}`);
console.log(`Helius API Key: ${helius ? "✓ configured" : "✗ missing"}\n`);

try {
  const result = await enrichCandidate(pool, helius, jupiter, candidateId, mint, Date.now());
  console.log("✓ Enrichment completed");
  console.log(`  Changed: ${result.changed}`);
  console.log(`  Status: ${result.status}\n`);

  // Query the enrichment result
  const enr = await pool.query(`
    SELECT intel, datasets
    FROM onchain_enrichment
    WHERE candidate_id = $1::uuid
    ORDER BY computed_at DESC
    LIMIT 1
  `, [candidateId]);

  if (enr.rows.length > 0) {
    const intel = enr.rows[0].intel as any;
    const datasets = enr.rows[0].datasets as any;
    
    console.log("=== Enrichment Result ===");
    console.log("\nIntel:");
    console.log(`  available: ${intel.available}`);
    console.log(`  holderTop10Pct: ${intel.holderTop10Pct ?? "N/A"}`);
    console.log(`  insiderPct: ${intel.insiderPct ?? "N/A"}`);
    console.log(`  fundingRiskScore: ${intel.fundingRiskScore ?? "N/A"}`);

    if (datasets) {
      console.log("\nDatasets:");
      const key = "deployer_identity";
      const dep = datasets[key];
      if (dep) {
        console.log(`  ${key}:`);
        console.log(`    status: ${dep.status}`);
        if (dep.evidence) {
          console.log(`    creator: ${dep.evidence.creator ?? "N/A"}`);
          console.log(`    creationSig: ${dep.evidence.creationSig ? dep.evidence.creationSig.slice(0, 20) + "..." : "N/A"}`);
        }
      }
    }
  } else {
    console.log("✗ No enrichment record found after execution");
  }
} catch (err) {
  console.error("✗ Enrichment failed:");
  console.error((err as any).message);
  if ((err as any).stack) console.error((err as any).stack.split('\n').slice(0, 5).join('\n'));
} finally {
  await pool.end();
}
