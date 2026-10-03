import { NextResponse } from "next/server";

interface MyTrade {
  id: string;
  symbol: string;
  mint: string;
  enteredAt: string;
  entryMcap: number;
  currentMcap: number;
  multiplier: number;
  status: "active" | "exited";
  exitMcap?: number;
  exitedAt?: string;
}

// In-memory store (production: use database)
const myTrades: Map<string, MyTrade> = new Map();

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { symbol, mint, entryMcap, action } = body;

    if (!mint) {
      return NextResponse.json({ error: "Missing mint" }, { status: 400 });
    }

    if (action === "add-entry") {
      const id = `${mint}-${Date.now()}`;
      const trade: MyTrade = {
        id,
        symbol: symbol || "?",
        mint,
        enteredAt: new Date().toISOString(),
        entryMcap: entryMcap || 50000,
        currentMcap: entryMcap || 50000,
        multiplier: 1.0,
        status: "active",
      };

      myTrades.set(id, trade);
      return NextResponse.json({ success: true, trade });
    }

    if (action === "exit") {
      const { id, exitMcap } = body;
      const trade = myTrades.get(id);
      if (trade) {
        trade.status = "exited";
        trade.exitMcap = exitMcap;
        trade.exitedAt = new Date().toISOString();
        trade.multiplier = exitMcap / trade.entryMcap;
      }
      return NextResponse.json({ success: true, trade });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("My trades error:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function GET() {
  try {
    // Get all coins from board to calculate current mcaps
    const boardRes = await fetch("http://localhost:3000/api/board", {
      cache: "no-store",
    });

    let boardMints: Map<string, number> = new Map();
    if (boardRes.ok) {
      const board = await boardRes.json();
      const sections = board.sections || {};
      Object.entries(sections).forEach(([_, coins]: any) => {
        if (Array.isArray(coins)) {
          coins.forEach((c: any) => {
            boardMints.set(c.mint, c.marketCapUsd || 50000);
          });
        }
      });
    }

    // Update current mcaps for active trades
    const trades = Array.from(myTrades.values()).map((trade) => {
      if (trade.status === "active") {
        const currentMcap = boardMints.get(trade.mint) || trade.entryMcap;
        trade.currentMcap = currentMcap;
        trade.multiplier = currentMcap / trade.entryMcap;
      }
      return trade;
    });

    const active = trades.filter((t) => t.status === "active");
    const exited = trades.filter((t) => t.status === "exited");
    const winners = exited.filter((t) => t.multiplier >= 2);
    const avgProfit =
      exited.length > 0
        ? Math.round(
            (exited.reduce((s, t) => s + t.multiplier, 0) / exited.length) * 100
          ) / 100
        : 0;

    return NextResponse.json(
      {
        myTrades: trades,
        stats: {
          active: active.length,
          exited: exited.length,
          winners: winners.length,
          avgProfit,
        },
      },
      { headers: { "Cache-Control": "no-store, max-age=10" } }
    );
  } catch (err) {
    console.error("Get trades error:", err);
    return NextResponse.json({
      myTrades: [],
      stats: { active: 0, exited: 0, winners: 0, avgProfit: 0 },
    });
  }
}
