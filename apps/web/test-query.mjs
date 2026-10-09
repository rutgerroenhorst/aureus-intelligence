import { getPool } from '@aureus/db';

const pool = getPool();

const result = await pool.query(`
  SELECT c.id, c.candidate_code, t.symbol_label, t.mint, p.pool_address, c.pool_id,
    pr.price_usd
  FROM candidates c
  JOIN tokens t ON t.id=c.token_id
  LEFT JOIN pools p ON p.id=c.pool_id
  LEFT JOIN LATERAL (SELECT price_usd, market_cap_usd, fdv_usd, observed_at FROM prices WHERE pool_id=c.pool_id ORDER BY observed_at DESC LIMIT 1) pr ON true
  LEFT JOIN LATERAL (SELECT liquidity_usd FROM liquidity_snapshots WHERE pool_id=c.pool_id ORDER BY observed_at DESC LIMIT 1) lq ON true
  LEFT JOIN LATERAL (SELECT buys, sells, volume_usd FROM transaction_aggregates WHERE pool_id=c.pool_id ORDER BY observed_at DESC LIMIT 1) tx ON true
  LEFT JOIN onchain_enrichment oe ON oe.candidate_id=c.id
  LEFT JOIN candidate_action_status cas ON cas.candidate_id=c.id
  LEFT JOIN LATERAL (
    SELECT v2_status, v2_confidence, result_json, computed_at, score_version, v2_tier
    FROM intelligence_v2_scores
    WHERE candidate_id = c.id
    ORDER BY computed_at DESC
    LIMIT 1
  ) ivs ON true
  WHERE c.discovery_source NOT IN ('mock','manual')
    AND c.current_state <> 'EXPIRED'
    AND pr.price_usd IS NOT NULL
  LIMIT 10
`);

console.log('Rows returned:', result.rows.length);
if (result.rows.length > 0) {
  console.log('Sample rows:');
  console.table(result.rows.slice(0, 3));
} else {
  console.log('ZERO ROWS returned!');

  // Debug: Check how many candidates exist
  const candResult = await pool.query('SELECT COUNT(*) FROM candidates WHERE discovery_source NOT IN (\'mock\',\'manual\')');
  console.log('Total candidates:', candResult.rows[0].count);

  const candWithPrice = await pool.query(`
    SELECT COUNT(*) FROM candidates c
    LEFT JOIN LATERAL (SELECT price_usd FROM prices WHERE pool_id=c.pool_id ORDER BY observed_at DESC LIMIT 1) pr ON true
    WHERE c.discovery_source NOT IN ('mock','manual')
      AND c.current_state <> 'EXPIRED'
      AND pr.price_usd IS NOT NULL
  `);
  console.log('Candidates with price:', candWithPrice.rows[0].count);
}

process.exit(0);
