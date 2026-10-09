/** pnpm telegram:test — send a single connectivity test message. */
import { TelegramChannel } from "@aureus/notifications";

const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
const chatId = process.env.TELEGRAM_CHAT_ID ?? "";
const enabled = (process.env.TELEGRAM_ENABLED ?? "false") === "true";

if (!enabled || !token || !chatId) {
  console.error("Telegram is not configured. Set TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID and TELEGRAM_ENABLED=true in .env.local.");
  console.error("(Never paste the token into chat or commit it — .env.local is gitignored.)");
  process.exit(1);
}

const ch = new TelegramChannel({ token, chatId, enabled });
const res = await ch.testConnection();
if (res.ok) {
  console.log(`OK — message ${res.messageId} delivered.`);
} else {
  // res.error is already sanitized to never contain the token.
  console.error(`FAILED — ${res.error}`);
  process.exitCode = 1;
}
