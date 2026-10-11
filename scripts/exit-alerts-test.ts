/**
 * Send one test message to the paired Telegram chat, and record it like any other message (the Telegram page shows it).
 *
 *   corepack pnpm exec tsx scripts/exit-alerts-test.ts
 *
 * Needs the private file .env.exit-alerts.local with the token and the paired chat (docs/EXIT_ALERTS.md). With LAB_SYNC_URL set the record is
 * copied to the hosted database too. Prints the result only: never the token, never the chat id.
 */
import pg from "pg";
import { readConfig, telegram } from "../apps/worker/src/exitLoop";
import { logMessage, pushMessages } from "../apps/worker/src/telegramLog";
import { loggedText, testButtons, testText } from "../apps/web/lib/exitAlerts";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://aureus:aureus@localhost:5432/aureus", max: 2 });

async function main() {
  const cfg = readConfig();
  if (!cfg) throw new Error("no token: see docs/EXIT_ALERTS.md");
  if (!cfg.chatId) throw new Error("not paired yet: open the pairing link first (docs/EXIT_ALERTS.md)");
  const html = testText();
  const buttons = testButtons();
  const res = await telegram(cfg.token).send(cfg.chatId, html, { buttons });
  await logMessage(pool, { kind: "test", ok: res.ok, messageId: res.ok ? res.messageId : null, html: loggedText(html, buttons), error: res.ok ? null : res.error });
  console.log(res.ok ? `test message sent (Telegram message ${res.messageId})` : `NOT sent: ${res.error}`);
  const url = process.env.LAB_SYNC_URL;
  if (url) {
    const hosted = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 15_000 });
    try {
      console.log(`copied to the hosted database: ${await pushMessages(pool, hosted as never)} record(s)`);
    } finally {
      await hosted.end().catch(() => undefined);
    }
  }
  await pool.end();
  if (!res.ok) process.exitCode = 1;
}

main().catch(async (e) => {
  console.error(String((e as Error)?.message ?? e));
  await pool.end().catch(() => undefined);
  process.exit(1);
});
