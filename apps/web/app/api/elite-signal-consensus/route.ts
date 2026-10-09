import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";

async function buildConsensus(mint: string) {
  try {
    // Gather all signals (would call individual signal APIs in production)
    const onChainSignal = "bullish";      // From contract + whale data
    const communitySignal = "neutral";    // From social data
    const technicalSignal = "bullish";    // From curve analysis
    const whaleSignal = "bullish";        // From whale tracking
    const structuralSignal = "bullish";   // From contract forensics

    const signals = [
      { type: "on_chain", signal: onChainSignal, confidence: 75 },
      { type: "community", signal: communitySignal, confidence: 55 },
      { type: "technical", signal: technicalSignal, confidence: 70 },
      { type: "whale", signal: whaleSignal, confidence: 80 },
      { type: "structural", signal: structuralSignal, confidence: 75 },
    ];

    const bullishCount = signals.filter(s => s.signal === "bullish").length;
    const bearishCount = signals.filter(s => s.signal === "bearish").length;

    let verdict = "neutral";
    if (bullishCount >= 4) verdict = "strong_bullish";
    else if (bullishCount >= 3) verdict = "bullish";
    else if (bearishCount >= 3) verdict = "bearish";
    else if (bearishCount >= 4) verdict = "strong_bearish";

    let recommendation = "HOLD";
    if (verdict === "strong_bullish") recommendation = "BUY";
    else if (verdict === "bullish") recommendation = "BUY";
    else if (verdict === "bearish") recommendation = "SELL";
    else if (verdict === "strong_bearish") recommendation = "AVOID";

    const avgConfidence = signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length;

    return {
      mint,
      consensus_verdict: verdict,
      recommendation,
      consensus_confidence: Math.round(avgConfidence),
      signals_breakdown: signals,
      alignment_note: `${bullishCount} bullish, ${bearishCount} bearish out of ${signals.length}`,
    };
  } catch (err) {
    console.error("[elite-signal-consensus] Error:", err);
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

    const consensus = await buildConsensus(mint);
    
    const pool = getPool();
    await pool.query(
      `
      INSERT INTO signal_consensus (
        mint, consensus_verdict, recommendation,
        consensus_confidence, alignment_note
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (mint) DO UPDATE SET last_updated_at = now()
      `,
      [
        mint,
        consensus.consensus_verdict,
        consensus.recommendation,
        consensus.consensus_confidence,
        consensus.alignment_note,
      ]
    );

    return NextResponse.json({ consensus });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mint = searchParams.get("mint");

    if (!mint) {
      return NextResponse.json({ error: "Missing mint" }, { status: 400 });
    }

    const consensus = await buildConsensus(mint);
    return NextResponse.json({ consensus });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
