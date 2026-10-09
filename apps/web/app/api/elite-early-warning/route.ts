import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";

async function detectPrepump(mint: string) {
  const pool = getPool();

  try {
    // Get latest coin data
    const coin = await pool.query(
      `SELECT * FROM coin_qualifications WHERE mint = $1 ORDER BY qualified_at DESC LIMIT 1`,
      [mint]
    );

    if (!coin.rows[0]) return { mint, signal: "no_data" };

    const coinData = coin.rows[0];
    let pumpProbability2h = 25;
    let pumpProbability24h = 35;
    const signals: string[] = [];

    // Check for early warning signs
    if (coinData.buy_ratio_at_qualification > 0.65) {
      pumpProbability2h += 15;
      pumpProbability24h += 20;
      signals.push("whale_accumulation");
    }

    if (coinData.holder_top10_at_qualification < 3) {
      pumpProbability2h += 10;
      signals.push("distributed_holders");
    }

    if (coinData.danger_score_at_qualification < 25) {
      pumpProbability2h += 15;
      pumpProbability24h += 20;
      signals.push("low_risk_structure");
    }

    if (coinData.volume_velocity_at_qualification > 1.5) {
      pumpProbability2h += 10;
      signals.push("volume_momentum");
    }

    return {
      mint,
      signal_type: "pre_pump_detection",
      pump_probability_2h: Math.min(100, pumpProbability2h),
      pump_probability_24h: Math.min(100, pumpProbability24h),
      signals_detected: signals,
      confidence: Math.min(100, 50 + signals.length * 10),
      estimated_time_to_event_hours: 2,
    };
  } catch (err) {
    console.error("[elite-early-warning] Error:", err);
    throw err;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { mint } = body;

    if (!mint) {
      return NextResponse.json({ error: "Missing mint" }, { status: 400 });
    }

    const warning = await detectPrepump(mint);
    
    const pool = getPool();
    if (warning.pump_probability_2h > 50) {
      await pool.query(
        `
        INSERT INTO early_warning_signals (
          mint, signal_type, confidence,
          pump_probability_2h, pump_probability_24h,
          estimated_time_to_event_hours, signal_details, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, true)
        `,
        [
          mint,
          "pre_pump_detection",
          warning.confidence,
          warning.pump_probability_2h,
          warning.pump_probability_24h,
          warning.estimated_time_to_event_hours,
          JSON.stringify(warning),
        ]
      );
    }

    return NextResponse.json({ warning });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mint = searchParams.get("mint");
    const action = searchParams.get("action") || "detect";

    if (action === "detect" && mint) {
      const warning = await detectPrepump(mint);
      return NextResponse.json({ warning });
    }

    if (action === "active") {
      const pool = getPool();
      const result = await pool.query(`
        SELECT 
          mint, symbol, pump_probability_2h, pump_probability_24h,
          signal_details, detected_at
        FROM early_warning_signals
        WHERE is_active = true
        ORDER BY pump_probability_2h DESC
        LIMIT 20
      `);

      return NextResponse.json({
        active_warnings: result.rows,
        count: result.rows.length,
      });
    }

    return NextResponse.json({
      status: "early_warning_active",
      usage: "?mint=... or ?action=active",
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
