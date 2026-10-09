import { getPool } from '@aureus/db';

async function main() {
  const pool = getPool();

  const result = await pool.query(`
    SELECT COUNT(*) as count, v2_tier, v2_status
    FROM intelligence_v2_scores
    GROUP BY v2_tier, v2_status
    ORDER BY COUNT(*) DESC
    LIMIT 10
  `);

  console.log('Qualification Status:');
  console.table(result.rows);

  const totalResult = await pool.query('SELECT COUNT(*) as total FROM intelligence_v2_scores');
  console.log(`\nTotal coins in database: ${totalResult.rows[0].total}`);

  const recentResult = await pool.query(`
    SELECT symbol, v2_tier, v2_status, computed_at
    FROM intelligence_v2_scores
    ORDER BY computed_at DESC
    LIMIT 5
  `);

  console.log('\nMost Recent Coins:');
  console.table(recentResult.rows);

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
