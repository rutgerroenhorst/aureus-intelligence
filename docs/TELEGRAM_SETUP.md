# TELEGRAM_SETUP.md — connect Aureus alerts to Telegram

Secrets live **only** in `.env.local` (gitignored). Never paste your bot token
into chat, code, or the database — the app never logs or stores it.

## Steps

1. **Open BotFather.** In Telegram, search for `@BotFather` and start a chat.
2. **Create a bot.** Send `/newbot`, choose a name and a username. BotFather
   replies with a **bot token** like `123456789:AA...`.
3. **Put the token in `.env.local`:**
   ```
   TELEGRAM_BOT_TOKEN=123456789:AA...your token...
   ```
4. **Send your bot a message.** Open your new bot (the `t.me/<username>` link from
   BotFather) and send it any message (e.g. "hi"). This lets the bot see your chat.
5. **Get your chat ID.** Visit (in a browser, replacing `<TOKEN>`):
   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```
   Find `"chat":{"id":<NUMBER>,...}` in the JSON. That number is your chat ID.
   Put it in `.env.local`:
   ```
   TELEGRAM_CHAT_ID=<NUMBER>
   ```
6. **Enable delivery:**
   ```
   TELEGRAM_ENABLED=true
   ```
7. **Test it:**
   ```bash
   pnpm telegram:test
   ```
   You should receive: **"Aureus Intelligence Telegram connection successful."**
   (`OK — message <id> delivered.` in the terminal.)
8. **Start the worker** so alerts flow as candidates transition:
   ```bash
   pnpm worker:start
   ```
   Re-seed once so `/system` reflects the enabled channel: `pnpm db:seed`.

## Tuning
- `TELEGRAM_MIN_ALERT_LEVEL` (default `WATCH`) — minimum level delivered.
  Order: `INFO < WATCH < HIGH_PRIORITY < ENTRY_READY < RISK`.
- `TELEGRAM_COOLDOWN_MINUTES` (default `15`) — per-candidate, per-level cooldown.
  `RISK` alerts bypass cooldown.

## If Telegram is not configured
The app keeps working. Notification mode is **DEGRADED**, shown on `/system`, and
alert *events* are still recorded (visible on `/alerts`) — they're just not
delivered. Nothing crashes.

## What will (and won't) alert
Alerts require a real state transition + rule evidence + fresh data. With **no
Helius key**, candidates stay `UNRESOLVED`, so **no WATCH/ENTRY/ENTRY_READY alerts
fire** — this is intended. Wire Helius (next increment) to see the full alert flow
on live data. You can validate the whole delivery path now via the test suite,
which uses a fake transport.
