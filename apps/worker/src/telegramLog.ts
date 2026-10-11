/**
 * The record of what was sent to Telegram (table telegram_messages, migration 0035): written when a message goes out, copied to the hosted
 * database so the "Telegram" page on the phone shows it. Only the text as the user read it, the kind, the result and the coin/level for an alert:
 * never the bot token, the chat id or an address. An error from Telegram is cleaned of the token by the client before it gets here.
 */

interface Db {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

export type MessageKind = "alert" | "welcome" | "test";

export interface LoggedMessage {
  kind: MessageKind;
  ok: boolean;
  messageId?: number | null;
  symbol?: string | null;
  level?: number | null;
  multiple?: number | null;
  /** the text as sent (with Telegram's HTML tags) */
  html: string;
  error?: string | null;
}

/** The message as the user reads it: tags removed, the three entities Telegram needs turned back. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Best effort: a record that cannot be written must never stop an alert. Returns the row id, or null. */
export async function logMessage(db: Db, m: LoggedMessage): Promise<number | null> {
  try {
    const { rows } = await db.query(
      `INSERT INTO telegram_messages (kind, ok, message_id, symbol, level, multiple, body, error)
       VALUES ($1::text, $2::boolean, $3::bigint, $4::text, $5::numeric, $6::numeric, $7::text, $8::text) RETURNING id`,
      [m.kind, m.ok, m.messageId ?? null, m.symbol ?? null, m.level ?? null, m.multiple ?? null, plainText(m.html).slice(0, 4000), m.error ? m.error.slice(0, 200) : null],
    );
    return rows[0] ? Number(rows[0].id) : null;
  } catch {
    return null;
  }
}

/** Copy the rows the hosted database has not seen yet (same ids), oldest first. Returns how many were copied. */
export async function pushMessages(local: Db, hosted: Db): Promise<number> {
  const have = Number((await hosted.query(`SELECT COALESCE(max(id), 0) AS m FROM telegram_messages`)).rows[0]?.m ?? 0);
  const { rows } = await local.query(
    `SELECT id, sent_at, kind, ok, message_id, symbol, level::float8 AS level, multiple::float8 AS multiple, body, error FROM telegram_messages WHERE id > $1::bigint ORDER BY id LIMIT 200`,
    [have],
  );
  for (const r of rows) {
    await hosted.query(
      `INSERT INTO telegram_messages (id, sent_at, kind, ok, message_id, symbol, level, multiple, body, error)
       VALUES ($1::bigint, $2::timestamptz, $3::text, $4::boolean, $5::bigint, $6::text, $7::numeric, $8::numeric, $9::text, $10::text) ON CONFLICT (id) DO NOTHING`,
      [r.id, r.sent_at, r.kind, r.ok, r.message_id, r.symbol, r.level, r.multiple, r.body, r.error],
    );
  }
  if (rows.length) await hosted.query(`SELECT setval(pg_get_serial_sequence('telegram_messages', 'id'), GREATEST((SELECT max(id) FROM telegram_messages), 1))`);
  return rows.length;
}
