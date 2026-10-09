import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const POSITIONS_FILE = join(process.cwd(), ".positions.json");

interface Position {
  id: string;
  symbol: string;
  mint: string;
  entry_price: number;
  amount_sol: number;
  tokens_bought: number;
  current_price?: number;
  entry_time: string;
  status: "OPEN" | "CLOSED";
  exit_time?: string;
  pnl?: number;
}

function loadPositions(): Position[] {
  if (!existsSync(POSITIONS_FILE)) {
    return [];
  }
  try {
    const data = readFileSync(POSITIONS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function savePositions(positions: Position[]) {
  writeFileSync(POSITIONS_FILE, JSON.stringify(positions, null, 2));
}

export async function GET() {
  try {
    const positions = loadPositions();
    const openPositions = positions.filter((p) => p.status === "OPEN");
    const closedPositions = positions.filter((p) => p.status === "CLOSED");

    const totalPnl = closedPositions.reduce((sum, p) => sum + (p.pnl || 0), 0);
    const winCount = closedPositions.filter((p) => (p.pnl || 0) > 0).length;
    const totalClosed = closedPositions.length;
    const winRate =
      totalClosed > 0 ? ((winCount / totalClosed) * 100).toFixed(1) : "0";

    return NextResponse.json({
      positions: openPositions,
      closed_positions: closedPositions,
      stats: {
        total_pnl: parseFloat(totalPnl.toFixed(2)),
        win_rate: parseFloat(winRate as string),
        open_count: openPositions.length,
        closed_count: closedPositions.length,
      },
    });
  } catch (err) {
    console.error("Positions error:", err);
    return NextResponse.json({ positions: [], stats: {} }, { status: 200 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const positions = loadPositions();

    const newPosition: Position = {
      id: `pos_${Date.now()}`,
      symbol: body.symbol,
      mint: body.mint,
      entry_price: body.entry_price,
      amount_sol: body.amount_sol,
      tokens_bought: body.tokens_bought,
      entry_time: new Date().toISOString(),
      status: "OPEN",
    };

    positions.push(newPosition);
    savePositions(positions);

    return NextResponse.json({ position: newPosition, success: true });
  } catch (err) {
    console.error("Position POST error:", err);
    return NextResponse.json(
      { error: "Failed to create position", success: false },
      { status: 400 }
    );
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const positions = loadPositions();

    const position = positions.find((p) => p.id === body.position_id);
    if (!position) {
      return NextResponse.json(
        { error: "Position not found" },
        { status: 404 }
      );
    }

    if (body.current_price) {
      position.current_price = body.current_price;
      const roi =
        ((body.current_price - position.entry_price) / position.entry_price) *
        100;
      position.pnl = parseFloat((roi * position.amount_sol).toFixed(2));
    }

    if (body.exit) {
      position.status = "CLOSED";
      position.exit_time = new Date().toISOString();
    }

    savePositions(positions);

    return NextResponse.json({ position, success: true });
  } catch (err) {
    console.error("Position PUT error:", err);
    return NextResponse.json(
      { error: "Failed to update position", success: false },
      { status: 400 }
    );
  }
}
