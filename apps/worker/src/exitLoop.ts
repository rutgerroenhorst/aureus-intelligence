/**
 * Sends the exit alerts (apps/web/lib/exitAlerts.ts) to the user's own Telegram bot.
 *
 * Every couple of minutes: what the followed wallet still holds (wallet_fills, first in first out), the price of each coin (DexScreener, 30 a
 * call), and for each position whether it has reached 2x or 5x what was paid for what is still held. A level is reported once per position,
 * after two checks in a row show it, only for a real pool that is big next to the position. Positions that were already above a level when
 * the alerts were switched on are marked as seen without a message (one welcome message lists them instead).
 *
 * Secrets: the bot token and the chat id live in a git-ignored file (.env.exit-alerts.local, or the environment) and are never logged, stored
 * in the database or written anywhere else; errors are cleaned of the token before they are logged. Pairing: the chat id is not typed in. The
 * file carries a one-time code (EXIT_ALERT_PAIR_CODE); the user opens t.me/<bot>?start=<code>, the loop sees "/start <code>" from a private
 * chat, stores that chat id, deletes the code and sends the welcome message. Nobody else can pair the bot: they do not have the code.
 *
 * Off when no token is configured. The messages only leave the laptop towards api.telegram.org, to the paired chat.
 */

import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { logMessage, type LoggedMessage } from "./telegramLog";
import {
  alertButtons,
  alertText,
  CONFIRM_CHECKS,
  dexLink,
  LEVELS_DEFAULT,
  loggedText,
  openPosition,
  readPosition,
  welcomeText,
  type Fill,
  type HeldNow,
  type MessageButton,
  type Position,
} from "../../web/lib/exitAlerts";

type Log = (msg: string, extra?: Record<string, unknown>) => void;
interface Db {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

// ---------------------------------------------------------------- configuration

export const ENV_FILE = ".env.exit-alerts.local";

export interface ExitConfig {
  token: string;
  chatId: string | null;
  pairCode: string | null;
  levels: number[];
  file: string;
}

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith("#")) out[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
  return out;
}

/** The environment first, then the file. Null when there is no token. */
export function readConfig(env: NodeJS.ProcessEnv = process.env, file: string = path.join(process.cwd(), ENV_FILE)): ExitConfig | null {
  let fromFile: Record<string, string> = {};
  try {
    fromFile = parseEnv(fs.readFileSync(file, "utf8"));
  } catch {
    /* no file: the environment alone */
  }
  const get = (k: string) => (env[k] || fromFile[k] || "").trim();
  const token = get("EXIT_ALERT_TOKEN");
  if (!token) return null;
  const levels = get("EXIT_ALERT_LEVELS")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 1);
  return { token, chatId: get("EXIT_ALERT_CHAT_ID") || null, pairCode: get("EXIT_ALERT_PAIR_CODE") || null, levels: levels.length ? [...new Set(levels)].sort((a, b) => a - b) : LEVELS_DEFAULT, file };
}

