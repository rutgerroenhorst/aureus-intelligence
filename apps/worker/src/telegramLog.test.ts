import { describe, it, expect } from "vitest";
import { logMessage, plainText, pushMessages } from "./telegramLog";

type Row = Record<string, any>;

/** A tiny stand-in for the table: remembers inserts, answers the two selects the log uses. */
function fakeDb(initial: Row[] = []) {
  const rows: Row[] = [...initial];
  let seq = Math.max(0, ...initial.map((r) => r.id));
  const calls: string[] = [];
  return {
    rows,
    calls,
    query: async (text: string, params: unknown[] = []) => {
      calls.push(text.trim().split(/\s+/).slice(0, 3).join(" "));
      if (/^\s*INSERT INTO telegram_messages \(kind/.test(text)) {
        const [kind, ok, message_id, symbol, level, multiple, body, error] = params;
        const row = { id: ++seq, sent_at: "2026-10-11T02:00:00Z", kind, ok, message_id, symbol, level, multiple, body, error };
        rows.push(row);
        return { rows: [{ id: row.id }] };
      }
      if (/^\s*INSERT INTO telegram_messages \(id/.test(text)) {
        const [id, sent_at, kind, ok, message_id, symbol, level, multiple, body, error] = params;
        if (!rows.some((r) => r.id === Number(id))) rows.push({ id: Number(id), sent_at, kind, ok, message_id, symbol, level, multiple, body, error });
        return { rows: [] };
      }
      if (/max\(id\), 0\) AS m/.test(text)) return { rows: [{ m: Math.max(0, ...rows.map((r) => r.id)) }] };
      if (/FROM telegram_messages WHERE id >/.test(text)) return { rows: rows.filter((r) => r.id > Number(params[0])).sort((a, b) => a.id - b.id) };
      return { rows: [] };
    },
  };
}

describe("the record of what was sent", () => {
  it("turns a Telegram message into the text the user read", () => {
    expect(plainText("\ud83d\udd14 <b>HYDRA</b> staat nu op <b>2\u00d7</b> je instap\nhttps://dexscreener.com/solana/PAIR")).toBe("\ud83d\udd14 HYDRA staat nu op 2\u00d7 je instap\nhttps://dexscreener.com/solana/PAIR");
    expect(plainText("&lt;b&gt;&amp;evil")).toBe("<b>&evil");
  });

  it("writes the kind, the result, the coin and the text without tags, and returns the row id", async () => {
    const db = fakeDb();
    const id = await logMessage(db, { kind: "alert", ok: true, messageId: 55, symbol: "HYDRA", level: 2, multiple: 2.1, html: "<b>HYDRA</b> 2\u00d7" });
    expect(id).toBe(1);
    expect(db.rows[0]).toMatchObject({ kind: "alert", ok: true, message_id: 55, symbol: "HYDRA", level: 2, body: "HYDRA 2\u00d7", error: null });
  });

  it("keeps a failed send with Telegram's reason, and never throws when the database refuses", async () => {
    const db = fakeDb();
    await logMessage(db, { kind: "test", ok: false, html: "x", error: "Bad Request: chat not found" });
    expect(db.rows[0]).toMatchObject({ ok: false, error: "Bad Request: chat not found", message_id: null });
    const broken = { query: async () => { throw new Error("relation does not exist"); } };
    expect(await logMessage(broken, { kind: "test", ok: true, html: "x" })).toBeNull();
  });

  it("copies to the hosted database only what it has not got, keeping the ids, and is idempotent", async () => {
    const local = fakeDb([
      { id: 1, sent_at: "a", kind: "welcome", ok: true, message_id: 1, symbol: null, level: null, multiple: null, body: "w", error: null },
      { id: 2, sent_at: "b", kind: "alert", ok: true, message_id: 2, symbol: "X", level: 2, multiple: 2.1, body: "a", error: null },
      { id: 3, sent_at: "c", kind: "test", ok: true, message_id: 3, symbol: null, level: null, multiple: null, body: "t", error: null },
    ]);
    const hosted = fakeDb([{ id: 1, sent_at: "a", kind: "welcome", ok: true, message_id: 1, symbol: null, level: null, multiple: null, body: "w", error: null }]);
    expect(await pushMessages(local, hosted)).toBe(2);
    expect(hosted.rows.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(await pushMessages(local, hosted)).toBe(0);
    expect(hosted.rows).toHaveLength(3);
  });
});
