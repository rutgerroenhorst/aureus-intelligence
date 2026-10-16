/**
 * Keeps the ranking of the networks (Radar, Hot tab) fresh: every few minutes the six networks are read (lib/hotChains.ts) and the
 * ranking is stored in the local database and, when LAB_SYNC_URL (a connection string for the hosted database) is set, in the hosted one
 * as well, so the phone shows a current list without anyone opening the page first. Only free, public sources are read; nothing here
 * touches the wallet. HOT_LOOP=0 switches it off, HOT_EVERY_MINUTES (default 4) sets the pace.
 */

import pg from "pg";
import { meterPool } from "@aureus/db";
import { computeHotChains, saveHotReport, type HotReport } from "../../web/lib/hotChains";

type Log = (msg: string, extra?: Record<string, unknown>) => void;
interface Client {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

const EVERY_MS = Number(process.env.HOT_EVERY_MINUTES ?? 4) * 60_000;
// GeckoTerminal's limit (about 30 calls a minute) is shared with the worker's own ingestion on this address, so a refusal now and then is
// normal here: wait longer than the hosted route can, and let a network that stays refused keep its last reading for a while
const PATIENT = { gapMs: 3_000, backoffMs: 10_000, retryAfterMs: 20_000, retryWithinMs: 120_000 };

/** Start the loop; returns a function that stops it. A failed round only logs: the next one tries again. */
export function startHotLoop(local: Client, log: Log): () => void {
  if (process.env.HOT_LOOP === "0") return () => undefined;
  let hosted: pg.Pool | null = null;
  let running = false;
  let failures = 0;
  let rounds = 0;
  let lastTop = "";
  const round = async () => {
    if (running) return;
    running = true;
    try {
      const before = (await local.query(`SELECT payload FROM lab_reports WHERE kind = 'hotchains'`).catch(() => ({ rows: [] as any[] }))).rows[0]?.payload as HotReport | undefined;
      const r = await computeHotChains(undefined, PATIENT, before ?? null);
      const storedLocal = await saveHotReport(local, r);
      let storedHosted: boolean | null = null;
      if (process.env.LAB_SYNC_URL) {
        hosted ??= meterPool(new pg.Pool({ connectionString: process.env.LAB_SYNC_URL, max: 1, statement_timeout: 30_000, idleTimeoutMillis: 20_000, connectionTimeoutMillis: 15_000 }));
        storedHosted = await saveHotReport(hosted as unknown as Client, r);
      }
      const top = r.chains[0]?.id ?? "";
      const bad = r.chains.filter((c) => c.stats.error).map((c) => c.id);
      // a line when the hottest network changes, when something could not be read, or about once an hour: a quiet log otherwise
      if (failures > 0 || top !== lastTop || bad.length || rounds % 15 === 0) {
        log("hot networks", { order: r.chains.map((c) => `${c.rank}.${c.id}:${c.heat}`).join(" "), unreadable: bad, stored: { local: storedLocal, hosted: storedHosted } });
      }
      lastTop = top;
      failures = 0;
      rounds++;
    } catch (e) {
      failures++;
      if (failures === 1 || failures % 10 === 0) log("hot networks failed", { error: String((e as Error)?.message ?? e).slice(0, 160), failures });
    } finally {
      running = false;
    }
  };
  log("hot networks on", { everyMs: EVERY_MS });
  const first = setTimeout(() => void round(), 15_000);
  const timer = setInterval(() => void round(), EVERY_MS);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
    void hosted?.end().catch(() => undefined);
  };
}