/** Set (or, with null, remove) one variable in the env file, keeping the other lines and the file private. */
export function setEnvVar(file: string, key: string, value: string | null): void {
  let lines: string[] = [];
  try {
    lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  } catch {
    /* new file */
  }
  const rest = lines.filter((l) => !new RegExp(`^\\s*${key}\\s*=`).test(l));
  while (rest.length && rest[rest.length - 1] === "") rest.pop();
  if (value != null) rest.push(`${key}=${value}`);
  fs.writeFileSync(file, rest.join("\n") + "\n", { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

// ---------------------------------------------------------------- Telegram

export interface Update {
  id: number;
  chatId: number | null;
  chatType: string | null;
  text: string | null;
}

export interface Telegram {
  /** `buttons` become one row of link buttons under the message (Telegram's inline keyboard) */
  send(chatId: string, text: string, opts?: { buttons?: MessageButton[] }): Promise<{ ok: true; messageId: number } | { ok: false; error: string; retryAfter?: number }>;
  updates(offset: number): Promise<Update[] | null>;
}

export function telegram(token: string, fetchImpl: typeof fetch = fetch): Telegram {
  const clean = (s: string) => s.split(token).join("***");
  const call = async (method: string, body: unknown): Promise<{ status: number; json: any; error?: string }> => {
    try {
      const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    } catch (e) {
      return { status: 0, json: null, error: clean(String((e as Error)?.message ?? e)).slice(0, 120) };
    }
  };
  return {
    async send(chatId, text, opts) {
      const buttons = (opts?.buttons ?? []).filter((b) => /^https?:\/\//.test(b.url));
      const base = { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true };
      let r = await call("sendMessage", buttons.length ? { ...base, reply_markup: { inline_keyboard: [buttons.map((b) => ({ text: b.text, url: b.url }))] } } : base);
      // a button Telegram does not accept must never cost the alert itself: send the message again without it
      if (buttons.length && !r.json?.ok && /button|reply markup|url/i.test(String(r.json?.description ?? ""))) r = await call("sendMessage", base);
      if (r.json?.ok && r.json.result?.message_id != null) return { ok: true, messageId: Number(r.json.result.message_id) };
      const retryAfter = Number(r.json?.parameters?.retry_after);
      return { ok: false, error: clean(String(r.json?.description ?? r.error ?? `http ${r.status}`)).slice(0, 160), ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfter } : {}) };
    },
    async updates(offset) {
      const r = await call("getUpdates", { offset, timeout: 0, allowed_updates: ["message"] });
      if (!r.json?.ok || !Array.isArray(r.json.result)) return null;
      return r.json.result.map((u: any) => ({ id: Number(u.update_id), chatId: u.message?.chat?.id ?? null, chatType: u.message?.chat?.type ?? null, text: typeof u.message?.text === "string" ? u.message.text : null }));
    },
  };
}

// ---------------------------------------------------------------- prices

export interface Priced {
  price: number;
  liq: number;
  pair: string | null;
  symbol: string | null;
}

const fin = (x: unknown): number | null => {
  const n = typeof x === "number" ? x : x == null || x === "" ? NaN : Number(x);
  return Number.isFinite(n) ? n : null;
};

/** DexScreener's best pool (most liquidity) for each coin, 30 coins a call. A coin it does not list is missing from the map. */
export async function dexQuotes(mints: string[], fetchImpl: typeof fetch = fetch): Promise<Map<string, Priced>> {
  const out = new Map<string, Priced>();
  for (let i = 0; i < mints.length; i += 30) {
    const batch = mints.slice(i, i + 30);
    try {
      const res = await fetchImpl(`https://api.dexscreener.com/tokens/v1/solana/${batch.join(",")}`, { headers: { accept: "application/json", "user-agent": "Aureus-Exit/1.0" }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) continue;
      const pairs = (await res.json()) as any[];
      if (!Array.isArray(pairs)) continue;
      for (const p of pairs) {
        const m = p?.baseToken?.address as string | undefined;
        const price = fin(p?.priceUsd);
        const liq = fin(p?.liquidity?.usd) ?? 0;
        if (!m || price == null || price <= 0 || !batch.includes(m)) continue;
        const cur = out.get(m);
        if (!cur || liq > cur.liq) out.set(m, { price, liq, pair: (p?.pairAddress as string | undefined) ?? null, symbol: (p?.baseToken?.symbol as string | undefined) ?? null });
      }
    } catch {
      /* these coins are simply not priced this time */
    }
    if (i + 30 < mints.length) await new Promise((r) => setTimeout(r, 150));
  }
  return out;
}

// ---------------------------------------------------------------- state in the database (migration 0034)

/** How many checks in a row have shown a level, and when the last one was. Kept in the database so that any process (the site's own check, the laptop) can add to it. */
export interface Streak {
  n: number;
  t: number;
}

export interface Store {
  fills(): Promise<Map<string, Fill[]>>;
  /** a cheap fingerprint of the fills: while it has not changed the positions need not be read and worked out again */
  fillsVersion(): Promise<string>;
  symbols(mints: string[]): Promise<Map<string, string>>;
  armedAt(): Promise<number | null>;
  setArmedAt(t: number): Promise<void>;
  /** every level recorded for every position (0 = the position has been seen): key `${mint}|${started}` */
  knownAll(): Promise<Map<string, Set<number>>>;
  /** a cheap fingerprint of what knownAll would return */
  knownVersion(): Promise<string>;
  seed(mint: string, started: number, levels: number[]): Promise<void>;
  claim(mint: string, started: number, level: number, facts: { multiple: number; price: number; basis: number; value: number }): Promise<boolean>;
  markSent(mint: string, started: number, level: number, messageId: number): Promise<void>;
  release(mint: string, started: number, level: number): Promise<void>;
  expireClaims(): Promise<void>;
  /** keep a record of a message that was sent (or failed) for the Telegram page */
  logMessage(m: LoggedMessage): Promise<void>;
  /** alerts Telegram accepted in the last 24 hours (the daily ceiling counts these) */
  alertsLast24h(): Promise<number>;
  loadStreaks(): Promise<Record<string, Streak>>;
  saveStreaks(s: Record<string, Streak>): Promise<void>;
}

export function pgStore(db: Db): Store {
  return {
    async fills() {
      const { rows } = await db.query(
        `SELECT mint, EXTRACT(EPOCH FROM t)::float8 AS t, side, tokens::float8 AS tokens, usd::float8 AS usd
           FROM wallet_fills
          WHERE side IN ('buy', 'sell') AND mint IN (SELECT mint FROM wallet_fills WHERE side = 'buy' GROUP BY mint)
          ORDER BY mint, t`,
      );
      const out = new Map<string, Fill[]>();
      for (const r of rows) {
        const a = out.get(r.mint) ?? [];
        a.push({ t: r.t, side: r.side, tokens: r.tokens, usd: r.usd });
        out.set(r.mint, a);
      }
      return out;
    },
    async fillsVersion() {
      const { rows } = await db.query(`SELECT count(*)::text || ':' || COALESCE(EXTRACT(EPOCH FROM max(t))::text, '0') AS v FROM wallet_fills WHERE side IN ('buy', 'sell')`);
      return String(rows[0]?.v ?? "0");
    },
    async symbols(mints) {
      if (!mints.length) return new Map();
      const { rows } = await db.query(`SELECT DISTINCT ON (mint) mint, symbol FROM my_trades WHERE mint = ANY($1::text[]) AND symbol IS NOT NULL AND symbol <> '' ORDER BY mint, entered_at`, [mints]);
      return new Map(rows.map((r) => [r.mint as string, r.symbol as string]));
    },
    async armedAt() {
      const { rows } = await db.query(`SELECT value FROM exit_alert_kv WHERE key = 'armed_at'`);
      return rows[0] ? Number(rows[0].value) : null;
    },
    async setArmedAt(t) {
      await db.query(`INSERT INTO exit_alert_kv (key, value) VALUES ('armed_at', $1) ON CONFLICT (key) DO NOTHING`, [String(t)]);
    },
    async knownAll() {
      const { rows } = await db.query(`SELECT mint, EXTRACT(EPOCH FROM position_start)::float8 AS started, level::float8 AS level FROM exit_alerts`);
      const out = new Map<string, Set<number>>();
      for (const r of rows) {
        const k = `${r.mint}|${Math.floor(Number(r.started))}`;
        const set = out.get(k) ?? new Set<number>();
        set.add(Number(r.level));
        out.set(k, set);
      }
      return out;
    },
    async knownVersion() {
      const { rows } = await db.query(`SELECT count(*)::text || ':' || count(*) FILTER (WHERE state = 'sent')::text || ':' || count(*) FILTER (WHERE state = 'claimed')::text AS v FROM exit_alerts`);
      return String(rows[0]?.v ?? "0");
    },
    async seed(mint, started, levels) {
      await db.query(
        `INSERT INTO exit_alerts (mint, level, position_start, state) SELECT $1::text, l, to_timestamp($2::float8), 'seeded' FROM unnest($3::numeric[]) AS l ON CONFLICT DO NOTHING`,
        [mint, started, [0, ...levels]],
      );
    },
    async claim(mint, started, level, f) {
      const r = await db.query(
        `INSERT INTO exit_alerts (mint, level, position_start, state, multiple, price, basis, value_usd) VALUES ($1::text, $2::numeric, to_timestamp($3::float8), 'claimed', $4::numeric, $5::numeric, $6::numeric, $7::numeric)
         ON CONFLICT DO NOTHING RETURNING level`,
        [mint, level, started, f.multiple, f.price, f.basis, f.value],
      );
      return (r.rowCount ?? r.rows.length) > 0;
    },
    async markSent(mint, started, level, messageId) {
      await db.query(`UPDATE exit_alerts SET state = 'sent', sent_at = now(), message_id = $4::bigint WHERE mint = $1::text AND level = $2::numeric AND position_start = to_timestamp($3::float8)`, [mint, level, started, messageId]);
    },
    async release(mint, started, level) {
      await db.query(`DELETE FROM exit_alerts WHERE mint = $1::text AND level = $2::numeric AND position_start = to_timestamp($3::float8) AND state = 'claimed'`, [mint, level, started]);
    },
    async expireClaims() {
      await db.query(`DELETE FROM exit_alerts WHERE state = 'claimed' AND created_at < now() - interval '10 minutes'`);
    },
    async logMessage(m) {
      await logMessage(db, m);
    },
    async alertsLast24h() {
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM telegram_messages WHERE kind = 'alert' AND ok AND sent_at > now() - interval '24 hours'`);
      return Number(rows[0]?.n ?? 0);
    },
    async loadStreaks() {
      const { rows } = await db.query(`SELECT value FROM exit_alert_kv WHERE key = 'streaks'`);
      try {
        const parsed = rows[0] ? JSON.parse(String(rows[0].value)) : {};
        return parsed && typeof parsed === "object" ? (parsed as Record<string, Streak>) : {};
      } catch {
        return {};
      }
    },
    async saveStreaks(s) {
      await db.query(`INSERT INTO exit_alert_kv (key, value) VALUES ('streaks', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify(s)]);
    },
  };
}

// ---------------------------------------------------------------- one pass

export interface Deps {
  store: Store;
  tg: Telegram;
  prices: (mints: string[]) => Promise<Map<string, Priced>>;
  log: Log;
  /** epoch seconds */
  now: () => number;
  /** pause between two messages (Telegram asks for at most one a second to one chat); tests pass a no-op */
  sleep?: (ms: number) => Promise<void>;
  /** two checks only count as two when they are at least this many seconds apart (default 60): two processes looking at the same moment are one check */
  minGapS?: number;
}

export interface PassState {
  /** checks that showed a level, per position and level; with `persistStreaks` they live in the database and every pass starts from there */
  streak: Map<string, Streak>;
  /** consecutive passes in which a coin had no price: coins that are gone are asked about only now and then */
  misses: Map<string, number>;
  pass: number;
  /** messages recorded so far in this process: the loop copies the log to the hosted database when it changes */
  logged: number;
  /** when a failed send was last recorded, per alert: a Telegram outage must not fill the page with the same failure */
  failLogged: Map<string, number>;
  /** Telegram said "slow down": nothing is sent before this time (epoch seconds) */
  pauseUntil: number;
  /** the day (UTC date) on which the daily ceiling was last reported in the log */
  capLoggedOn: string;
  /** positions, worked out from the fills, and the fingerprint of the fills they were worked out from */
  cache: { version: string; positions: Position[]; symbols: Map<string, string> } | null;
  /** every recorded level, and the fingerprint it was read at */
  known: { version: string; map: Map<string, Set<number>> } | null;
  armed: number | null;
  /** the streaks as last written to the database (to write only when something changed) */
  streaksJson: string;
}

export const newPassState = (): PassState => ({ streak: new Map(), misses: new Map(), pass: 0, logged: 0, failLogged: new Map(), pauseUntil: 0, capLoggedOn: "", cache: null, known: null, armed: null, streaksJson: "{}" });
/** A ceiling on the alerts of one day: a bug must never be able to flood the phone. A real day brings one to five. EXIT_ALERT_MAX_PER_DAY changes it. */
const MAX_ALERTS_PER_DAY = Number(process.env.EXIT_ALERT_MAX_PER_DAY ?? 40);
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const MAX_PER_PASS = 6;
const GONE_AFTER = 30;
const STREAK_KEEP_S = 24 * 3600;

/** What is held now: positions with their price, plus the coins' names. The positions are only worked out again when the fills have changed. */
export async function currentPositions(deps: Pick<Deps, "store" | "prices">, st: PassState): Promise<{ held: Array<{ pos: Position; q: Priced | null }>; symbols: Map<string, string> }> {
  const version = await deps.store.fillsVersion();
  if (!st.cache || st.cache.version !== version) {
    const fills = await deps.store.fills();
    const positions: Position[] = [];
    for (const [mint, f] of fills) {
      const p = openPosition(mint, f);
      if (p) positions.push(p);
    }
    st.cache = { version, positions, symbols: await deps.store.symbols(positions.map((p) => p.mint)) };
  }
  const positions = st.cache.positions;
  const ask = positions.filter((p) => (st.misses.get(p.mint) ?? 0) < GONE_AFTER || st.pass % GONE_AFTER === 0);
  const quotes = ask.length ? await deps.prices(ask.map((p) => p.mint)) : new Map<string, Priced>();
  for (const p of ask) {
    if (quotes.has(p.mint)) st.misses.delete(p.mint);
    else st.misses.set(p.mint, (st.misses.get(p.mint) ?? 0) + 1);
  }
  return { held: positions.map((pos) => ({ pos, q: quotes.get(pos.mint) ?? null })), symbols: st.cache.symbols };
}

export interface PassOptions {
  /** read the streaks from the database at the start of the pass and write them back at the end (the site's own check, which may start in a new process every time) */
  persistStreaks?: boolean;
}

export async function runPass(cfg: { chatId: string; levels: number[] }, deps: Deps, st: PassState, opts: PassOptions = {}): Promise<{ positions: number; priced: number; sent: number }> {
  const { store, tg, log } = deps;
  st.pass++;
  if (st.armed == null) {
    st.armed = await store.armedAt();
    if (st.armed == null) {
      st.armed = deps.now();
      await store.setArmedAt(st.armed);
    }
  }
  const armed = st.armed;
  if (st.pass % 10 === 1) await store.expireClaims();
  if (deps.now() < st.pauseUntil) return { positions: 0, priced: 0, sent: 0 };
  if (opts.persistStreaks) {
    const loaded = await store.loadStreaks();
    st.streak = new Map(Object.entries(loaded));
    st.streaksJson = JSON.stringify(loaded);
  }
  // the ceiling for the last 24 hours: asked about only when there is something to send
  let room: number | null = null;
  const roomLeft = async () => (room ??= MAX_ALERTS_PER_DAY > 0 ? MAX_ALERTS_PER_DAY - (await store.alertsLast24h()) : Number.POSITIVE_INFINITY);
  const { held, symbols } = await currentPositions(deps, st);
  // every recorded level in one read, and again only when the fingerprint says something was written
  const kv = await store.knownVersion();
  if (!st.known || st.known.version !== kv) st.known = { version: kv, map: await store.knownAll() };
  const knownMap = st.known.map;
  let wrote = false;
  const gap = deps.minGapS ?? 60;
  let sent = 0;
  let priced = 0;
  for (const { pos, q } of held) {
    if (!q) continue;
    priced++;
    const r = readPosition(pos, q, cfg.levels);
    const started = Math.floor(pos.started);
    const posKey = `${pos.mint}|${started}`;
    let known = knownMap.get(posKey);
    if (!known) {
      // first time this position is seen: what it had already reached before the alerts were switched on is not news
      const seed = pos.started < armed ? r.reached : [];
      await store.seed(pos.mint, started, seed);
      known = new Set([0, ...seed]);
      knownMap.set(posKey, known);
      wrote = true;
    }
    // levels that have now been shown by enough checks in a row; claimed first, so two processes can never both report the same one
    const due: number[] = [];
    for (const level of cfg.levels) {
      const key = `${pos.mint}|${started}|${level}`;
      if (known.has(level)) continue;
      if (!r.reached.includes(level) || !r.alertable) {
        st.streak.delete(key);
        continue;
      }
      const prev = st.streak.get(key);
      let n = prev?.n ?? 0;
      if (!prev || deps.now() - prev.t >= gap) {
        n++;
        st.streak.set(key, { n, t: deps.now() });
      }
      if (n < CONFIRM_CHECKS || sent >= MAX_PER_PASS) continue;
      if ((await roomLeft()) <= 0) {
        const day = new Date(deps.now() * 1000).toISOString().slice(0, 10);
        if (st.capLoggedOn !== day) {
          st.capLoggedOn = day;
          log("exit alerts: the daily ceiling is reached, nothing more is sent until older alerts fall out of the last 24 hours", { ceiling: MAX_ALERTS_PER_DAY });
        }
        continue;
      }
      if (await store.claim(pos.mint, started, level, { multiple: r.multiple, price: q.price, basis: pos.basis, value: r.value })) {
        due.push(level);
        wrote = true;
      } else st.streak.delete(key);
    }
    if (!due.length) continue;
    // a coin that jumped over two levels at once gets one message, for the highest
    const top = Math.max(...due);
    const symbol = symbols.get(pos.mint) ?? q.symbol ?? pos.mint.slice(0, 6);
    const link = dexLink(q.pair, pos.mint);
    const text = alertText({ symbol, level: top, multiple: r.multiple, value: r.value, bought: pos.bought, sold: pos.sold, price: q.price, basis: pos.basis, liq: q.liq, link });
    const buttons = alertButtons({ link });
    if (sent > 0) await (deps.sleep ?? realSleep)(1100);
    const res = await tg.send(cfg.chatId, text, { buttons });
    // the page shows what went out; a failed send is recorded once per half hour per alert
    const failKey = `${pos.mint}|${top}`;
    if (res.ok || deps.now() - (st.failLogged.get(failKey) ?? 0) > 1800) {
      await store.logMessage({ kind: "alert", ok: res.ok, messageId: res.ok ? res.messageId : null, symbol, level: top, multiple: r.multiple, html: loggedText(text, buttons), error: res.ok ? null : res.error });
      st.logged++;
      if (!res.ok) st.failLogged.set(failKey, deps.now());
    }
    for (const level of due) {
      if (res.ok) {
        await store.markSent(pos.mint, started, level, res.messageId);
        known.add(level);
        st.streak.delete(`${pos.mint}|${started}|${level}`);
      } else {
        await store.release(pos.mint, started, level);
      }
    }
    if (res.ok) {
      sent++;
      room = (room ?? 0) - 1;
      log("exit alert sent", { symbol, level: top, multiple: Number(r.multiple.toFixed(2)) });
    } else {
      // Telegram asked to slow down: wait that long (at most an hour) before trying anything again
      if (res.retryAfter) st.pauseUntil = deps.now() + Math.min(3600, res.retryAfter);
      log("exit alert not sent", { symbol, level: top, error: res.error, ...(res.retryAfter ? { retryAfterS: res.retryAfter } : {}) });
    }
  }
  // what this pass wrote is already in `known`; the next pass reads again only if somebody else wrote too
  if (wrote) st.known = null;
  if (opts.persistStreaks) {
    for (const [k, v] of st.streak) if (deps.now() - v.t > STREAK_KEEP_S) st.streak.delete(k);
    const json = JSON.stringify(Object.fromEntries(st.streak));
    if (json !== st.streaksJson) {
      await store.saveStreaks(Object.fromEntries(st.streak));
      st.streaksJson = json;
    }
  }
  return { positions: held.length, priced, sent };
}

/** The first message after pairing: how it works, and what is already above the first level (listed, not reported again). */
export async function welcome(cfg: { chatId: string; levels: number[] }, deps: Deps, st: PassState): Promise<boolean> {
  const { held, symbols } = await currentPositions(deps, st);
  const above: HeldNow[] = [];
  for (const { pos, q } of held) {
    if (!q) continue;
    const r = readPosition(pos, q, cfg.levels);
    if (r.alertable && r.reached.length) above.push({ symbol: symbols.get(pos.mint) ?? q.symbol ?? pos.mint.slice(0, 6), multiple: r.multiple, value: r.value });
  }
  const html = welcomeText(cfg.levels, above);
  const res = await deps.tg.send(cfg.chatId, html);
  await deps.store.logMessage({ kind: "welcome", ok: res.ok, messageId: res.ok ? res.messageId : null, html, error: res.ok ? null : res.error });
  st.logged++;
  if (!res.ok) deps.log("exit alerts: welcome not sent", { error: res.error });
  return res.ok;
}

// ---------------------------------------------------------------- pairing

/** Look for "/start <code>" from a private chat. Returns that chat's id, and moves the update offset past everything read. */
export async function pairFromUpdates(code: string, tg: Telegram, offset: { next: number }): Promise<string | null> {
  const ups = await tg.updates(offset.next);
  if (!ups) return null;
  let chat: number | null = null;
  for (const u of ups) {
    offset.next = Math.max(offset.next, u.id + 1);
    if (chat == null && u.chatType === "private" && u.chatId != null && u.text != null && u.text.trim() === `/start ${code}`) chat = u.chatId;
  }
  return chat == null ? null : String(chat);
}

// ---------------------------------------------------------------- the loop

const EVERY_MS = Number(process.env.EXIT_ALERT_EVERY_SECONDS ?? 120) * 1000;
const PAIRING_EVERY_MS = 20_000;

/**
 * Start the loop; returns a function that stops it. Does nothing (and says so once) when no token is configured.
 *
 * With LAB_SYNC_URL set (the hosted database) this process is a second runner beside the site's own 24/7 check (apps/web/lib/exitTick.ts): what has
 * been seen, claimed and sent, the streaks, the wallet's fills and the record of messages all live in the hosted database, so the two can run at the
 * same time and a level is still reported exactly once (the claim is one row). If the hosted database cannot be reached the pass is skipped: the
 * laptop never falls back to a private state of its own, which could report something twice. Without LAB_SYNC_URL the local database is the state.
 */
export function startExitLoop(db: Db, log: Log): () => void {
  if (process.env.EXIT_ALERTS === "0") return () => undefined;
  if (!readConfig()) {
    log("exit alerts off: no token configured");
    return () => undefined;
  }
  const hostedUrl = process.env.LAB_SYNC_URL;
  const localStore = pgStore(db);
  const st = newPassState();
  const offset = { next: 0 };
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let failures = 0;
  let waiting = false;
  let hosted: pg.Pool | null = null;
  /** the database that holds the state of the alerts */
  const stateStore = (): Store => {
    if (!hostedUrl) return localStore;
    hosted ??= new pg.Pool({ connectionString: hostedUrl, max: 1, statement_timeout: 30_000, idleTimeoutMillis: 20_000, connectionTimeoutMillis: 15_000 });
    return pgStore(hosted as unknown as Db);
  };
  const tick = async (): Promise<number> => {
    if (running) return EVERY_MS;
    running = true;
    try {
      const cfg = readConfig();
      if (!cfg) return EVERY_MS;
      const tg = telegram(cfg.token);
      const store = stateStore();
      const deps: Deps = { store, tg, prices: (m) => dexQuotes(m), log, now: () => Date.now() / 1000 };
      if (!cfg.chatId) {
        if (!cfg.pairCode) {
          if (!waiting) log("exit alerts: a token is set but no chat is paired and there is no pairing code");
          waiting = true;
          return EVERY_MS * 5;
        }
        if (!waiting) log("exit alerts: waiting for the user to open the pairing link");
        waiting = true;
        const chat = await pairFromUpdates(cfg.pairCode, tg, offset);
        if (!chat) return PAIRING_EVERY_MS;
        // paired: remember the chat, drop the code, switch on from now (what is already above a level is listed, not reported)
        setEnvVar(cfg.file, "EXIT_ALERT_CHAT_ID", chat);
        setEnvVar(cfg.file, "EXIT_ALERT_PAIR_CODE", null);
        await store.setArmedAt(deps.now());
        await welcome({ chatId: chat, levels: cfg.levels }, deps, st);
        await tg.updates(offset.next);
        log("exit alerts paired and on", { levels: cfg.levels });
        return 5_000;
      }
      const r = await runPass({ chatId: cfg.chatId, levels: cfg.levels }, deps, st, { persistStreaks: Boolean(hostedUrl) });
      if (failures > 0) log("exit alerts running again", { positions: r.positions });
      failures = 0;
      return EVERY_MS;
    } catch (e) {
      failures++;
      if (failures === 1 || failures % 10 === 0) log("exit alerts failed", { error: String((e as Error)?.message ?? e).slice(0, 160), failures });
      return EVERY_MS;
    } finally {
      running = false;
    }
  };
  const loop = async () => {
    if (stopped) return;
    const next = await tick();
    if (!stopped) timer = setTimeout(() => void loop(), next);
  };
  log("exit alerts on", { everyMs: EVERY_MS, state: hostedUrl ? "hosted database (second runner beside the site's own check)" : "local database" });
  timer = setTimeout(() => void loop(), 10_000);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    void hosted?.end().catch(() => undefined);
  };
}
