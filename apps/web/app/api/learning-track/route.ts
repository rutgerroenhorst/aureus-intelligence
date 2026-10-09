import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

// POST: Track a coin as it qualifies for a tab
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      mint,
      symbol,
      tab_name, // 'quick_flip', 'stealth_moon', 'elite', 'early'
      age_minutes_at_qualification,
      score_at_qualification,
      buy_ratio_at_qualification,
      holder_top10_at_qualification,
      volume_velocity_at_qualification,
      price_velocity_at_qualification,
      mcap_usd_at_qualification,
      liquidity_usd_at_qualification,
      danger_score_at_qualification
    } = body;

    if (!mint || !tab_name) {
      return NextResponse.json(
        { error: "Missing required fields: mint, tab_name" },
        { status: 400 }
      );
    }

    const pool = getPool();
    const age_days = age_minutes_at_qualification / (60 * 24);

    const result = await pool.query(
      `
      INSERT INTO coin_qualifications (
        mint, symbol, tab_name, age_minutes_at_qualification, age_days_at_qualification,
        score_at_qualification, buy_ratio_at_qualification, holder_top10_at_qualification,
        volume_velocity_at_qualification, price_velocity_at_qualification,
        mcap_usd_at_qualification, liquidity_usd_at_qualification, danger_score_at_qualification,
        outcome_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending')
      ON CONFLICT (mint, tab_name, qualified_at) DO NOTHING
      RETURNING id, qualified_at
      `,
      [
        mint, symbol, tab_name, age_minutes_at_qualification, age_days,
        score_at_qualification, buy_ratio_at_qualification, holder_top10_at_qualification,
        volume_velocity_at_qualification, price_velocity_at_qualification,
        mcap_usd_at_qualification, liquidity_usd_at_qualification, danger_score_at_qualification
      ]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({
        message: "Duplicate tracking (coin already qualified for this tab)",
        tracked: false
      });
    }

    return NextResponse.json({
      tracked: true,
      qualification_id: result.rows[0].id,
      qualified_at: result.rows[0].qualified_at,
      message: `Tracking ${symbol}/${mint} for ${tab_name} tab`
    });
  } catch (err) {
    console.error("[learning-track] Error:", err);
    return NextResponse.json(
      { error: "Failed to track qualification", details: String(err) },
      { status: 500 }
    );
  }
}

// GET: List recent tracked qualifications
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tab = searchParams.get("tab");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);

    const pool = getPool();

    let query = `
      SELECT
        id, mint, symbol, tab_name, qualified_at, age_days_at_qualification,
        score_at_qualification, buy_ratio_at_qualification, holder_top10_at_qualification,
        outcome_status, return_multiplier, peak_return_multiplier, last_updated_at
      FROM coin_qualifications
    `;

    const params: any[] = [];
    if (tab) {
      query += ` WHERE tab_name = $${params.length + 1}`;
      params.push(tab);
    }

    query += ` ORDER BY qualified_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);

    return NextResponse.json({
      qualifications: result.rows,
      count: result.rows.length,
      tab: tab || "all"
    });
  } catch (err) {
    console.error("[learning-track GET] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch qualifications", details: String(err) },
      { status: 500 }
    );
  }
}
