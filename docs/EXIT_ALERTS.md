# Exit alerts: Telegram messages for the coins you hold (a ladder of levels, a line under the price, a loss message)

Added 2026-10-11, after the wallet review (docs/WALLET_REVIEW.md): simple exits would have beaten how the exits really went (+0.10 to +0.31 per
coin), and the leak was coins that spiked for a few hours and were not sold. A phone cannot watch every coin all day; a message at the right
moment can. **Rebuilt 2026-10-13** after the research in docs/ALERT_REDESIGN.md, docs/EXIT_PRACTICE.md and docs/WALLET_REVIEW_2.md, for the way the owner really trades: in the FOMO app,
which has **no stop, take-profit or limit order on a memecoin** (only buy and sell, by percentage). So the site is the stop: it watches the price and says, once, with sound, when it is time to sell
the rest. A message is an idea ("sell half, the stake is back"), not an order, and nothing is sold by the system.

## What it does

Every two minutes the site itself (a clock in the hosted database calls it, see "Around the clock" below; the laptop daemon runs the same check as a second
runner) reads what the followed wallet still holds (`wallet_fills`, first in first out), asks DexScreener for the price of each coin (30 a call) and compares it
with what was paid **for what is still held**. It sends four kinds of message:

| kind | when | sound | what it says |
| --- | --- | --- | --- |
| **first profit** | the first level of the ladder (2×) is reached, two checks in a row | yes | "Sell **50%** of what you hold now (≈ $x). Cost ≈ $0.10. Then your stake is back and the rest runs free." And the line: "I warn you when the price falls under 1.5×." |
| **next step** | each further level of the ladder: 3×, 5×, 10×, 20×, 50×, 100× | no | the line moves up (75% of the level: 3× → 2.3×, 5× → 3.8×, 10× → 7.5×); at 10× an optional "sell 25% more" when that slice is worth at least $2.50 |
| **line reached** | the price has fallen to the line (75% of the highest level reported) and is still there 25 seconds later | yes | "Sell the rest (**100%**) now: ≈ $x. Cost ≈ $y." |
| **loss** | a position under 72 hours old that has fallen to 0.7× of what was paid without ever having passed 2×, two checks in a row | no | "Sell everything (100%) ≈ $x" with the lab's number: of the lab coins that fell 30% below the first look in their first days, 79% ended at half or lower, 10% came back to 1× or more |

