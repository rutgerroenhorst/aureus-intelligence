import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const result = await pool.query(`
  SELECT
    v2_status,
    COUNT(*) as count,
    ROUND(AVG(v2_confidence)) as avg_confidence
  FROM intelligence_v2_scores
  GROUP BY v2_status
  ORDER BY count DESC
`);

console.log("\n=== V2 VERIFICATION RESULTS ===");
result.rows.forEach((r) => {
  console.log(`${r.v2_status}: ${r.count} (avg confidence: ${r.avg_confidence}%)`);
});

// Get distribution
const total = result.rows.reduce((s, r) => s + Number(r.count), 0);
console.log(`\nTotal evaluated: ${total}`);
result.rows.forEach((r) => {
  const pct = ((Number(r.count) * 100) / total).toFixed(1);
  console.log(`  ${r.v2_status}: ${pct}%`);
});

// Get examples of each status
for (const status of ["FATAL_REJECT", "INSUFFICIENT_DATA", "STRUCTURALLY_QUALIFIED"]) {
  console.log(`\n=== Examples of ${status} ===`);
  const ex = await pool.query(
    `
    SELECT
      candidate_id,
      v2_confidence,
      result_json->'suppressionReasons' as reasons,
      result_json->'missingCriticalFields' as missing
    FROM intelligence_v2_scores
    WHERE v2_status = $1
    ORDER BY computed_at DESC
    LIMIT 3
  `,
    [status],
  );

  for (const row of ex.rows) {
    console.log(`\nCandidate: ${row.candidate_id} | Confidence: ${row.v2_confidence}%`);
    if (row.reasons && Array.isArray(row.reasons)) {
      console.log(`  Reasons: ${row.reasons[0]}`);
    }
    if (row.missing && Array.isArray(row.missing) && row.missing.length > 0) {
      console.log(`  Missing: ${row.missing[0]}`);
    }
  }
}

await pool.end();
