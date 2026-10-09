import { internalFetch } from "@/lib/internalFetch";
import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";

async function runAutonomousAnalysis() {
  const pool = getPool();
  const tasks = [];

  try {
    // Task 1: Whale analysis
    try {
      await internalFetch(`/api/elite-whale-tracking?action=analysis`);
      tasks.push({ task: "whale_analysis", status: "completed" });
    } catch (err) {
      tasks.push({ task: "whale_analysis", status: "failed" });
    }

    // Task 2: Risk scoring on recent coins
    try {
      const coins = await pool.query(
        `SELECT mint FROM coin_qualifications 
         WHERE analyzed_at IS NULL OR analyzed_at < now() - interval '1 hour'
         LIMIT 20`
      );
      
      for (const coin of coins.rows) {
        await internalFetch(`/api/elite-risk-analysis`, {
          method: "POST",
          body: JSON.stringify({ mint: coin.mint }),
        });
      }
      
      tasks.push({ task: "risk_scoring", status: "completed", coins_scored: coins.rows.length });
    } catch (err) {
      tasks.push({ task: "risk_scoring", status: "failed" });
    }

    // Task 3: Early warning detection
    try {
      const coins = await pool.query(
        `SELECT mint FROM coin_qualifications WHERE outcome_status = 'pending' LIMIT 30`
      );
      
      for (const coin of coins.rows) {
        await internalFetch(`/api/elite-early-warning`, {
          method: "POST",
          body: JSON.stringify({ mint: coin.mint }),
        });
      }
      
      tasks.push({ task: "early_warning", status: "completed", coins_checked: coins.rows.length });
    } catch (err) {
      tasks.push({ task: "early_warning", status: "failed" });
    }

    // Task 4: Signal consensus
    try {
      const coins = await pool.query(
        `SELECT DISTINCT mint FROM coin_qualifications LIMIT 50`
      );
      
      for (const coin of coins.rows) {
        await internalFetch(`/api/elite-signal-consensus`, {
          method: "POST",
          body: JSON.stringify({ mint: coin.mint }),
        });
      }
      
      tasks.push({ task: "signal_consensus", status: "completed", coins_analyzed: coins.rows.length });
    } catch (err) {
      tasks.push({ task: "signal_consensus", status: "failed" });
    }

    // Update job status
    await pool.query(
      `
      INSERT INTO autonomous_analysis_jobs (job_type, status, coins_analyzed, execution_time_seconds, last_run_at)
      VALUES ('elite_full_cycle', 'completed', $1, $2, now())
      `,
      [tasks.reduce((sum, t) => sum + (t.coins_scored || t.coins_checked || 0), 0), 60]
    );

    return {
      cycle_complete: true,
      timestamp: new Date().toISOString(),
      tasks_completed: tasks.length,
      tasks,
    };
  } catch (err) {
    console.error("[elite-autonomous] Error:", err);
    throw err;
  }
}

export async function POST(request: Request) {
  try {
    const result = await runAutonomousAnalysis();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || "status";

    if (action === "status") {
      const pool = getPool();
      const result = await pool.query(`
        SELECT 
          job_type, status, last_run_at, coins_analyzed, 
          alerts_generated, execution_time_seconds
        FROM autonomous_analysis_jobs
        ORDER BY last_run_at DESC
        LIMIT 10
      `);

      return NextResponse.json({
        status: "autonomous_monitoring_active",
        recent_jobs: result.rows,
      });
    }

    if (action === "run_now") {
      const result = await runAutonomousAnalysis();
      return NextResponse.json(result);
    }

    return NextResponse.json({
      status: "autonomous_system_active",
      usage: "?action=status or ?action=run_now",
      interval: "Runs every 60 seconds",
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
