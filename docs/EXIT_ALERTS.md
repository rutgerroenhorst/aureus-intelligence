# Exit alerts: a Telegram message when a coin you hold reaches 2x or 5x

Added 2026-10-11, after the wallet review (docs/WALLET_REVIEW.md): simple exits would have beaten how the exits really went (+0.10 to +0.31 per
coin), and the leak was coins that spiked for a few hours and were not sold. A phone cannot watch every coin all day; a message at the right
moment can. The message is an idea ("take half out, the money is back"), not an order, and nothing is sold by the system.

## What it does

Every two minutes the site itself (a clock in the hosted database calls it, see "Around the clock" below; the laptop daemon runs the same check as a second
runner) reads what the followed wallet still holds (`wallet_fills`, first in first out), asks DexScreener for the price of each coin (30 a call) and compares it
with what was paid **for what is still held**:

- **Level**: 2x and 5x (`EXIT_ALERT_LEVELS=2,5` in the private file changes it). A level is reported once per position.
- **Position**: a coin plus the time of its oldest lot still held. A sale uses up the oldest tokens first, so a coin sold in full and bought again later is a
  new position at the new price (with the old average a re-buy that is down 90% would have read "8x").
- **Two checks in a row** must show the level (one glitchy print is not a crossing), the pool must be at least $2,000 and at least five times the position,
  and the position must be worth more than $0.30.
- **Already above a level when switched on**: marked as seen, not reported. The welcome message lists them once.
- A coin that jumps over both levels at once gets one message, for the highest.
- Nothing about this changes a filter, a score, a tab or a card.

A message looks like this (Dutch; redesigned 2026-10-11 to read like an app notification: the headline says how far the coin has run, the money sits in one aligned
block, one idea underneath, and the link is a button under the message instead of a line of text):

```
🟢 Normie · 2,9× je instap
2×-drempel gehaald

Waarde nu  $5,76
Inleg      $2,00
Al eruit   $0,00
Op papier  +$3,76 (+188%)

Koers      $0,000729
Instap     $0,000253
Pool       $41K

💡 Haal de helft eruit: dan heb je je inleg terug.
[ 📊 Open in DexScreener ]
```

The icon follows the level (🟢 2×, 🚀 5×, 🔥 10× and up). "Op papier" is what is still held at today's price plus what was already taken out, against what was put in. The idea line follows the lab's
exit research (docs/EXIT_STRATEGY.md, 1,123 coins): half out while the money is not back, and "een stop 40% onder de hoogste koers op de rest" (taking half out beat selling everything at 2× by 6 points of
the stake, the stop under the rest is what makes it work, and a further sale at 5× added nothing measurable). When the money is already back it reads "Je inleg is er (bijna) al uit. Houd een stop 40% onder de
hoogste koers op de rest."; at 5× "Het is een winnaar: houd een stop …". The table is a `<pre>` block (monospace, so the values start in the same
place on every phone); on the Telegram page it is drawn in a monospace font too and the button shows as a plain link. If Telegram ever refuses the button the message is sent again without it,
so an alert is never lost to a link.

## Around the clock: the site checks by itself (2026-10-11)

The check does not depend on the laptop, on a screen being open or on anybody visiting. A clock inside the hosted database (Supabase's `pg_cron`, with
`pg_net` doing the HTTP call; installed by `scripts/cron-setup.ts`) calls `GET /api/cron/exit-alerts` on the site every 2 minutes with the site's secret
(`Authorization: Bearer <CRON_SECRET>`; every other caller gets 401). Vercel's own cron cannot do this on the free plan (once a day at most), which is why the
clock lives in the database. One call (`apps/web/lib/exitTick.ts`) does, in order:

1. **A gate row** in the database, so two calls never run side by side (a call less than 45 seconds after the last one is skipped).
2. **A look at the wallet** for new buys and sells (the light wallet sync: new transactions only), at most every 3.5 minutes, i.e. every other call: the public Solana RPC takes 5 to 10 seconds a call from Vercel, which was most of a call's running time. The time of the last read is in the database (`wallet_watch.synced_at`), whoever made it, so a read by the laptop counts too.
3. **One pass of the exit check**: the same `runPass` the laptop uses (prices, levels, two checks in a row, a claim row, then the Telegram message).
4. **A heartbeat** (`exit_alert_kv.hosted_tick_ok`), which the Telegram page shows as "The site's check ran N min ago" (orange when it is later than expected).

A serverless call can start in a process that never ran before, so nothing that matters is kept in memory: what has been seen and sent (`exit_alerts`), the count
of checks in a row (`exit_alert_kv.streaks`) and the record of messages (`telegram_messages`) all live in the hosted database, and positions are only
recomputed when the fills change. The laptop daemon stays on as a **second runner against the same state**: if both see a crossing, the claim (one row per
position and level, `INSERT ... ON CONFLICT DO NOTHING`) lets exactly one of them send. If the laptop cannot reach the hosted database it skips the pass; it never
keeps a private state of its own, which could report something twice.

`?test=1` on the route sends the test message from the site (proves that the token and the chat set on Vercel work). The measured cost of a call is in
docs/LIMITS.md. To look at the clock: `LAB_SYNC_URL=<hosted connection string> corepack pnpm exec tsx scripts/cron-setup.ts status`; to stop it: `... remove`
(docs/RESTORE.md).

## Secrets: where they live, and what is never done with them