Every message has the same shape: a dot of colour and `TICKER · koers 3,0×` (green first profit, blue next step, red line, orange loss); one line with **the owner's result** (`Jouw resultaat: +$3,76 (+188%) op papier`: what
is held at today's price plus what was already taken out, against what was put in; lower than the coin's multiple once part was sold early); one quote with the action as a percentage of what is held *now* (that is what the app sells)
with the dollars it brings in and what the order costs; the line; the pool in small print. Buttons: **Open in FOMO** (the app's own share link without the owner's handle and the time, `https://fomo.family/coin?address=<mint>&chainId=1399811149`, Solana is 1399811149; it opens
as a universal link), **DexScreener**, and **Kopieer adres** (a copy button, Bot API 7.11, so the address can be pasted into the app's search). Button colours (Bot API 9.4): green for first profit, blue for the steps, red for the line and the loss.

```
🟢 Normie · koers 2,1×
Jouw resultaat: +$2,20 (+110%) op papier

Verkoop 50% van wat je nu hebt (≈ $2,10). Kosten ≈ $0,10.
Dan heb je je inleg terug en loopt de rest gratis mee.

Ik waarschuw je als de koers onder 1,6× ($0,0000363) zakt.

Pool $38K
[ Open in FOMO ]  [ DexScreener ]
[ Kopieer adres ]
```

(The sample is the test message's invented coin; the real text is `alertMessage` in `apps/web/lib/exitAlerts.ts`, with a test for every kind.)

### The rules behind it

- **Ladder**: 2, 3, 5, 10, 20, 50, 100 (`EXIT_ALERT_LEVELS=…` in the private file or the Vercel variables changes it). A level is reported once per position. A coin that jumps over several levels in one go gets one message, for the highest. A log ladder
  sends about 1.6 times the messages of "2× and 5×" (0.42 per coin followed against 0.26); every whole x would have sent four times as many (docs/ALERT_REDESIGN.md).
- **Position**: a coin plus the time of its oldest lot still held. A sale uses up the oldest tokens first, so a coin sold in full and bought again later is a
  new position at the new price (with the old average a re-buy that is down 90% would have read "8×"). The multiple is the coin's price over the price paid per token **for the tokens still held**; selling part does not change it.
- **Two checks in a row** must show the level (one glitchy print is not a crossing), the pool must be at least $2,000 and at least five times the position,
  and the position must be worth at least **$2** (an order costs at least $0.10, which is 5% of $2; it was $0.30).
- **The line is the site's stop.** 75% of the highest level reported (`LINE_FACTOR`), kept in the database (`exit_alert_kv 'lines'`) per position. It is *armed* only after the price has been above it, so a position that was already under its line when it was first
  seen is never announced. When the price is at or under the line the site waits **25 seconds**, looks once more (a false "sell now" costs the owner an order) and only then sends, once per position and level (the claim is the negative level `−top` in `exit_alerts`).
  75% of the level kept most of a run and was as good as a continuous 40% trail on the lab's coins; the line is a rule of thumb, not a prediction.
- **The sale advice** is always a round percentage of what is held now with the dollars and the order's cost (flat $0.10, plus about 1% from $8 up: `orderFeeUsd`, measured on 113 of the owner's own trades). A slice worth less than $2.50 is not advised (the fee would be 4% or more of it); then
  the message says the rest is small and what selling costs.
- **The loss message** (new 2026-10-13, quiet, once per position; the claim is the level −0.7): only for a position under 72 hours old that has not passed 2×, at 0.7× or lower, worth at least $1, in a pool of at least $2,000 and five times the position, after two checks.
  Why: of the owner's 200 coins since August, 78% were never sold at all and those lost 81% of the money put in; in the lab 89% of coins fell 30% below the first look within three days and 79% of those ended at half or lower; a hard stop was worth 8 to 14 points of the stake against holding, and
  the −30% stop on a fresh position was the one measured improvement (+3 points, interval 1 to 4). It is an idea, and only a small one. **`EXIT_ALERT_LOSS=0` switches it off** (the laptop's private file, or the Vercel variable for the site's check).
- **Switching on is silent.** A position that had already passed a level when the alerts (or the new ladder) were switched on is marked as seen, not reported; the ladder seeding is done once (`exit_alert_kv 'ladder_v2'`) and a position that is already under 0.7× at that moment does not get a loss message.
  The welcome message lists what was above the first level.
- Nothing about this changes a filter, a score, a tab or a card.

### What the research says, and what it does not

The numbers behind these choices are in docs/ALERT_REDESIGN.md and docs/EXIT_PRACTICE.md, on coins whose 72 hours were over (a coin that died is decided at once, a living one only after 72 hours, so a sample of "decided" coins that is too young is full of dead ones: an earlier version
of these numbers had that flaw and was withdrawn). Short version: every exit rule loses on average on these coins; selling nothing is clearly worse than any exit; protecting the rest after the first sale is worth about 5 points of the stake; 50%, 75% and 100% sold at the first alert are the same on average;
more rungs do not help; the one measured improvement is the −30% stop on a fresh position. At stakes of $2 to $5 every difference is cents: what is bought, and when, matters more than how it is sold.

### Not built (said in the proposal, left out on purpose)

The share picture, the daily and weekly summaries, the "danger" messages (pool halved, creator selling), quiet hours and an English version. Nobody asked for them in the "add everything" answer of 2026-10-13 that fixed the standard choices (50% at 2×, the log ladder, Dutch, no quiet hours, the "Open in FOMO" button), and a
message that is wrong costs more than a feature that is missing.

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

### The watchdog: a message when the check itself stops (2026-10-12)

The site cannot tell you that the site has stopped, so a second clock does: **`aureus-watchdog`**, a pg_cron job inside the database that runs every 5 minutes (`db/hosted/watchdog.sql`, installed by
`scripts/cron-setup.ts` when it is given the bot token and the chat in its environment). It reads the heartbeat the check leaves after every finished pass and messages the user on Telegram, from the
database, through pg_net:

- **"Exit-controle staat stil"** when no pass has finished for more than 10 minutes (the clock calls the site every 2): the site, Vercel, the secret or the database connection is broken;
- **"Exit-controle krijgt geen prijzen"** when passes finish but for 15 minutes in a row not one held coin got a price (DexScreener not answering);
- once when a problem starts, again after 6 hours if it is still there ("Nog steeds"), and **"Exit-controle loopt weer"** with how long it lasted when it is over; a blip that ends before it is worth mentioning is
  never mentioned. The state is the row `exit_alert_kv 'watchdog'`.

The bot token and the chat id are kept in **Supabase Vault** (`aureus_telegram_token`, `aureus_telegram_chat`; encrypted, readable only by the database's own privileged role, not by the site's role) and read
each time the watchdog has something to say; they are in no message, log, state row or job text. What it cannot do: if the database itself (or Supabase's cron) is down, nothing can tell you; it does not watch
the laptop; and it does not know whether the prices are right, only that there are some. `scripts/cron-setup.ts status` shows whether it is installed, whether it has its secrets and what it thinks of the check;
`scripts/cron-watchdog-test.ts` checks its logic against a scratch database (26 checks); a silent test message is `select public.aureus_watchdog(true, 'test_hb', 'test_watchdog')` after writing a stale `test_hb` row.

`?test=1` on the route sends the test message from the site (proves that the token and the chat set on Vercel work). The measured cost of a call is in
docs/LIMITS.md. To look at the clock: `LAB_SYNC_URL=<hosted connection string> corepack pnpm exec tsx scripts/cron-setup.ts status`; to stop it: `... remove`
(docs/RESTORE.md).

## Secrets: where they live, and what is never done with them

The bot token and the chat id are in **`.env.exit-alerts.local`** in the repository folder (git-ignored by `.env.*.local`; the loop makes the file
readable by the owner only) or in the process environment, and, for the check on the site, in the Vercel project as the production variables
`EXIT_ALERT_TOKEN` and `EXIT_ALERT_CHAT_ID` of type *sensitive* (encrypted; the dashboard and the API cannot show them again). The clock's secret `CRON_SECRET` is
a sensitive Vercel variable too and an encrypted entry in Supabase Vault (`aureus_cron_secret`); the clock reads it from the vault each time it calls the site, so
it is not in the text of any job. Since 2026-10-12 the token and the chat id are also in Supabase Vault (`aureus_telegram_token`, `aureus_telegram_chat`), for the watchdog (below): so the bot token now
lives in three places (the private file, Vercel, Vault); revoking it in BotFather and putting the new one in all three is how to rotate it. The route compares it in constant time. None of these are in git, the database tables, a log, a report or an API answer, and
an error from Telegram is cleaned of the token before anything is logged. Messages only go to `api.telegram.org`, only to the paired chat.

Variables: `EXIT_ALERT_TOKEN` (the bot token from @BotFather), `EXIT_ALERT_CHAT_ID` (set by pairing), `EXIT_ALERT_PAIR_CODE` (one-time, removed by pairing),
`EXIT_ALERT_LEVELS` (default `2,3,5,10,20,50,100`), `EXIT_ALERT_LOSS` (`0` switches the loss message off; read by the laptop's loop and by the site's own check), `EXIT_ALERT_EVERY_SECONDS` (default 120). `EXIT_ALERTS=0` switches the loop off. These are **not** the `TELEGRAM_*` variables of the
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
- **Ceilings** (docs/LIMITS.md): at most 40 alerts in any 24 hours (`EXIT_ALERT_MAX_PER_DAY`), at most 6 per pass with 1.1 seconds between messages, and when Telegram answers "slow down" nothing is sent until the time it names has passed (never more than an hour). With the ladder a real day brings a few messages; the first-profit and line messages have sound, the steps and the loss message do not.
- Prices come from DexScreener every two minutes and a level needs two checks: a spike shorter than about four minutes can be missed, and the message follows
  the price by two to four minutes. The line message follows a fall by two minutes at most plus the 25-second second look. In the lab's data a fill five minutes late was assumed everywhere; the owner's own app is slower or faster than that depending on the minute.
- **A coin with several pools** can be answered by DexScreener's batch endpoint with a dead bonding-curve pair that has no price (found 2026-10-13 with $VEIL, a graduation that went about 50×). The price step then asks the other endpoint (`latest/dex/tokens/<mint>`, every pool) for at most 8 such coins a pass
  (`apps/web/lib/dexPairs.ts`); before this fix a held coin like that would never have produced a message.
- **Not tested on a phone yet**: the colour of the buttons, the copy button and the quote blocks follow the Bot API; if a phone refuses one of them the message is sent again with fewer features, down to plain text, and is never lost.
- The multiple is against what the wallet paid (price per token including fees), for the tokens still held; the wallet reader sees a trade within about five minutes.
- A message is an idea. At the user's sizes ($2 to $5 a coin) the sums are small; the evidence is in docs/WALLET_REVIEW.md and docs/WALLET_REVIEW_2.md, and it describes a few weeks, not the future.
- Files: `apps/web/lib/exitAlerts.ts` (positions, levels, line, loss rules and texts; pure), `apps/web/lib/dexPairs.ts` (the price fallback), `apps/worker/src/exitLoop.ts` (Telegram client with buttons and silent sends, prices, state, pairing, the loop, `runPass`),
  `apps/web/lib/exitTick.ts` and `apps/web/app/api/cron/exit-alerts/route.ts` (the site's own check), `scripts/cron-setup.ts` (the clock),
  `apps/worker/src/telegramLog.ts` (the record and its copy to the hosted database), `apps/web/app/telegram/page.tsx` and `apps/web/app/api/telegram-messages/route.ts`,
  `scripts/exit-alerts-check.ts`, `scripts/exit-alerts-test.ts`, `scripts/exit-alerts-dryrun.ts` (what would the alerts send right now, on the real data, nothing written, nothing sent), tests `apps/web/lib/exitAlerts.test.ts`, `apps/web/lib/exitTick.test.ts`, `apps/worker/src/exitLoop.test.ts` and `apps/worker/src/telegramLog.test.ts`.
