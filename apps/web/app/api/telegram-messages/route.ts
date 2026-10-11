import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";

/**
 * The Telegram messages the system sent (exit alerts, the welcome message, tests), newest first. The laptop writes them when it sends
 * and copies them to the hosted database. Text, kind and result only: never the bot token or the chat.
 */
export async function GET() {
  try {
    const db = getPool();
    const { rows } = await db.query(
      `SELECT id, sent_at, kind, ok, symbol, level::float8 AS level, multiple::float8 AS multiple, body, error FROM telegram_messages ORDER BY sent_at DESC, id DESC LIMIT 100`,
    );
    const stats = (await db.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE ok)::int AS sent, max(sent_at) FILTER (WHERE ok) AS last_sent FROM telegram_messages`)).rows[0];
    return NextResponse.json({ messages: rows, total: stats?.n ?? 0, sent: stats?.sent ?? 0, lastSentAt: stats?.last_sent ?? null }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch {
    // the table does not exist yet (older database) or the database is down: an empty list, not a broken page
    return NextResponse.json({ messages: [], total: 0, sent: 0, lastSentAt: null, error: "log unavailable" }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}
