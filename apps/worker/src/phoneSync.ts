/**
 * Puts the laptop's view of pump.fun graduations where the phone can see it.
 *
 * pump.fun's event stream can only be held open by a long-running process (the laptop worker or scripts/lab-daemon.ts); the hosted
 * site cannot. When LAB_SYNC_URL (a connection string for the hosted database) is set, this copies one small snapshot (the
 * graduations of the last 72 hours with the lab's readings, and how each kind ended) into the hosted database every few minutes
 * (lab_reports, kind "gradlist", one row, replaced each time). The hosted Radar, Home and coin dossier read it and say how old it is.
 * Off when the variable is not set. Additive: code from before this existed never reads that row.
 */

import pg from "pg";
import { pushGraduates } from "../../web/lib/graduates";

type Log = (msg: string, extra?: Record<string, unknown>) => void;
interface Client {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

const EVERY_MS = Number(process.env.LAB_SYNC_EVERY_MINUTES ?? 3) * 60_000;

/** Start the loop; returns a function that stops it. A failed round only logs: the next one tries again. */
export function startPhoneSync(local: Client, log: Log): () => void {
  const url = process.env.LAB_SYNC_URL;
  if (!url) return () => undefined;
  let hosted: pg.Pool | null = null;
  let running = false;
  let failures = 0;
  const round = async () => {
    if (running) return;
    running = true;
    try {
      hosted ??= new pg.Pool({ connectionString: url, max: 1, statement_timeout: 30_000, idleTimeoutMillis: 20_000, connectionTimeoutMillis: 15_000 });
      const r = await pushGraduates(local, hosted as unknown as Client);
      if (failures > 0 || r == null) log("phone sync", r ?? { skipped: "no graduations yet" });
      failures = 0;
    } catch (e) {
      failures++;
      // log the first failure and then every tenth: a hosted database that is down should not fill the log
      if (failures === 1 || failures % 10 === 0) log("phone sync failed", { error: String((e as Error)?.message ?? e).slice(0, 160), failures });
    } finally {
      running = false;
    }
  };
  log("phone sync on", { everyMs: EVERY_MS });
  const first = setTimeout(() => void round(), 20_000);
  const timer = setInterval(() => void round(), EVERY_MS);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
    void hosted?.end().catch(() => undefined);
  };
}
