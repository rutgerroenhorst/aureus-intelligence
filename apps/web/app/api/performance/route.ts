import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
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

export async function GET() {
  try {
    const positions = loadPositions();

    const metrics = {
      total_positions: positions.length,
      open_positions: positions.filter((p) => p.status === "OPEN").length,
      closed_positions: positions.filter((p) => p.status === "CLOSED").length,
      total_invested: positions.reduce((sum, p) => sum + p.amount_sol, 0),
      current_exposure: positions
        .filter((p) => p.status === "OPEN")
        .reduce((sum, p) => sum + p.amount_sol, 0),
      total_pnl: 0,
      realized_pnl: 0,
      unrealized_pnl: 0,
      win_rate: 0,
      profit_factor: 0,
      largest_winner: null as any,
      largest_loser: null as any,
    };

    const openPositions = positions.filter((p) => p.status === "OPEN");
    const closedPositions = positions.filter((p) => p.status === "CLOSED");

    // Calculate P&L for closed positions
    let wins = 0;
    let losses = 0;
    let totalWinPnl = 0;
    let totalLossPnl = 0;

    closedPositions.forEach((p) => {
      const pnl = p.pnl || 0;
      metrics.realized_pnl += pnl;

      if (pnl > 0) {
        wins++;
        totalWinPnl += pnl;
        if (!metrics.largest_winner || pnl > metrics.largest_winner.pnl) {
          metrics.largest_winner = {
            symbol: p.symbol,
            pnl,
            return_pct: ((pnl / p.amount_sol) * 100).toFixed(2),
          };
        }
      } else if (pnl < 0) {
        losses++;
        totalLossPnl += Math.abs(pnl);
        if (!metrics.largest_loser || pnl < metrics.largest_loser.pnl) {
          metrics.largest_loser = {
            symbol: p.symbol,
            pnl,
            return_pct: ((pnl / p.amount_sol) * 100).toFixed(2),
          };
        }
      }
    });

    if (closedPositions.length > 0) {
      metrics.win_rate = (wins / closedPositions.length) * 100;
    }

    if (totalLossPnl > 0) {
      metrics.profit_factor = totalWinPnl / totalLossPnl;
    }

    // Calculate unrealized P&L (would need current prices from API)
    // For now, assume 0 until price data is available
    metrics.unrealized_pnl = 0;

    metrics.total_pnl = metrics.realized_pnl + metrics.unrealized_pnl;

    return NextResponse.json({
      metrics: {
        ...metrics,
        win_rate: parseFloat(metrics.win_rate.toFixed(1)),
        profit_factor: parseFloat(metrics.profit_factor.toFixed(2)),
        realized_pnl: parseFloat(metrics.realized_pnl.toFixed(2)),
        unrealized_pnl: parseFloat(metrics.unrealized_pnl.toFixed(2)),
        total_pnl: parseFloat(metrics.total_pnl.toFixed(2)),
      },
      open_positions: openPositions.map((p) => ({
        id: p.id,
        symbol: p.symbol,
        entry_price: p.entry_price,
        amount_sol: p.amount_sol,
        status: "OPEN",
        days_held: Math.floor(
          (Date.now() - new Date(p.entry_time).getTime()) / (1000 * 60 * 60 * 24)
        ),
      })),
      closed_positions: closedPositions.map((p) => ({
        id: p.id,
        symbol: p.symbol,
        entry_price: p.entry_price,
        exit_price: p.current_price,
        pnl: p.pnl,
        return_pct: p.amount_sol ? ((p.pnl || 0) / p.amount_sol) * 100 : 0,
        days_held: Math.floor(
          (new Date(p.exit_time || new Date()).getTime() -
            new Date(p.entry_time).getTime()) /
            (1000 * 60 * 60 * 24)
        ),
      })),
    });
  } catch (err) {
    console.error("Performance error:", err);
    return NextResponse.json(
      {
        metrics: {
          total_positions: 0,
          open_positions: 0,
          closed_positions: 0,
          total_invested: 0,
          current_exposure: 0,
          total_pnl: 0,
          realized_pnl: 0,
          unrealized_pnl: 0,
          win_rate: 0,
          profit_factor: 0,
          largest_winner: null,
          largest_loser: null,
        },
        open_positions: [],
        closed_positions: [],
      },
      { status: 200 }
    );
  }
}
