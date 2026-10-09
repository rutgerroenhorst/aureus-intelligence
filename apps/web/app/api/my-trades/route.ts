import { NextResponse } from "next/server";
import { addTrade, exitTrade, listTrades } from "@/lib/my-trades";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// The trade journal (lib/my-trades.ts, table my_trades). It used to be a JavaScript Map: lost on every restart, with no
// record of which tab an entry came from and a "current" value that never moved for a coin that left the board.

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));

    if (body.action === "add-entry") {
      const r = await addTrade({ mint: body.mint, symbol: body.symbol, tab: body.tab, entryMcap: body.entryMcap, sizeUsd: body.sizeUsd });
      if (!r.trade) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json({ success: true, trade: r.trade }, { status: r.status });
    }

    if (body.action === "exit") {
      const trade = await exitTrade(body.id, body.exitMcap);
      if (!trade) return NextResponse.json({ error: "Unknown trade" }, { status: 404 });
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
    const { trades, stats } = await listTrades();
    return NextResponse.json({ myTrades: trades, stats }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Get trades error:", err);
    return NextResponse.json({
      myTrades: [],
      stats: { active: 0, exited: 0, winners: 0, avgProfit: 0, touched2x: 0, gaveBack: 0 },
      error: "journal unavailable",
    });
  }
}
