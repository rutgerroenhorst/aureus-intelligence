import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Check holder data in intel
const result = await pool.query(`
  SELECT
    candidate_id,
    intel->'onChain'->'holderTop10Pct' as holderTop10Pct,
    datasets->'holders' as holders_dataset,
    datasets->'deployer_identity'->'evidence'->>'creator' as creator
  FROM onchain_enrichment
  LIMIT 10
`);

console.log("=== Holder Data Check ===\n");
result.rows.forEach((row) => {
  console.log(`Candidate: ${row.candidate_id}`);
  console.log(`  holderTop10Pct: ${row.holderTop10Pct}`);
  console.log(`  holders_dataset status: ${row.holders_dataset?.status}`);
  console.log(`  creator: ${row.creator ?? "(none)"}`);
});

// Count how many have holder data
const hasSome = result.rows.filter((r) => r.holderTop10Pct != null);
console.log(`\n${hasSome.length}/${result.rows.length} have holderTop10Pct`);

await pool.end();
