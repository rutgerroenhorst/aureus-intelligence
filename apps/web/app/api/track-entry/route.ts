import { NextResponse } from "next/server";

interface TrackedEntry {
  symbol: string;
  mint: string;
  detector: string;
  entryScore: number;
  entryMcap: number;
  detectedAt: string;
}

// Hardcoded seed data - start tracking from NOW
const trackedMints = new Set<string>();

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { symbol, mint, detector, entryScore, entryMcap } = body;

    if (!mint || !detector) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    // Track this mint
    trackedMints.add(mint);

    return NextResponse.json({
      success: true,
      tracked: mint,
      message: `Now tracking ${symbol}`,
    });
  } catch (err) {
    console.error("Track error:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  // Seed current board coins
  try {
    const boardRes = await fetch("http://localhost:3000/api/board", {
      cache: "no-store",
    });

    if (!boardRes.ok) {
      return NextResponse.json({ seeded: false });
    }

    const board = await boardRes.json();
    const sections = board.sections || {};
    let count = 0;

    Object.entries(sections).forEach(([_, coins]: any) => {
      if (Array.isArray(coins)) {
        coins.forEach((c: any) => {
          trackedMints.add(c.mint);
          count++;
        });
      }
    });

    return NextResponse.json({
      seeded: true,
      count,
      message: `Tracking ${count} coins from NOW onwards`,
    });
  } catch (err) {
    return NextResponse.json({ seeded: false, error: String(err) });
  }
}
