import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";

async function analyzeWhaleActivity() {
  const pool = getPool();

  try {
    const whales = await pool.query(`
      SELECT 
        DISTINCT wallet_address
      FROM whale_wallets
      WHERE is_active = true
      ORDER BY win_rate DESC
      LIMIT 50
    `);

    const analysis: any[] = [];

    for (const whale of whales.rows) {
      try {
        const positions = await pool.query(
          `
          SELECT 
            wp.mint, wp.symbol, wp.entry_price_usd, wp.entry_time,
            wp.current_price_usd, wp.outcome, wp.roi_multiple
          FROM whale_positions wp
          WHERE wp.whale_wallet_id = (
            SELECT id FROM whale_wallets WHERE wallet_address = $1
          )
          ORDER BY wp.entry_time DESC
          LIMIT 20
          `,
          [whale.wallet_address]
        );

        const open_positions = positions.rows.filter((p: any) => p.outcome === 'open');
        const closed_positions = positions.rows.filter((p: any) => p.outcome !== 'open');
        
        const avg_roi = closed_positions.length > 0
          ? closed_positions.reduce((sum: number, p: any) => sum + (parseFloat(p.roi_multiple) || 0), 0) / closed_positions.length
          : 0;

        if (positions.rows.length > 0) {
          await pool.query(
            `
            UPDATE whale_wallets
            SET 
              last_updated_at = now(),
              current_holding_count = $2,
              average_roi = $3
            WHERE wallet_address = $1
            `,
            [whale.wallet_address, open_positions.length, avg_roi]
          );
        }

        analysis.push({
          wallet: whale.wallet_address.slice(0, 8) + "...",
          open_positions: open_positions.length,
          closed_positions: closed_positions.length,
          avg_roi: avg_roi.toFixed(2),
        });
      } catch (err) {
        console.error(`Failed to analyze whale:`, err);
      }
    }

    return {
      whales_analyzed: analysis.length,
      analysis: analysis.slice(0, 10),
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[elite-whale-tracking] Error:", err);
    throw err;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { wallet_address, label } = body;

    if (!wallet_address) {
      return NextResponse.json({ error: "Missing wallet_address" }, { status: 400 });
    }

    const pool = getPool();

    const result = await pool.query(
      `
      INSERT INTO whale_wallets (wallet_address, label, is_active)
      VALUES ($1, $2, true)
      ON CONFLICT (wallet_address) 
        DO UPDATE SET 
          label = COALESCE($2, label),
          last_updated_at = now()
      RETURNING id, wallet_address, label, win_rate, average_roi
      `,
      [wallet_address, label || null]
    );

    return NextResponse.json({
      tracked: true,
      whale: result.rows[0],
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to track whale", details: String(err) },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || "analysis";

    if (action === "analysis") {
      const result = await analyzeWhaleActivity();
      return NextResponse.json(result);
    }

    if (action === "top_whales") {
      const pool = getPool();
      const result = await pool.query(`
        SELECT 
          wallet_address,
          label,
          win_rate,
          average_roi,
          current_holding_count,
          last_buy_coin,
          last_buy_at
        FROM whale_wallets
        WHERE is_active = true
        ORDER BY win_rate DESC
        LIMIT 20
      `);

      return NextResponse.json({
        top_whales: result.rows,
        count: result.rows.length,
      });
    }

    if (action === "status") {
      const pool = getPool();
      const stats = await pool.query(`
        SELECT 
          COUNT(*) as total_whales,
          AVG(win_rate) as avg_win_rate,
          AVG(average_roi) as avg_roi,
          SUM(current_holding_count) as total_open_positions
        FROM whale_wallets
        WHERE is_active = true
      `);

      return NextResponse.json({
        status: "whale_tracking_active",
        stats: stats.rows[0],
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to get whale data", details: String(err) },
      { status: 500 }
    );
  }
}
