import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";

async function analyzeCurve(mint: string) {
  const pool = getPool();

  try {
    // Get last 20 data points
    const timeseries = await pool.query(
      `
      SELECT * FROM metric_timeseries
      WHERE mint = $1
      ORDER BY measured_at DESC
      LIMIT 20
      `,
      [mint]
    );

    if (timeseries.rows.length < 2) {
      return { mint, status: "insufficient_data" };
    }

    const points = timeseries.rows.reverse();
    
    // Calculate velocity and acceleration
    const priceVelocity = points[points.length - 1].price_usd / Math.max(points[0].price_usd, 0.0001);
    const buyRatioTrend = points[points.length - 1].buy_ratio - points[0].buy_ratio;
    const holderGrowth = points[points.length - 1].holder_count - points[0].holder_count;

    // Determine curve position
    let curvePosition = "unknown";
    if (buyRatioTrend > 0.05 && holderGrowth > 0) {
      curvePosition = "early_accumulation";
    } else if (buyRatioTrend > 0.02 && holderGrowth > 50) {
      curvePosition = "late_accumulation";
    } else if (priceVelocity > 1.5 && buyRatioTrend > 0) {
      curvePosition = "breakout_imminent";
    } else if (priceVelocity > 2.0) {
      curvePosition = "pumping";
    } else if (priceVelocity < 0.8) {
      curvePosition = "dump_phase";
    }

    return {
      mint,
      curve_position: curvePosition,
      price_trend: priceVelocity.toFixed(2),
      buy_ratio_trend: buyRatioTrend.toFixed(3),
      holder_growth: holderGrowth,
      recommendation:
        curvePosition === "early_accumulation" ? "STRONG_BUY" :
        curvePosition === "late_accumulation" ? "BUY" :
        curvePosition === "breakout_imminent" ? "STRONG_BUY" :
        curvePosition === "pumping" ? "TAKE_PROFIT" :
        "HOLD",
    };
  } catch (err) {
    console.error("[elite-temporal-curve] Error:", err);
    throw err;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { mint, metrics } = body;

    if (!mint || !metrics) {
      return NextResponse.json({ error: "Missing mint or metrics" }, { status: 400 });
    }

    const pool = getPool();
    
    // Insert timeseries point
    await pool.query(
      `
      INSERT INTO metric_timeseries (
        mint, measured_at, price_usd, buy_ratio, holder_count,
        holder_top10_pct, volume_velocity, price_velocity,
        mcap_usd, liquidity_usd
      ) VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        mint,
        metrics.price_usd,
        metrics.buy_ratio,
        metrics.holder_count,
        metrics.holder_top10_pct,
        metrics.volume_velocity,
        metrics.price_velocity,
        metrics.mcap_usd,
        metrics.liquidity_usd,
      ]
    );

    const curve = await analyzeCurve(mint);
    return NextResponse.json({ recorded: true, curve });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mint = searchParams.get("mint");

    if (!mint) {
      return NextResponse.json({ error: "Missing mint parameter" }, { status: 400 });
    }

    const curve = await analyzeCurve(mint);
    return NextResponse.json({ analysis: curve });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
