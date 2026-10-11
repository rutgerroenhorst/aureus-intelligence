import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";

/**
 * The Telegram messages the system sent (exit alerts, the welcome message, tests), newest first, and when the site's own exit check last ran
 * (the heartbeat its 24/7 tick leaves in exit_alert_kv). Text, kind and result only: never the bot token or the chat.
 */
export async function GET() {
  try {
    const db = getPool();
    const { rows } = await db.query(
      `SELECT id, sent_at, kind, ok, symbol, level::float8 AS level, multiple::float8 AS multiple, body, error FROM telegram_messages ORDER BY sent_at DESC, id DESC LIMIT 100`,
    );
    const stats = (await db.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE ok)::int AS sent, max(sent_at) FILTER (WHERE ok) AS last_sent FROM telegram_messages`)).rows[0];
    // when the site last ran its own exit check, and what it saw (written by lib/exitTick.ts); absent until the first tick
    let check: { at: string; positions: number | null; priced: number | null; sent: number | null } | null = null;
    try {
      const beat = (await db.query(`SELECT value, updated_at FROM exit_alert_kv WHERE key = 'hosted_tick_ok'`)).rows[0];
      if (beat) {
        const v = JSON.parse(String(beat.value));
        const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
        check = { at: new Date(beat.updated_at).toISOString(), positions: n(v.positions), priced: n(v.priced), sent: n(v.sent) };
      }
    } catch {
      check = null;
    }
    return NextResponse.json({ messages: rows, total: stats?.n ?? 0, sent: stats?.sent ?? 0, lastSentAt: stats?.last_sent ?? null, check }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch {
    // the table does not exist yet (older database) or the database is down: an empty list, not a broken page
    return NextResponse.json({ messages: [], total: 0, sent: 0, lastSentAt: null, check: null, error: "log unavailable" }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}
