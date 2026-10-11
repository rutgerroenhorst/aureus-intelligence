# Exit alerts: a Telegram message when a coin you hold reaches 2x or 5x

Added 2026-10-11, after the wallet review (docs/WALLET_REVIEW.md): simple exits would have beaten how the exits really went (+0.10 to +0.31 per
coin), and the leak was coins that spiked for a few hours and were not sold. A phone cannot watch every coin all day; a message at the right
moment can. The message is an idea ("take half out, the money is back"), not an order, and nothing is sold by the system.

## What it does

Every two minutes the laptop daemon (scripts/lab-daemon.ts, or the worker) reads what the followed wallet still holds (`wallet_fills`, first in
first out), asks DexScreener for the price of each coin (30 a call) and compares it with what was paid **for what is still held**:

- **Level**: 2x and 5x (`EXIT_ALERT_LEVELS=2,5` in the private file changes it). A level is reported once per position.
- **Position**: a coin plus the time of its oldest lot still held. A sale uses up the oldest tokens first, so a coin sold in full and bought again later is a
  new position at the new price (with the old average a re-buy that is down 90% would have read "8x").
- **Two checks in a row** must show the level (one glitchy print is not a crossing), the pool must be at least $2,000 and at least five times the position,
  and the position must be worth more than $0.30.
- **Already above a level when switched on**: marked as seen, not reported. The welcome message lists them once.
- A coin that jumps over both levels at once gets one message, for the highest.
- Nothing about this changes a filter, a score, a tab or a card.

A message looks like this (Dutch):

```
🔔 HYDRA staat nu op 2× je instap (2,0×)
Je hebt er nog $4,20 van · inleg $4,00 · al eruit $0,00
Idee: haal de helft eruit, dan heb je je inleg terug.
Koers $0,0000484 (instap $0,0000237) · pool $38K
https://dexscreener.com/solana/<pool>
```

## Secrets: where they live, and what is never done with them

The bot token and the chat id are only in **`.env.exit-alerts.local`** in the repository folder (git-ignored by `.env.*.local`; the loop makes the file
readable by the owner only) or in the process environment. They are never written to the database, a log, a report or an API answer, and an error from
Telegram is cleaned of the token before anything is logged. Messages only go to `api.telegram.org`, only to the paired chat.

Variables: `EXIT_ALERT_TOKEN` (the bot token from @BotFather), `EXIT_ALERT_CHAT_ID` (set by pairing), `EXIT_ALERT_PAIR_CODE` (one-time, removed by pairing),
`EXIT_ALERT_LEVELS`, `EXIT_ALERT_EVERY_SECONDS` (default 120). `EXIT_ALERTS=0` switches the loop off. These are **not** the `TELEGRAM_*` variables of the
older alert engine (docs/TELEGRAM_SETUP.md), which stays off, so no candidate alerts go to this bot.

## Pairing (no chat id to look up)

The file carries a one-time code. The user opens `https://t.me/<bot username>?start=<code>` and presses Start; Telegram sends "/start <code>" to the bot,
the loop sees it from a **private** chat, stores that chat's id, deletes the code and sends the welcome message. Anyone else who finds the bot gets nothing
(no code), a group chat or a longer message with the code in it is ignored. To pair again (a new phone), put a new `EXIT_ALERT_PAIR_CODE` line in the file and
remove `EXIT_ALERT_CHAT_ID`.

## Running it

The loop starts with the daemon. After a reboot:

```
corepack pnpm exec tsx scripts/lab-daemon.ts        # from the repository folder; add LAB_SYNC_URL=... to keep the phone site current too
```

`corepack pnpm exec tsx scripts/exit-alerts-check.ts` shows what the loop sees right now (every held coin, the multiple, whether an alert could go out) without
sending or storing anything. State is in `exit_alerts` and `exit_alert_kv` (migration 0034; counts of what was seeded and sent, no token, no chat id).

## Limits, honestly

- **It only runs while the laptop is on and awake** (the daemon is a laptop process). A dead battery means no messages, and nothing tells you so. A 24/7 version
  needs a scheduler somewhere else (GitHub Actions or a hosted cron) and the hosted database's password and the bot token stored there: that is the user's decision.
- Prices come from DexScreener every two minutes and a level needs two checks: a spike shorter than about four minutes can be missed, and the message follows
  the price by two to four minutes.
- The multiple is against what the wallet paid (price per token including fees), for the tokens still held; the wallet reader sees a trade within about five minutes.
- A message is an idea. At the user's sizes ($2 to $5 a coin) the sums are small; the evidence is in docs/WALLET_REVIEW.md, and it describes three weeks, not the future.
- Files: `apps/web/lib/exitAlerts.ts` (positions, levels, texts; pure), `apps/worker/src/exitLoop.ts` (Telegram, prices, state, pairing, the loop),
  `scripts/exit-alerts-check.ts`, tests `apps/web/lib/exitAlerts.test.ts` and `apps/worker/src/exitLoop.test.ts`.
