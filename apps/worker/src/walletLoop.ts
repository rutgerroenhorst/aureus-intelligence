/**
 * Keeps the trade journal in step with the user's wallet: every few minutes, new transactions of every followed address are read
 * (lib/walletSync.ts) and the journal is updated. Does nothing when no address is registered (table wallet_watch). Read-only: only the
 * public address is used.
 */

import pg from "pg";
import { pushWalletFlows, pushWalletRows, syncAllWallets } from "../../web/lib/walletSync";

type Log = (msg: string, extra?: Record<string, unknown>) => void;
interface Client {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

const EVERY_MS = Number(process.env.WALLET_EVERY_MINUTES ?? 5) * 60_000;

/** Start the loop; returns a function that stops it. A failed round only logs: the next one tries again. */
export function startWalletLoop(db: Client, log: Log): () => void {
  let running = false;
  let hosted: pg.Pool | null = null;
  const round = async () => {
    if (running) return;
    running = true;
    try {
      for (const r of await syncAllWallets(db, { maxRead: 40, budgetMs: 90_000 })) {
        if (r.newSignatures || r.read || r.unreadable) log("wallet", { address: r.address, new: r.newSignatures, read: r.read, unreadable: r.unreadable, pending: r.pending, journal: r.journal });
      }
      // with LAB_SYNC_URL set, the hosted journal is kept level too (the phone sees new trades without anyone opening the page first)
      if (process.env.LAB_SYNC_URL) {
        hosted ??= new pg.Pool({ connectionString: process.env.LAB_SYNC_URL, max: 1, statement_timeout: 60_000, idleTimeoutMillis: 20_000, connectionTimeoutMillis: 15_000 });
        for (const a of (await db.query(`SELECT address FROM wallet_watch`)).rows) {
          const p = await pushWalletRows(db, hosted as unknown as Client, a.address as string);
          if (p) log("wallet pushed to the hosted journal", { txs: p.txs, fills: p.fills, journal: p.journal });
          const f = await pushWalletFlows(db, hosted as unknown as Client, a.address as string);
          if (f) log("wallet deposits pushed to the hosted database", { flows: f });
        }
      }
    } catch (e) {
      log("wallet sync failed", { error: String((e as Error)?.message ?? e).slice(0, 160) });
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void round(), 30_000);
  const timer = setInterval(() => void round(), EVERY_MS);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
    void hosted?.end().catch(() => undefined);
  };
}
