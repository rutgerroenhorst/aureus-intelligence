import { getPool } from '@aureus/db';

const pool = getPool();

const result = await pool.query(`
  WITH winners AS (
    SELECT 
      c.id,
      t.symbol_label,
      c.candidate_code,
      ROUND(COALESCE(pr_now.price_usd::numeric / pr_first.price_usd::numeric, 1), 2) as multiplier,
      c.current_state,
      cas.status as action_status,
      ivs.v2_status,
      ivs.v2_confidence,
      (oe.intel->'onChain'->>'holderTop10Pct')::float as holder_top10,
      (oe.intel->'flags'->>'mintAuthorityActive')::boolean as mint_auth
    FROM candidates c
    JOIN tokens t ON t.id = c.token_id
    LEFT JOIN onchain_enrichment oe ON oe.candidate_id = c.id
    LEFT JOIN candidate_action_status cas ON cas.candidate_id = c.id
    LEFT JOIN LATERAL (
      SELECT price_usd FROM prices 
      WHERE pool_id = c.pool_id 
      ORDER BY observed_at ASC LIMIT 1
    ) pr_first ON true
    LEFT JOIN LATERAL (
      SELECT price_usd FROM prices 
      WHERE pool_id = c.pool_id 
      ORDER BY observed_at DESC LIMIT 1
    ) pr_now ON true
    LEFT JOIN LATERAL (
      SELECT v2_status, v2_confidence FROM intelligence_v2_scores
      WHERE candidate_id = c.id
      ORDER BY computed_at DESC LIMIT 1
    ) ivs ON true
    WHERE pr_first.price_usd IS NOT NULL 
      AND pr_now.price_usd IS NOT NULL
      AND (pr_now.price_usd::numeric / pr_first.price_usd::numeric) >= 5
  )
  SELECT * FROM winners ORDER BY multiplier DESC
`);

console.log('\n=== 5x+ WINNERS - WHO ARE WE CATCHING VS REJECTING? ===\n');

let qualified = [];
let rejected = [];

result.rows.forEach(r => {
  const entry = {
    symbol: r.symbol_label,
    mult: parseFloat(r.multiplier),
    v2_status: r.v2_status,
    conf: r.v2_confidence,
    action: r.action_status,
    holder: parseFloat(r.holder_top10 || 0)
  };
  
  if (r.v2_status === 'STRUCTURALLY_QUALIFIED') {
    qualified.push(entry);
  } else if (r.action_status === 'REJECTED') {
    rejected.push(entry);
  }
});

console.log(`✅ QUALIFIED WINNERS (5x+): ${qualified.length}`);
qualified.forEach(w => {
  console.log(`   ${w.symbol.padEnd(12)} ${w.mult}x - confidence: ${w.conf}%`);
});

console.log(`\n⚠️  REJECTED WINNERS (5x+): ${rejected.length}`);
rejected.forEach(w => {
  console.log(`   ${w.symbol.padEnd(12)} ${w.mult}x - SHOULD HAVE CAUGHT THIS!`);
});

console.log(`\n🔴 THE PROBLEM:`);
console.log(`   We're letting ${rejected.length} big winners slip through as REJECTED`);
console.log(`   Their combined potential: ${rejected.reduce((a,w)=>a+w.mult,0).toFixed(1)}x`);
console.log(`   This suggests our gates are TOO STRICT or WRONG`);

process.exit(0);
