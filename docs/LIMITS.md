# Free-plan limits: what we use, what keeps us under them, what to do if a warning comes

Written 2026-10-11 after the user asked that no message about a limit ever arrives and that nothing starts costing money. Everything here runs on free plans.
The numbers were measured on that day (Vercel's usage API, the hosted database, a production build run against it); the limits are the plans' published ones at
the time of writing and should be checked on the dashboards when a plan changes. Updated the same evening after the site began to run by itself around the clock
(the exit check every 2 minutes, a market scan once an hour): see "The clock" below for what that costs and what it changed.

## The short version

- **Nothing in the code or the Vercel settings costs money.** No paid API key is used or configured (searched the code; the Vercel project only has the database
  address, the two free data sources' base addresses, the site's own address, and the retention and storage settings). No scheduled GitHub jobs. PumpPortal is read
  with its two free subscriptions only (new tokens, migrations); its paid trade subscriptions are not used. Telegram's Bot API is free.
- **The two limits that can actually be reached** are Vercel's CPU time (4 hours a month; beyond it the project is blocked for 30 days) and Supabase's data sent out
  (5 GB a month). Both now have a meter and an automatic brake (below). Today's real use is a small fraction of both.
- Nothing is silently relied on: `scripts/limits-check.ts` and the Ops page show the numbers whenever you want to look.
- **The site now runs by itself, day and night** (a clock in the database, docs/EXIT_ALERTS.md): the Telegram exit check every 2 minutes and, while nobody has a screen
  open, a market scan once an hour plus the tracking of followed coins every half hour. It is the biggest regular user of the Vercel limits (first 12 hours: 363 exit
  checks, all answered, about 86 ms of CPU each) and it is what made the database's growth visible (below).

## Service by service

| service (plan) | limit | use on 2026-10-11 | what keeps it under |
| --- | --- | --- | --- |
| **Supabase** database size (Free) | 500 MB; over it the project turns read-only | 113 MB in the morning, **158 MB (32%)** that evening; with the site scanning around the clock it grew 40-60 MB a day | scans pause at 440 MB (`SCAN_STORAGE_LIMIT_MB`); history older than `RETENTION_DAYS` (now **4**, was 7) is deleted, and since migration 0036 that includes the rule-evaluation log, which had been growing without limit (14 MB a day); the unattended market scan is hourly; hosted lab rows are pruned |
| **Supabase** data sent out ("egress", Free) | 5 GB a month | the hosted site read about 1.9 million rows in 3 days (an estimated 3-4 GB a month at that pace, much of it the lab re-reading every lesson); one Radar bundle reads ~0.2 MB there | **meter** (exact bytes per day, `usage:egress:` rows) and a **daily brake of 100 MB** (about 3 GB a month): over it the scan and the learning tick stretch x4, the lab and catch-up rounds stop, the Radar bundle is kept 5 minutes; plus the reductions below |
| **Supabase** pause | a free project with no activity for a week is paused (restorable in the dashboard, nothing is lost) | the clock calls the site every 2 minutes and every call reads the database, so the project is never idle | Supabase's own definition of "activity" is theirs; if a pause mail ever arrives, restore the project in its dashboard (nothing is lost) |
| **Vercel** function invocations (Hobby) | 1,000,000 a month | 5,553 so far this month (0.6%); the clock adds about 770 a day (720 exit checks, 24 maintenance, 24 learning), roughly 23,000 a month (2.3%) | polling helper: nothing is asked while a tab is hidden, slower when idle, **nothing after two hours untouched** |
| **Vercel** Active CPU (Hobby) | 4 hours a month; **blocked 30 days beyond it** | counted per day: 28 s, 120 s, 169 s (the last one includes 12 hours of the exit check); the exit check averaged 86 ms a call over 180 calls = about 62 s a day (0.5 h a month, 13% of the allowance); a page request costs 3 to 25 ms, a Radar bundle 143 ms | daily CPU budget (**240 s**, interval stretches x4 beyond it; the exit check is counted in it but never held back by it); idle back-off and stop on the pages; the bundle is built at most once a minute |
| **Vercel** function time ("provisioned memory", Hobby) | 360 GB-hours a month | 1.1 GB-hours in the month's first ten days, **2.7 GB-hours after the first 12 hours of the clock** (about 3 GB-hours a day at an average of 6.6 s a call, i.e. 95 a month, a quarter of the allowance) | a call's running time was mostly waiting for the Solana RPC: the wallet is now read only when its last read is older than 3.5 minutes and the pause between price batches is shorter. After that: **1.7 s a call on average** (last 14 calls), about 0.7 GB-hours a day, roughly 20 a month (6%); `limits-check.ts` prints the month's number |
| **Vercel** cron (Hobby) | once a day at most (documented), with up to an hour of imprecision | not used | the clock is Supabase's `pg_cron` instead (free, in the database), calling the site; every call is an ordinary invocation counted above |
| **Supabase** `pg_cron`, `pg_net`, Vault (Free) | part of the plan | six jobs (the watchdog runs every 5 minutes and only reads two small rows unless it has something to say; the graduation feed every 3 minutes, see 11 below); the run history (about 1,000 rows a day) is deleted after 2 days by its own job; pg_net keeps answers 6 hours | nothing to do |
| **Vercel** bandwidth (Hobby) | 100 GB a month | 0.03 GB | pages are small (the Radar answer is ~100 KB) |
| **Vercel** builds and deployments (Hobby) | 100 deployments a day | about 10 a day on busy days | one push per change; wait a few minutes between pushes (GitHub also rate-limits fast repeated pushes, which once made a build fail) |
| **GitHub** (public repository) | no Actions in use; push rate limits | no workflows | none needed |
| **DexScreener** (free, keyless) | 300 requests a minute for pairs, 60 for profiles, boosts, orders and metas | the worker's limiter is set to exactly those; the lab daemon adds up to 15 a minute; the exit alerts 3 a minute; one refused request was recorded in 3 days | a refusal is a short pause, not a cost; limiters per source |
| **GeckoTerminal** (free, keyless) | about 30 calls a minute for everything on one address | the worker's limiter allows 10 a minute; the network ranking 1.5 a minute; other tools share the address, so refusals (429) happen | retried with pauses; a network that cannot be read keeps its last reading for 30 minutes; nothing here can bill |
| **Jupiter** lite, **RugCheck**, **DefiLlama**, alternative.me (free) | modest published rates (Jupiter lite: about 60 requests a minute) | a handful of calls every 10 to 60 minutes; the graduation feed one Jupiter call per 50 coins every 3 minutes; the Check button 2 Jupiter calls and 1 RugCheck call per press; the red-flag gate's holder step (2026-10-16, docs/RED_FLAGS.md): RugCheck (its limit is 15 requests in a window of about a second) one request start every 130 ms, 4 at a time and at most 300 a minute for the whole site, each coin once per 30 minutes while it is on a tab, a 429 stops it for 15 seconds (5 minutes after three refused tries in a row), plus one `lab_reports` row (kind `holders`, about 70 bytes a coin) written at most every 2 minutes and read once per cold start | spaced by the lab collectors (RugCheck 8 calls a round); the Check button is capped at 15 presses a minute for the whole site and a repeat within a minute is answered from the first |
| **Solana RPC** (public endpoints) | rate limited per address | the wallet reader asks for new transactions every 5 minutes; the graduation feed asks one signature list and a few transactions every 3 minutes | paced per endpoint, falls back across endpoints |
| **PumpPortal** (free stream) | one connection at a time (more can get the address banned for an hour) | one, held by a database lock | the lock; only `subscribeNewToken` and `subscribeMigration` are used |
| **Telegram Bot API** (free) | about 30 messages a second overall, one a second to one chat | 3 alerts and 2 tests in the first day | spacing of 1.1 s, a **ceiling of 40 alerts in 24 hours**, and Telegram's own "slow down" answer is obeyed (up to an hour) |
| **Helius** (optional key) | free credits if a key is ever added | not configured | none needed |

## What changed on 2026-10-11 to stay inside the limits

1. **Meter and brake for the data the hosted database sends** (`packages/db`: bytes counted on the pool's sockets; `lib/cloudScan.ts`: a daily allowance, flat 100 MB until 2026-10-16, since then the rolling month of item 14).
2. **The hosted lab recomputes its analyses every 6 hours instead of every time 12 lessons changed.** Each recompute reads all lessons (about 6 MB and growing); it was
   running about ten times a day, roughly half of everything the site read. The laptop still recomputes about hourly (reading there is free).
3. **The Radar's bundle is kept for a minute on the hosted site** (it was 15 seconds) and the edge may keep a complete answer for 30 seconds; the Radar asks every 30 seconds
   (it was 20); the Telegram page every minute; the Learning page every 2 minutes (the analyses change hourly).
4. **Screens untouched for two hours stop asking** until touched again (a tab left open for days read from the database all night).
5. **The hosted site refreshes the network ranking itself only when it is 20 minutes old** (the laptop does it every 4 minutes), because a refresh takes ~20 seconds of function time.
6. **Telegram**: daily ceiling, "slow down" obeyed, one message a second at most.
7. The Ops page shows the usage; `scripts/limits-check.ts` prints it with Vercel's own counters.
8. **The clock** (evening): `scripts/cron-setup.ts` installs four jobs in the hosted database (docs/EXIT_ALERTS.md, docs/RESTORE.md to stop them). The first 12 hours: 363 exit checks
   and 24 maintenance calls, every one answered, none timed out, one real alert sent by the site while the laptop was off (Normie at 2.9x).
9. **What the clock showed about storage**: the hosted site scans whenever the laptop does not (the laptop was off from morning to evening), and with a screen open as well
   it wrote about 4,000 coin checks a day, 13 KB each (feature values 33 MB, rule evaluations 27 MB, scores 18 MB, raw events 18 MB after three days). Everything except the
   rule-evaluation log was already cut off at `RETENTION_DAYS`; that log was not, so the database would have reached its 440 MB brake in about a week and then stopped
   scanning for good (deleted rows are reused, the file does not shrink). Fixed with migration `0036_prune_rule_evaluations.sql` (the newest verdict of every rule of every
   candidate is always kept, exactly like the other tables), `RETENTION_DAYS` 7 to 4, and an hourly unattended scan. The laptop database is never pruned.
10. **The exit check's running time**: the wallet (public Solana RPC, 5 to 10 seconds a call from Vercel) is read at most every 3.5 minutes instead of every call, the pause between
    DexScreener batches went from 0.4 to 0.15 s; the page shows a warning when the check ran but got no prices.
11. **The graduation feed** (2026-10-12): a sixth job, `aureus-graduates`, calls `/api/cron/graduates` every 3 minutes and reads pump.fun's graduations from the chain (docs/GRADUATIONS_FEED.md),
    so the Graduations tab no longer needs the laptop. First live ticks: 7.0 s and 360 ms of CPU for the first tick (23 graduations to catch up), then **0.6 s and 71 ms of CPU on average** over the
    next 14 ticks (at most 0.9 s and 182 ms). At 480 ticks a day that is about 34 s of CPU a day (0.3 hours a month of the 4), about 5 minutes of function time a day, 14,400
    invocations a month; its CPU is added to the daily budget. It writes `pump_graduates.facts` (about 300 bytes per coin, rows older than 4 days deleted). The Graduations list reads the chain rows
    (about 25 KB for 41 coins, growing to roughly 70 KB over six hours) only while the laptop's snapshot is not fresh. **The day's database egress was 76 MB of the 100 MB daily brake by 09:30 UTC**
    (open screens: a Radar build reads 5 to 40 KB a minute); yesterday ended at 113 MB, so the brake is already doing its job on days with screens open all day, and the month (5 GB) is not at risk.
12. **The Check button now asks four sources** (DexScreener, Jupiter twice, RugCheck, the database): at most 15 presses a minute for the whole site (it was 30 for one source).

13. **The Radar's brake and what a build reads (2026-10-16)**: the owner: "I no longer see coins leave or arrive". The day's egress meter had crossed the 100 MB brake at 15:56 UTC (104 MB by 16:00; the six days since 2026-10-11 ended at 107, 133, 128, 116, 114 and about 105 MB, so the brake engaged every afternoon) and a flat five-minute keep froze the lists. The cause was the size of a build: measured on the hosted database with `pg_stat_statements` before and after one build,
    a build read the base list five times (206 rows, 58 KB each: the bundle, the safety gate, the elite validator, signals and CATE each asked) and, while the laptop slept, the chain's graduations (227 rows, 118 KB) and, while it was awake, the laptop's snapshot (36 KB): 330 to 410 KB a build, 500 builds a day = the allowance. The clock's own jobs read almost nothing in a quiet window (a few dozen rows in seven minutes).
    Now: the base list is read once and shared for 3 minutes (`app/api/candidates/route.ts`; the list only changes when a scan has run), the laptop's snapshot is read in full only when its time has changed (`loadPushedGraduates` asks for the time first: a few bytes), the chain's graduations are read again only when the feed has finished a new round or after 10 minutes (`buildGraduatesShared`; ages are moved forward and the live gates run on every call, so the lists stay live):
    about 60 KB a build (31 KB with the laptop awake). The brake is graded (`lib/bundleTtl.ts`): a minute normally, two minutes over the 100 MB allowance, five minutes only a quarter over it (it was five minutes at once). The Radar screen's own polling (`app/radar/page.tsx`): the library's idle tiers (a minute after 3 minutes untouched, five minutes after 15, nothing after two hours) made a screen that is only WATCHED look frozen;
    it now stays at a minute for 45 minutes and at three minutes until three hours (a forgotten screen costs about 100 builds a night, about 6 MB). `scripts/egress-probe.ts` takes `pg_stat_statements` before and after a window (one build, or a quiet few minutes) and prints the rows per statement.

14. **The data allowance as a rolling month (2026-10-16)**: the owner: "5 GB a month, divide it per day, and carry over what is left of the earlier days." The flat 100 MB a day lost the share of a quiet day and braked a busy one whatever the month looked like. Now (`lib/egressBudget.ts`): **the last 31 days together (the 30 before today plus today) may send out 4,500 MB** (90% of 5,000 MB: room for what is not counted and for the unknown day the plan's own month starts on),
    and **today's allowance is what the 30 days before it left of that, at most 200 MB and at least 40 MB**: a day that used little raises the allowance of the days after it, a busy day lowers it, and no stretch of 31 days can add up to more than 4,500 MB plus the soft brake's overshoot, wherever the plan's month begins (a calendar month would let a new month start from zero while the plan's month still holds the old one).
    Everything the hosted database sends is counted into the same day rows (`usage:egress:<day>` in `scan_lease`): the site (the meter in `@aureus/db`), the laptop's own connections to it (`meterPool` in the wallet, hot-ranking, exit-alert and phone-sync loops) and the scripts (`scripts/lib/hosted.ts connectTo`: counted when the connection ends, from a megabyte up, and the backups are the big ones), plus estimates for what was read before the meter existed (rows `usage:egress-estimate:<day>`: 130 MB for each of 2026-10-08, 09 and 10, and 415 MB for the backups of 2026-10-13: 798,308 rows through the backup cursor at about 520 bytes).
    On 2026-10-16 the 31 days held 1,566 MB: today's allowance is the most, 200 MB, with 160 MB used. The Radar's bundle is kept a minute while today's use is under the allowance, two minutes over it and five minutes a quarter over it (`lib/bundleTtl.ts`); the scan and learning stretch x4 and the lab stops over it, as before. `scripts/limits-check.ts` and the Ops page ("Sent out, last 31 days") show the window and today's allowance;
    `EGRESS_BUDGET_MB_PER_DAY` in the environment pins the allowance at a flat number again (0 = no brake), `EGRESS_WINDOW_MB`, `EGRESS_DAY_MAX_MB` and `EGRESS_DAY_MIN_MB` change the rule. What is not counted: Supabase's own overhead, reads under a megabyte by a script, a script that crashes before it ends its connection. The plan's real counter is on Supabase's usage page; if it ever differs from this by more than the 10% margin, say so and the window shrinks.

## Measured costs (production build, one request each; the laptop's database has 30 days of data, the hosted one about 7)

| request | CPU | answer | database read |
| --- | --- | --- | --- |
| Radar bundle (14 routes in one) | 143 ms | 286 KB local, ~100 KB hosted | 1.8 MB local, **0.2 MB hosted** (8 queries) |
| `/api/lab` (Learning) | 25 ms | 350 KB | the stored analyses, ~180 KB |
| `/api/my-trades` | 17 ms | 77 KB | the journal |
| `/api/telemetry` (every open screen, once a minute) | 22 ms (5 s on the first call after idle: starting up) | 1 KB | a few small queries |
| other polled routes | 3 to 8 ms | 1 to 90 KB | small |
| hosted lab recompute | 1 to 2 s | none | **6 MB**, now at most every 6 hours |
| **exit check** (`/api/cron/exit-alerts`, every 2 minutes) | 42 to 112 ms warm (86 ms average over the first 12 h, 89 ms over the last 14 calls, 170 to 250 ms on a cold start); running time 1.7 s on average since the wallet is read only every other call | 80 bytes | **about 1 KB warm** (a few tiny queries), **about 45 KB when the instance was cold** (it re-reads the fills and the recorded levels once); 6 DexScreener calls of 30 coins, a Solana RPC call every other call. **Added 2026-10-13:** at most 8 extra DexScreener calls per pass for coins whose batch pair has no price (in practice 0, the rate measured was 1 coin in 1,430), and, only when a held coin has fallen to its line, one pause of **25 seconds** and one more price call before the "sell the rest" message (rare; the route's limit is 60 seconds; a wait costs running time, not CPU) |

## If a warning mail arrives anyway

- **Vercel "usage" mail (75% or 100%)**: open Vercel > Usage to see which number. For CPU: lower `SCAN_CPU_BUDGET_S_PER_DAY` in the Vercel project (default 240) and redeploy; if the exit check itself is the
  big part, slow the clock (`scripts/cron-setup.ts` uses 2 minutes; every 3 minutes is `*/3 * * * *`, run `install` again) or stop it (`remove`). For invocations: close screens
  you are not using. Nothing is billed on Hobby; at 100% of CPU the project is blocked for 30 days, which is why the daily budget exists.
- **Supabase "egress" or "database size" mail**: lower `EGRESS_BUDGET_MB_PER_DAY` (default 100) or `RETENTION_DAYS` (now 4; the minimum is 2), or set `SCAN_STORAGE_LIMIT_MB` lower; run `scripts/limits-check.ts` to see the daily numbers.
  Pushing the lab's analyses from the laptop instead of recomputing on the hosted site is the next step if needed.
- **Supabase "paused" mail**: restore the project in its dashboard; nothing was lost. Keep the laptop daemon (or the site) active.
- **DexScreener, GeckoTerminal or the RPC refusing requests**: nothing to do; the system pauses and retries. Persistent refusals show as an older "Updated N min ago" on the pages.
- **Telegram "bot blocked" or stops delivering**: check the Telegram page; a send that Telegram refuses is recorded there with its reason.

## What is not covered, honestly

- The Vercel and Supabase counters are the vendors'; the meter and the budgets are our own estimate of the same things and can differ by some percent. The Ops page and
  `limits-check.ts` show ours; the dashboards show theirs.
- Active CPU on Vercel is not readable through its API on the Hobby plan; the scans' share is measured, the pages' share is estimated from the table above.
- If the laptop is off, the hosted site scans for itself: every 10 minutes while a screen is open (that is what the CPU and egress budgets limit) and once an hour otherwise. The
  exit alerts no longer need the laptop. The network ranking (Hot networks) still does: the hosted site refreshes it only when a screen asks and it is 20 minutes old.
- The database's growth is measured over three days of data and one day of the clock; the first retention run that deletes rule evaluations will happen when data is 4 days old
  (2026-10-13). Until then `limits-check.ts` is the place to watch the size.
- Vercel's logs on Hobby are kept one hour, so nothing here relies on them: the clock's own run list and the site's answers (6 hours) are in the database
  (`scripts/cron-setup.ts status`), and the exit check's last run is the heartbeat the Telegram page shows.
