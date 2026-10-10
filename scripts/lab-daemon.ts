/**
 * The Learning Lab as its own long-running process: it holds pump.fun's event stream (every launch and graduation, free) and runs a
 * lab round every 10 minutes. Use it when the main worker is not running, or has not been restarted yet to load the same code:
 * the stream and the lab rounds each take a database lock / their own timing, so nothing is done twice when both run.
 *
 *   corepack pnpm exec tsx scripts/lab-daemon.ts          # stop with Ctrl+C
 *
 * LAB_EVERY_MINUTES (default 10) sets the pace of the rounds; PUMP_FEED=0 leaves the stream off.
 * LAB_SYNC_URL (a connection string for the hosted database) copies the graduations to it every 3 minutes, so the phone shows them.
 */
import { closePool, getPool } from "@aureus/db";
import { runLab } from "../apps/web/lib/lab/tick";
import { collectWatch } from "../apps/web/lib/lab/lanes";
import { PumpFeed } from "../apps/worker/src/pumpFeed";
import { startPhoneSync } from "../apps/worker/src/phoneSync";
import { startWalletLoop } from "../apps/worker/src/walletLoop";

const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), worker: "lab-daemon", msg, ...extra }));
const everyMs = Number(process.env.LAB_EVERY_MINUTES ?? 10) * 60_000;
let stopping = false;

async function main() {
  const pool = getPool();
  const feed = process.env.PUMP_FEED === "0" ? null : new PumpFeed(pool as never, log);
  void feed?.start();
  const stopSync = startPhoneSync(pool as never, log);
  const stopWallet = startWalletLoop(pool as never, log);
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    log("stopping");
    stopSync();
    stopWallet();
    feed?.stop();
    await closePool().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  log("started", { everyMs, pumpFeed: Boolean(feed) });
  // the watch list (fresh graduations first) is read every 2 minutes, so a new graduation has a price within minutes instead of at the next round
  let polling = false;
  setInterval(async () => {
    if (polling || stopping) return;
    polling = true;
    try {
      await collectWatch(pool as never, { maxCalls: 30 });
    } catch (e) {
      log("watch poll failed", { error: String((e as Error)?.message ?? e).slice(0, 160) });
    } finally {
      polling = false;
    }
  }, 120_000);
  while (!stopping) {
    try {
      const r = await runLab();
      log("lab", { ms: r.ms, runners: r.runners, watch: r.watch, statics: r.statics, rugcheck: r.rugcheck, regime: r.regime, lessons: r.lessons, reports: r.reports });
    } catch (e) {
      log("lab failed", { error: String((e as Error)?.message ?? e).slice(0, 200) });
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
