import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Find one candidate with both enrichment data and a V2 evaluation
const result = await pool.query(`
  SELECT
    oe.candidate_id,
    oe.intel->'onChain'->'holderTop10Pct' as holderTop10Pct,
    ivs.v2_status,
    ivs.result_json->'suppressionReasons'->>0 as first_reason
  FROM onchain_enrichment oe
  LEFT JOIN intelligence_v2_scores ivs ON oe.candidate_id::text = ivs.candidate_id
  WHERE oe.intel->'onChain'->'holderTop10Pct' IS NOT NULL
  LIMIT 5
`);

console.log("Sample candidates with holderTop10Pct:\n");
result.rows.forEach(r => {
  console.log(`Candidate: ${r.candidate_id}`);
  console.log(`  holderTop10Pct: ${r.holderTop10Pct}`);
  if (r.v2_status) {
    console.log(`  V2 Status: ${r.v2_status}`);
    console.log(`  Reason: ${r.first_reason}`);
  } else {
    console.log(`  V2 Status: NOT EVALUATED YET`);
  }
  console.log();
});

await pool.end();
