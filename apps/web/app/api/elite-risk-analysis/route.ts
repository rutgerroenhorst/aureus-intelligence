import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";

async function calculateRiskScore(mint: string) {
  const pool = getPool();

  try {
    // Get contract forensics
    const contract = await pool.query(
      `SELECT * FROM contract_forensics WHERE mint = $1`,
      [mint]
    );
    
    const contractData = contract.rows[0];
    const securityRisk = contractData?.security_risk_score || 50;
    const developerRisk = contractData?.developer_risk_score || 50;

    // Get coin qualification data
    const qualification = await pool.query(
      `SELECT * FROM coin_qualifications WHERE mint = $1 ORDER BY qualified_at DESC LIMIT 1`,
      [mint]
    );

    const coinData = qualification.rows[0];
    
    // Calculate market risk (volatility + liquidity)
    const marketRisk = coinData ? Math.min(100, Math.max(0, (coinData.danger_score_at_qualification || 0))) : 50;
    
    // Calculate fundamental risk
    const fundamentalRisk = Math.min(100, (developerRisk + (coinData?.danger_score_at_qualification || 50)) / 2);
    
    // Social risk (from early_warning_signals if available)
    const socialRisk = 40; // Default moderate risk
    
    // Timing risk (chart position)
    const timingRisk = 35;

    // Overall score
    const overallScore = (securityRisk * 0.25 + marketRisk * 0.25 + fundamentalRisk * 0.25 + socialRisk * 0.15 + timingRisk * 0.1);
    
    let riskRating = "safe";
    if (overallScore > 70) riskRating = "extreme";
    else if (overallScore > 50) riskRating = "high";
    else if (overallScore > 30) riskRating = "moderate";

    const tradeable = overallScore < 50;
    const maxPositionSize = Math.max(1, Math.round(100 - overallScore) / 10);

    return {
      mint,
      overall_risk_score: Math.round(overallScore),
      risk_rating: riskRating,
      tradeable,
      max_position_size_percent: maxPositionSize,
      breakdown: {
        security_risk: securityRisk,
        market_risk: marketRisk,
        fundamental_risk: Math.round(fundamentalRisk),
        social_risk: socialRisk,
        timing_risk: timingRisk,
      },
    };
  } catch (err) {
    console.error("[elite-risk-analysis] Error:", err);
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

    const riskAnalysis = await calculateRiskScore(mint);
    
    const pool = getPool();
    await pool.query(
      `
      INSERT INTO coin_risk_analysis (
        mint, security_risk, market_risk, fundamental_risk, social_risk, timing_risk,
        overall_risk_score, risk_rating, tradeable, max_position_size_percent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (mint) DO UPDATE SET last_updated_at = now()
      `,
      [
        mint,
        riskAnalysis.breakdown.security_risk,
        riskAnalysis.breakdown.market_risk,
        riskAnalysis.breakdown.fundamental_risk,
        riskAnalysis.breakdown.social_risk,
        riskAnalysis.breakdown.timing_risk,
        riskAnalysis.overall_risk_score,
        riskAnalysis.risk_rating,
        riskAnalysis.tradeable,
        riskAnalysis.max_position_size_percent,
      ]
    );

    return NextResponse.json({ analysis: riskAnalysis });
  } catch (err) {
    return NextResponse.json(
      { error: "Risk analysis failed", details: String(err) },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mint = searchParams.get("mint");
    const action = searchParams.get("action") || "score";

    if (action === "score" && mint) {
      const risk = await calculateRiskScore(mint);
      return NextResponse.json({ risk });
    }

    if (action === "tradeable") {
      const pool = getPool();
      const result = await pool.query(`
        SELECT mint, overall_risk_score, risk_rating, max_position_size_percent
        FROM coin_risk_analysis
        WHERE tradeable = true
        ORDER BY overall_risk_score ASC
        LIMIT 50
      `);
      return NextResponse.json({ tradeable_coins: result.rows });
    }

    return NextResponse.json({
      status: "risk_analysis_active",
      usage: "?mint=... or ?action=tradeable",
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
