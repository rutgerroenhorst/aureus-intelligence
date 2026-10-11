/**
 * The exit alerts, running on the site itself, around the clock.
 *
 * A clock in the database (pg_cron, see scripts/cron-setup.ts) calls GET /api/cron/exit-alerts every two minutes with the site's secret. Nothing
 * depends on the laptop being on, or on anybody having the site open. One tick does, in order:
 *   1. a gate in the database, so two ticks that arrive together (or the clock and a person testing) never run side by side;
 *   2. a look at the wallet for new buys and sells (the same light sync the trade journal uses, new transactions only), at most every 3.5 minutes: the
 *      public Solana RPC answers slowly (5 to 10 seconds from Vercel) and that wait, not CPU, was most of a tick's running time;
 *   3. one pass of the exit check (apps/worker/src/exitLoop.ts runPass): prices from DexScreener, 2x and 5x of what was paid for what is still
 *      held, two checks in a row, a claim in the database before anything is sent, then Telegram;
 *   4. a heartbeat row, so the Telegram page can say when the site last checked.
 *
 * Every tick may start in a process that has never run before (serverless), so nothing that matters is kept in memory: what has been seen and sent, the
 * count of checks in a row and the record of messages are all in the database. The pass is cheap on purpose (a handful of tiny queries when nothing has
 * changed, one or two DexScreener calls) because Vercel's free plan allows 4 CPU-hours a month; the CPU of every tick is added to the day's count.
 *
 * The bot token and the paired chat are Vercel environment variables (EXIT_ALERT_TOKEN, EXIT_ALERT_CHAT_ID): never in the repository, never in the
 * database, never in an answer.
 */

import { getPool } from "@aureus/db";
import { dexQuotes, newPassState, pgStore, readConfig, runPass, telegram, type PassState, type Store, type Telegram } from "../../worker/src/exitLoop";
import { syncWalletsLight } from "./walletSync";
import { addUsage } from "./cloudScan";
import { loggedText, testButtons, testText } from "./exitAlerts";

interface Db {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

/** Ticks closer together than this are one tick (the clock runs every two minutes). */
const MIN_GAP_S = 45;
/** The wallet is read again when its last read (by this site or by the laptop, which copies the time) is older than this: every second tick. */
const WALLET_EVERY_S = 210;

export interface TickResult {
  ok: boolean;
  skipped?: string;
  error?: string;
  test?: boolean;
  positions?: number;
  priced?: number;
  sent?: number;
  ms?: number;
  cpuMs?: number;
  /** where the running time went: reading the wallet (0 when it was skipped) and the pass itself */
  walletMs?: number;
  passMs?: number;
}

export interface TickDeps {
  db: Db;
  env: NodeJS.ProcessEnv;
  /** looks at the wallet for new buys and sells; never throws */
  syncWallets: (db: Db) => Promise<void>;
  tg: (token: string) => Telegram;
  addCpu: (ms: number) => Promise<void>;
  /** the pass itself; replaced in tests */
  run?: (cfg: { chatId: string; levels: number[] }, st: PassState, store: Store, tg: Telegram) => Promise<{ positions: number; priced: number; sent: number }>;
  now: () => number;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}

/** What a warm serverless instance keeps between ticks (prices that were not found, positions worked out, ...). Losing it costs a few more DexScreener calls, nothing else. */
let warm: PassState | null = null;

const realDeps = (): TickDeps => ({
  db: getPool(),
  env: process.env,
  syncWallets: (db) => syncWalletsLight(db),
  tg: (token) => telegram(token),
  addCpu: (ms) => addUsage(ms),
  now: () => Date.now() / 1000,
  log: (msg, extra) => console.log(JSON.stringify({ msg, ...extra })),
});

export async function exitTick(opts: { test?: boolean } = {}, over: Partial<TickDeps> = {}): Promise<TickResult> {
  const d: TickDeps = { ...realDeps(), ...over };
  const t0 = Date.now();
  const cpu0 = process.cpuUsage();
  // the env var wins; there is no file on the server
  const cfg = readConfig(d.env, "/nonexistent/.env.exit-alerts.local");
  if (!cfg) return { ok: true, skipped: "no bot token configured" };
  if (!cfg.chatId) return { ok: true, skipped: "no chat paired" };
  const tg = d.tg(cfg.token);
  const store = pgStore(d.db);

  if (opts.test) {
    const html = testText();
    const buttons = testButtons();
    const res = await tg.send(cfg.chatId, html, { buttons });
    const failure = "error" in res ? res.error : null;
    await store.logMessage({ kind: "test", ok: res.ok, messageId: "messageId" in res ? res.messageId : null, html: loggedText(html, buttons), error: failure });
    return failure == null ? { ok: true, test: true } : { ok: false, test: true, error: failure };
  }

  // one tick at a time: the row is claimed (inserted or moved forward) only when the last tick is older than the minimum gap
  const gate = await d.db.query(
    `INSERT INTO exit_alert_kv (key, value) VALUES ('hosted_tick', '1')
     ON CONFLICT (key) DO UPDATE SET value = '1', updated_at = now() WHERE exit_alert_kv.updated_at < now() - make_interval(secs => $1::int)
     RETURNING key`,
    [MIN_GAP_S],
  );
  if (!gate.rows.length) return { ok: true, skipped: "ran less than a minute ago" };

  try {
    // the wallet is read every other tick: its last read is in the database (wallet_watch.synced_at), whoever made it
    const last = (await d.db.query(`SELECT EXTRACT(EPOCH FROM (now() - max(synced_at)))::float AS age FROM wallet_watch`).catch(() => ({ rows: [] as any[] }))).rows[0]?.age;
    const w0 = Date.now();
    if (last == null || Number(last) >= WALLET_EVERY_S) await d.syncWallets(d.db);
    const walletMs = Date.now() - w0;
    const p0 = Date.now();
    const st = (warm ??= newPassState());
    const run = d.run ?? ((c, s, st2, t) => runPass(c, { store: st2, tg: t, prices: (m) => dexQuotes(m), log: d.log, now: d.now, minGapS: 60 }, s, { persistStreaks: true }));
    const r = await run({ chatId: cfg.chatId, levels: cfg.levels }, st, store, tg);
    const passMs = Date.now() - p0;
    const ms = Date.now() - t0;
    const cpu = process.cpuUsage(cpu0);
    const cpuMs = Math.round((cpu.user + cpu.system) / 1000);
    await d.addCpu(cpuMs).catch(() => undefined);
    // the heartbeat the Telegram page shows: when the site last looked, and what it saw
    await d.db
      .query(`INSERT INTO exit_alert_kv (key, value) VALUES ('hosted_tick_ok', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify({ ...r, ms, cpuMs })])
      .catch(() => undefined);
    return { ok: true, ...r, ms, cpuMs, walletMs, passMs };
  } catch (e) {
    const error = scrub(String((e as Error)?.message ?? e), cfg.token).slice(0, 200);
    d.log("exit tick failed", { error });
    return { ok: false, error, ms: Date.now() - t0 };
  }
}

/** An error message can carry the address that was called (Telegram's addresses contain the bot token): take the token and anything shaped like one out before it is logged or returned. */
function scrub(text: string, token: string): string {
  let out = token ? text.split(token).join("[token]") : text;
  out = out.replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, "[token]");
  return out;
}
