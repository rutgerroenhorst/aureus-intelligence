import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";

// Update outcomes for pending coins by checking DexScreener or price data
export async function POST(request: Request) {
  try {
    const pool = getPool();

    // Get all pending coins
    const pendingResult = await pool.query(`
      SELECT
        id, mint, symbol, tab_name, qualified_at, age_days_at_qualification,
        mcap_usd_at_qualification
      FROM coin_qualifications
      WHERE outcome_status = 'pending'
      AND qualified_at > now() - interval '60 days'
      ORDER BY qualified_at DESC
      LIMIT 500
    `);

    let updatedCount = 0;
    const updates = [];

    // For each pending coin, try to fetch current price from DexScreener
    for (const coin of pendingResult.rows) {
      try {
        const dexResponse = await fetch(
          `https://api.dexscreener.com/latest/dex/tokens/${coin.mint}`,
          { headers: { "User-Agent": "Aureus-Learning-System" } }
        );

        if (!dexResponse.ok) continue;

        const dexData = await dexResponse.json();
        const pair = dexData.pairs?.[0];

        if (!pair) {
          // Coin dead/delisted
          await pool.query(
            `UPDATE coin_qualifications
             SET outcome_status = 'dead', last_updated_at = now()
             WHERE id = $1`,
            [coin.id]
          );
          updatedCount++;
          updates.push({
            mint: coin.mint,
            action: 'marked_dead'
          });
          continue;
        }

        const currentMcap = parseFloat(pair.marketCap) || 0;
        const currentPrice = parseFloat(pair.priceUsd) || 0;

        if (currentMcap === 0 || currentPrice === 0) {
          await pool.query(
            `UPDATE coin_qualifications
             SET outcome_status = 'dead', last_updated_at = now()
             WHERE id = $1`,
            [coin.id]
          );
          updatedCount++;
          updates.push({ mint: coin.mint, action: 'marked_dead' });
          continue;
        }

        const returnMultiplier = currentMcap / coin.mcap_usd_at_qualification;

        // Determine outcome
        let outcomeStatus = 'loser';
        if (returnMultiplier >= 5) outcomeStatus = 'winner'; // 5x+ = winner
        else if (returnMultiplier >= 2) outcomeStatus = 'winner'; // 2x+ = winner
        else if (returnMultiplier < 0.5) outcomeStatus = 'rugpull';
        else if (returnMultiplier < 0.8) outcomeStatus = 'loser';

        // Check if it's a dead coin (no volume)
        const volume24h = parseFloat(pair.volume?.h24) || 0;
        if (volume24h === 0) outcomeStatus = 'dead';

        // Update coin record
        await pool.query(
          `UPDATE coin_qualifications
           SET
             current_price_usd = $1,
             peak_price_usd = GREATEST(peak_price_usd, $1),
             peak_mcap_usd = GREATEST(peak_mcap_usd, $2),
             outcome_status = $3,
             return_multiplier = $4,
             last_updated_at = now()
           WHERE id = $5`,
          [currentPrice, currentMcap, outcomeStatus, returnMultiplier, coin.id]
        );

        updatedCount++;
        updates.push({
          mint: coin.mint,
          symbol: coin.symbol,
          return: `${(returnMultiplier * 100).toFixed(1)}%`,
          outcome: outcomeStatus
        });

      } catch (coinErr) {
        console.error(`[learning-update] Error processing ${coin.mint}:`, coinErr);
      }
    }

    return NextResponse.json({
      updated_count: updatedCount,
      total_pending: pendingResult.rows.length,
      updates: updates.slice(0, 20), // Return first 20 for display
      note: "Run this endpoint periodically (e.g., every 5 minutes) to update pending coin outcomes"
    });
  } catch (err) {
    console.error("[learning-update-outcomes] Error:", err);
    return NextResponse.json(
      { error: "Failed to update outcomes", details: String(err) },
      { status: 500 }
    );
  }
}
