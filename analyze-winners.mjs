import { getPool } from '@aureus/db';

const pool = getPool();

// Find the biggest winners in history
const result = await pool.query(`
  SELECT 
    t.symbol_label,
    c.candidate_code,
    c.discovered_at,
    pr_first.price_usd as first_price,
    pr_now.price_usd as current_price,
    ROUND(pr_now.price_usd / pr_first.price_usd, 2) as multiplier,
    -- On-chain signals at discovery time
    (oe.intel->'onChain'->>'holderTop10Pct')::float as holder_concentration,
    (oe.intel->'flags'->>'mintAuthorityActive')::boolean as mint_active,
    (oe.intel->'flags'->>'freezeAuthorityActive')::boolean as freeze_active,
    -- Current state
    c.current_state,
    cas.status
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
  WHERE pr_first.price_usd IS NOT NULL 
    AND pr_now.price_usd IS NOT NULL
    AND c.discovered_at > now() - interval '90 days'
  ORDER BY (pr_now.price_usd / pr_first.price_usd) DESC
  LIMIT 30
`);

console.log('\n=== BIGGEST WINNERS (90 days) ===\n');
console.log('Symbol | Multiplier | Discovered | Holder % | Mint Auth | Status');
console.log('------|------------|------------|----------|-----------|--------');

result.rows.forEach(r => {
  const mult = r.multiplier.toString().padStart(8);
  const age = Math.round((Date.now() - new Date(r.discovered_at).getTime()) / (1000 * 60 * 60 * 24)) + 'd';
  const symbol = (r.symbol_label || r.candidate_code).padEnd(10);
  const holder = r.holder_concentration ? r.holder_concentration.toFixed(1) : '?';
  const mint = r.mint_active ? '✓' : '✗';
  console.log(`${symbol} | ${mult}x | ${age.padEnd(6)} | ${holder.padStart(6)}% | ${mint.padStart(3)} | ${r.status || 'N/A'}`);
});

// Now analyze the TOP winners to find patterns
console.log('\n\n=== TOP 10 WINNERS - DETAILED ANALYSIS ===\n');
const topWinners = result.rows.slice(0, 10);

topWinners.forEach((r, i) => {
  console.log(`${i+1}. ${r.symbol_label || r.candidate_code} - ${r.multiplier}x`);
  console.log(`   Discovered: ${r.discovered_at}`);
  console.log(`   Status: ${r.status}`);
  console.log(`   Holder concentration: ${r.holder_concentration}%`);
  console.log(`   Mint Authority: ${r.mint_active ? 'ACTIVE ⚠️' : 'inactive ✓'}`);
  console.log(`   Freeze Authority: ${r.freeze_active ? 'ACTIVE ⚠️' : 'inactive ✓'}`);
  console.log('');
});

// Pattern analysis
console.log('\n=== PATTERN ANALYSIS ===\n');
const avg_mult = result.rows.reduce((a, r) => a + r.multiplier, 0) / result.rows.length;
const big_winners = result.rows.filter(r => r.multiplier >= 5);
const small_winners = result.rows.filter(r => r.multiplier < 5);

console.log(`Average multiplier (top 30): ${avg_mult.toFixed(2)}x`);
console.log(`Big winners (5x+): ${big_winners.length}`);
console.log(`Small winners (<5x): ${small_winners.length}`);

if (big_winners.length > 0) {
  const avg_holder_big = big_winners.reduce((a, r) => a + (r.holder_concentration || 0), 0) / big_winners.length;
  console.log(`\nBig winners - avg holder concentration: ${avg_holder_big.toFixed(1)}%`);
  console.log(`Big winners - mint authority issues: ${big_winners.filter(r => r.mint_active).length}/${big_winners.length}`);
}

process.exit(0);