The bot token and the chat id are in **`.env.exit-alerts.local`** in the repository folder (git-ignored by `.env.*.local`; the loop makes the file
readable by the owner only) or in the process environment, and, for the check on the site, in the Vercel project as the production variables
`EXIT_ALERT_TOKEN` and `EXIT_ALERT_CHAT_ID` of type *sensitive* (encrypted; the dashboard and the API cannot show them again). The clock's secret `CRON_SECRET` is
a sensitive Vercel variable too and an encrypted entry in Supabase Vault (`aureus_cron_secret`); the clock reads it from the vault each time it calls the site, so
it is not in the text of any job. The route compares it in constant time. None of these are in git, the database tables, a log, a report or an API answer, and
an error from Telegram is cleaned of the token before anything is logged. Messages only go to `api.telegram.org`, only to the paired chat.

Variables: `EXIT_ALERT_TOKEN` (the bot token from @BotFather), `EXIT_ALERT_CHAT_ID` (set by pairing), `EXIT_ALERT_PAIR_CODE` (one-time, removed by pairing),
`EXIT_ALERT_LEVELS`, `EXIT_ALERT_EVERY_SECONDS` (default 120). `EXIT_ALERTS=0` switches the loop off. These are **not** the `TELEGRAM_*` variables of the
older alert engine (docs/TELEGRAM_SETUP.md), which stays off, so no candidate alerts go to this bot.

## Pairing (no chat id to look up)

The file carries a one-time code. The user opens `https://t.me/<bot username>?start=<code>` and presses Start; Telegram sends "/start <code>" to the bot,
the loop sees it from a **private** chat, stores that chat's id, deletes the code and sends the welcome message. Anyone else who finds the bot gets nothing
(no code), a group chat or a longer message with the code in it is ignored. To pair again (a new phone), put a new `EXIT_ALERT_PAIR_CODE` line in the file and
remove `EXIT_ALERT_CHAT_ID`.

## Running it

The site's own check needs nothing to be started (the clock is in the database). The laptop's loop, the second runner, starts with the daemon. After a reboot:

```
corepack pnpm exec tsx scripts/lab-daemon.ts        # from the repository folder; add LAB_SYNC_URL=... to keep the phone site current too
```

`corepack pnpm exec tsx scripts/exit-alerts-check.ts` shows what the loop sees right now (every held coin, the multiple, whether an alert could go out) without
sending or storing anything. State is in `exit_alerts` and `exit_alert_kv` (migration 0034; counts of what was seeded and sent, no token, no chat id).

## The Telegram page (menu: Tracking > Telegram)

Every message the system sends (an alert, the welcome message, a test) is recorded in `telegram_messages` (migration 0035) with the text as the user read it,
the kind, whether Telegram accepted it and, for an alert, the coin and level; a refused send is recorded too (once per half hour per alert) with Telegram's
reason. The site writes its messages straight to the hosted database; the laptop loop copies its own there (same ids, when `LAB_SYNC_URL` is set), and `/telegram` plus `GET /api/telegram-messages`
show the last 100. No token, chat id or address is ever in that table. Like Results, the page is public for anyone who has the site's address until the site gets
a password, and it shows coin names and amounts. The welcome message sent at pairing predates the log and is not in it.

`corepack pnpm exec tsx scripts/exit-alerts-test.ts` sends a test message to the paired chat (an invented example alert) and records it like any other.

## Limits, honestly

- **It runs on the site, not on the laptop.** What can still stop it: the clock job removed or paused, the site or the hosted database down (Vercel and Supabase
  outages, or a free project paused after a week with no activity at all, which the clock itself prevents), DexScreener or the Solana RPC not answering (then the pass
  prices nothing and tells nobody; the Telegram page shows the check's age but not its prices), or a free-plan limit reached (docs/LIMITS.md: the exit check is
  never held back by the daily budget, but the project would be blocked by Vercel if the month's 4 CPU-hours ran out). The Telegram page's status line is the
  place to look: orange means the heartbeat is more than 8 minutes old.
- **Ceilings** (docs/LIMITS.md): at most 40 alerts in any 24 hours (`EXIT_ALERT_MAX_PER_DAY`), at most 6 per pass with 1.1 seconds between messages, and when Telegram answers "slow down" nothing is sent until the time it names has passed (never more than an hour). A real day brings one to five alerts.
- Prices come from DexScreener every two minutes and a level needs two checks: a spike shorter than about four minutes can be missed, and the message follows
  the price by two to four minutes.
- The multiple is against what the wallet paid (price per token including fees), for the tokens still held; the wallet reader sees a trade within about five minutes.
- A message is an idea. At the user's sizes ($2 to $5 a coin) the sums are small; the evidence is in docs/WALLET_REVIEW.md, and it describes three weeks, not the future.
- Files: `apps/web/lib/exitAlerts.ts` (positions, levels, texts; pure), `apps/worker/src/exitLoop.ts` (Telegram, prices, state, pairing, the loop, `runPass`),
  `apps/web/lib/exitTick.ts` and `apps/web/app/api/cron/exit-alerts/route.ts` (the site's own check), `scripts/cron-setup.ts` (the clock),
  `apps/worker/src/telegramLog.ts` (the record and its copy to the hosted database), `apps/web/app/telegram/page.tsx` and `apps/web/app/api/telegram-messages/route.ts`,
  `scripts/exit-alerts-check.ts`, `scripts/exit-alerts-test.ts`, tests `apps/web/lib/exitAlerts.test.ts`, `apps/web/lib/exitTick.test.ts`, `apps/worker/src/exitLoop.test.ts` and `apps/worker/src/telegramLog.test.ts`.
