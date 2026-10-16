import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";
import { CPU_BUDGET_S_PER_DAY, egressBudgetMb, STORAGE_LIMIT_MB, usedEgressMb } from "@/lib/cloudScan";
import { EGRESS_USE_MB, EGRESS_WINDOW_DAYS, rollingUse } from "@/lib/egressBudget";

export const dynamic = "force-dynamic";

/** What the free plans allow. Supabase Free: 500 MB database, 5 GB egress a month. Vercel Hobby: 4 CPU-hours a month (it blocks the project for 30 days beyond that). */
const PLAN = { dbMb: 500, egressGbMonth: 5, cpuHoursMonth: 4 };

/**
 * How much of the free plans this site has used: the database size, and per day what the database sent to the site's functions (the meter in
 * @aureus/db) and the CPU of its own scans (cloudScan.ts). Counts and sizes only. The pages' own requests add a little CPU on top of the scans,
 * which is why the daily CPU budget is well under a third of the month's allowance.
 */
export async function GET() {
  try {
    const db = getPool();
    const [{ rows }, size, budgetMb, usedTodayMb] = await Promise.all([
      db.query(`SELECT name, last_result FROM scan_lease WHERE name LIKE 'usage:%' ORDER BY name DESC LIMIT 120`),
      db.query(`SELECT pg_database_size(current_database())::float / 1048576 AS mb`),
      egressBudgetMb(),
      usedEgressMb(),
    ]);
    const days: Record<string, { day: string; cpuS: number; runs: number; egressMb: number }> = {};
    const eggs: Array<{ name: string; bytes: number }> = [];
    for (const r of rows as Array<{ name: string; last_result: { cpuMs?: number; runs?: number; bytes?: number } | null }>) {
      if (/^usage:egress/.test(r.name)) eggs.push({ name: r.name, bytes: Number(r.last_result?.bytes ?? 0) });
      const m = /^usage:(egress:)?(\d{4}-\d{2}-\d{2})$/.exec(r.name);
      if (!m) continue;
      const d = (days[m[2]!] ??= { day: m[2]!, cpuS: 0, runs: 0, egressMb: 0 });
      if (m[1]) d.egressMb = Number(r.last_result?.bytes ?? 0) / 1048576;
      else {
        d.cpuS = Number(r.last_result?.cpuMs ?? 0) / 1000;
        d.runs = Number(r.last_result?.runs ?? 0);
      }
    }
    const list = Object.values(days).sort((a, b) => b.day.localeCompare(a.day)).slice(0, 35);
    const month = new Date().toISOString().slice(0, 7);
    const inMonth = list.filter((d) => d.day.startsWith(month));
    // what the last 31 days sent out, everything counted (the site, the laptop's connections, the backups, estimates for the days before the meter) against the rolling allowance
    const roll = rollingUse(eggs, Date.now());
    const windowMb = roll.prevMb + roll.todayMb;
    return NextResponse.json(
      {
        plan: PLAN,
        budgets: { cpuSPerDay: CPU_BUDGET_S_PER_DAY, egressMbPerDay: budgetMb, egressWindowMb: EGRESS_USE_MB, storageStopMb: STORAGE_LIMIT_MB },
        databaseMb: Math.round(Number(size.rows[0]?.mb ?? 0)),
        month: { cpuS: Math.round(inMonth.reduce((a, d) => a + d.cpuS, 0)), egressMb: Math.round(inMonth.reduce((a, d) => a + d.egressMb, 0)) },
        egress: { windowDays: EGRESS_WINDOW_DAYS, windowMb: Math.round(windowMb), previousDaysMb: Math.round(roll.prevMb), todayMb: Math.round(usedTodayMb), allowanceTodayMb: budgetMb },
        days: list,
      },
      { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" } },
    );
  } catch {
    return NextResponse.json({ error: "usage unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
