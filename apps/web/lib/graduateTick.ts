/**
 * One tick of the graduation feed (lib/graduateFeed.ts), called every 3 minutes by the database's clock (GET /api/cron/graduates, scripts/cron-setup.ts):
 * the lease keeps two ticks from running together, the CPU it used is added to the day's count like the exit check's.
 */

import { getPool } from "@aureus/db";
import { addUsage } from "./cloudScan";
import { pgFeedStore, realFeedDeps, runFeed, type FeedResult } from "./graduateFeed";

export type GraduateTickResult = Partial<FeedResult> & { ok: boolean; ms?: number; cpuMs?: number };

export async function graduateTick(): Promise<GraduateTickResult> {
  const store = pgFeedStore(getPool());
  if (!(await store.claim())) return { ok: true, skipped: "another tick is running" };
  const t0 = Date.now();
  const cpu0 = process.cpuUsage();
  try {
    const res = await runFeed(realFeedDeps((msg, extra) => console.log(JSON.stringify({ msg, ...extra }))), store, Math.floor(Date.now() / 180_000));
    const cpu = process.cpuUsage(cpu0);
    const cpuMs = Math.round((cpu.user + cpu.system) / 1000);
    await addUsage(cpuMs).catch(() => undefined);
    return { ...res, ms: Date.now() - t0, cpuMs };
  } catch (e) {
    const error = String((e as Error)?.message ?? e).slice(0, 200);
    console.error("[graduates] tick failed", error);
    await store.fail(error).catch(() => undefined);
    return { ok: false, error, ms: Date.now() - t0 };
  }
}
