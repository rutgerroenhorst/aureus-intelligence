import { getPool } from '@aureus/db';

const pool = getPool();

// Get ALL coins + their winners status to find the pattern
const result = await pool.query(`
  SELECT 
    t.symbol_label,
    c.candidate_code,
    c.discovered_at,
    c.current_state,
    ROUND(COALESCE(pr_now.price_usd::numeric / pr_first.price_usd::numeric, 1), 2)::float as multiplier,
    -- On-chain at discovery
    (oe.intel->'onChain'->>'holderTop10Pct')::float as holder_top10,
    (oe.intel->'flags'->>'mintAuthorityActive')::boolean as mint_auth,
    (oe.intel->'flags'->>'freezeAuthorityActive')::boolean as freeze_auth,
    -- Pool metrics
    (SELECT COUNT(*) FROM prices WHERE pool_id = c.pool_id AND observed_at <= c.discovered_at + interval '1 hour') as early_prices
  FROM candidates c
  JOIN tokens t ON t.id = c.token_id
  LEFT JOIN onchain_enrichment oe ON oe.candidate_id = c.id
  LEFT JOIN LATERAL (
    SELECT price_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at ASC LIMIT 1
  ) pr_first ON true
  LEFT JOIN LATERAL (
    SELECT price_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1
  ) pr_now ON true
  WHERE pr_first.price_usd IS NOT NULL AND pr_now.price_usd IS NOT NULL
    AND c.discovered_at > now() - interval '90 days'
  ORDER BY multiplier DESC
  LIMIT 40
`);

// Categorize
const mega = result.rows.filter(r => r.multiplier >= 10);
const big = result.rows.filter(r => r.multiplier >= 5 && r.multiplier < 10);
const small = result.rows.filter(r => r.multiplier >= 1 && r.multiplier < 5);
const losers = result.rows.filter(r => r.multiplier < 1);

const analyze = (category, coins) => {
  if (coins.length === 0) return;
  
  const avg_holder = coins.reduce((a,c) => a + (c.holder_top10 || 0), 0) / coins.length;
  const clean_auth = coins.filter(c => !c.mint_auth && !c.freeze_auth).length;
  const avg_mult = coins.reduce((a,c) => a + c.multiplier, 0) / coins.length;
  
  console.log(`\n${category.toUpperCase()}`);
  console.log(`Count: ${coins.length} | Avg return: ${avg_mult.toFixed(2)}x | Avg holder: ${avg_holder.toFixed(2)}% | Clean auth: ${clean_auth}/${coins.length}`);
  coins.slice(0, 5).forEach(c => {
    console.log(`  ${c.symbol_label.padEnd(12)} ${c.multiplier.toFixed(2)}x - holder: ${(c.holder_top10||0).toFixed(2)}%`);
  });
};

analyze('MEGA (10x+)', mega);
analyze('BIG (5-10x)', big);
analyze('SMALL (1-5x)', small);
analyze('LOSERS (<1x)', losers);

console.log('\n\n=== KEY PATTERN ===');
console.log('Mega winners holder concentration: ' + (mega.reduce((a,c) => a + (c.holder_top10||0), 0) / mega.length).toFixed(2) + '%');
console.log('Losers holder concentration: ' + (losers.reduce((a,c) => a + (c.holder_top10||0), 0) / losers.length).toFixed(2) + '%');
console.log('\nMega winners - clean authorities: ' + mega.filter(c => !c.mint_auth && !c.freeze_auth).length + '/' + mega.length);
console.log('Losers - clean authorities: ' + losers.filter(c => !c.mint_auth && !c.freeze_auth).length + '/' + losers.length);

process.exit(0);
