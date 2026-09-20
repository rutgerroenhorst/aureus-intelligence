import { getPool } from '@aureus/db';

const pool = getPool();

const result = await pool.query(`
  SELECT 
    t.symbol_label,
    c.candidate_code,
    ROUND(COALESCE(pr_now.price_usd::numeric / pr_first.price_usd::numeric, 1), 2) as multiplier,
    c.current_state,
    cas.status as action_status,
    (oe.intel->'onChain'->>'holderTop10Pct')::float as holder_top10,
    (oe.intel->'onChain'->>'turnover')::float as turnover,
    (oe.datasets->'activity'->>'classification') as activity_type
  FROM candidates c
  JOIN tokens t ON t.id = c.token_id
  LEFT JOIN onchain_enrichment oe ON oe.candidate_id = c.id
  LEFT JOIN candidate_action_status cas ON cas.candidate_id = c.id
  LEFT JOIN LATERAL (
    SELECT price_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at ASC LIMIT 1
  ) pr_first ON true
  LEFT JOIN LATERAL (
    SELECT price_usd FROM prices WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1
  ) pr_now ON true
  WHERE t.symbol_label IN ('pill', 'LinkedInu', 'Tilcayo', 'MONARK', 'INUTILITY', 'Neko')
  ORDER BY COALESCE(pr_now.price_usd::numeric / pr_first.price_usd::numeric, 1) DESC
`);

console.log('\n=== MEGA WINNERS vs NORMAL QUALIFIED ===\n');
console.log('Coin | Multiplier | Status | Holder% | Turnover | Activity');
console.log('------|-----------|--------|---------|----------|----------');

result.rows.forEach(r => {
  const mult = parseFloat(r.multiplier).toFixed(2).padStart(8);
  const status = (r.action_status || '?').padEnd(8);
  const holder = (r.holder_top10 ? r.holder_top10.toFixed(2) : '?').padStart(7);
  const turn = (r.turnover ? r.turnover.toFixed(2) : '?').padStart(8);
  const activity = (r.activity_type || '?').padEnd(10);
  
  const icon = parseFloat(r.multiplier) >= 10 ? '🔥' : parseFloat(r.multiplier) >= 5 ? '✅' : '❌';
  console.log(`${icon} ${r.symbol_label.padEnd(10)} | ${mult}x | ${status} | ${holder}% | ${turn} | ${activity}`);
});

console.log('\n=== ANALYSIS ===');
const mega = result.rows.filter(r => parseFloat(r.multiplier) >= 10);
const good = result.rows.filter(r => parseFloat(r.multiplier) >= 5 && parseFloat(r.multiplier) < 10);

console.log(`\nMega (10x+): ${mega.length} coins - pill, LinkedInu, Tilcayo`);
console.log(`Good (5-10x): ${good.length} coins - MONARK, INUTILITY, Neko`);

console.log('\n🎯 THE REAL PROBLEM:');
console.log('1. We ARE catching some big winners');
console.log('2. But we\'re also catching/qualifying LOSING coins (Neko 1.9x)');
console.log('3. This suggests our qualification is too broad');
console.log('4. We need STRICTER criteria for HIGHER confidence winners');

process.exit(0);
