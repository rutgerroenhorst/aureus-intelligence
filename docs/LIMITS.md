# Free-plan limits: what we use, what keeps us under them, what to do if a warning comes

Written 2026-10-11 after the user asked that no message about a limit ever arrives and that nothing starts costing money. Everything here runs on free plans.
The numbers were measured on that day (Vercel's usage API, the hosted database, a production build run against it); the limits are the plans' published ones at
the time of writing and should be checked on the dashboards when a plan changes.

## The short version

- **Nothing in the code or the Vercel settings costs money.** No paid API key is used or configured (searched the code; the Vercel project only has the database
  address, the two free data sources' base addresses, the site's own address, and the retention and storage settings). No scheduled GitHub jobs. PumpPortal is read
  with its two free subscriptions only (new tokens, migrations); its paid trade subscriptions are not used. Telegram's Bot API is free.
- **The two limits that can actually be reached** are Vercel's CPU time (4 hours a month; beyond it the project is blocked for 30 days) and Supabase's data sent out
  (5 GB a month). Both now have a meter and an automatic brake (below). Today's real use is a small fraction of both.
- Nothing is silently relied on: `scripts/limits-check.ts` and the Ops page show the numbers whenever you want to look.

## Service by service

| service (plan) | limit | use on 2026-10-11 | what keeps it under |
| --- | --- | --- | --- |
| **Supabase** database size (Free) | 500 MB; over it the project turns read-only | 113 MB (23%) | scans pause at 440 MB (`SCAN_STORAGE_LIMIT_MB`), history older than `RETENTION_DAYS` is deleted, hosted lab rows are pruned |
| **Supabase** data sent out ("egress", Free) | 5 GB a month | the hosted site read about 1.9 million rows in 3 days (an estimated 3-4 GB a month at that pace, much of it the lab re-reading every lesson); one Radar bundle reads ~0.2 MB there | **meter** (exact bytes per day, `usage:egress:` rows) and a **daily brake of 100 MB** (about 3 GB a month): over it the scan and the learning tick stretch x4, the lab and catch-up rounds stop, the Radar bundle is kept 5 minutes; plus the reductions below |
| **Supabase** pause | a free project with no activity for a week is paused (restorable in the dashboard, nothing is lost) | the laptop pushes every few minutes and the site is used daily | only if the laptop is off *and* nobody opens the site for a week |
| **Vercel** function invocations (Hobby) | 1,000,000 a month | 4,750 so far this month (0.5%) | polling helper: nothing is asked while a tab is hidden, slower when idle, **nothing after two hours untouched** |
| **Vercel** Active CPU (Hobby) | 4 hours a month; **blocked 30 days beyond it** | scans used 28 s, 120 s and 52 s on the three days the site has been live (budget 300 s a day); a page request costs 3 to 25 ms of CPU, a Radar bundle 143 ms | daily CPU budget for scans (300 s, interval stretches x4 beyond it); idle back-off and stop on the pages; the bundle is built at most once a minute |
| **Vercel** bandwidth (Hobby) | 100 GB a month | 0.03 GB | pages are small (the Radar answer is ~100 KB) |
| **Vercel** builds and deployments (Hobby) | 100 deployments a day | about 10 a day on busy days | one push per change; wait a few minutes between pushes (GitHub also rate-limits fast repeated pushes, which once made a build fail) |
| **GitHub** (public repository) | no Actions in use; push rate limits | no workflows | none needed |
| **DexScreener** (free, keyless) | 300 requests a minute for pairs, 60 for profiles, boosts, orders and metas | the worker's limiter is set to exactly those; the lab daemon adds up to 15 a minute; the exit alerts 3 a minute; one refused request was recorded in 3 days | a refusal is a short pause, not a cost; limiters per source |
| **GeckoTerminal** (free, keyless) | about 30 calls a minute for everything on one address | the worker's limiter allows 10 a minute; the network ranking 1.5 a minute; other tools share the address, so refusals (429) happen | retried with pauses; a network that cannot be read keeps its last reading for 30 minutes; nothing here can bill |
| **Jupiter** lite, **RugCheck**, **DefiLlama**, alternative.me (free) | modest published rates | a handful of calls every 10 to 60 minutes | spaced by the lab collectors (RugCheck 8 calls a round) |
| **Solana RPC** (public endpoints) | rate limited per address | the wallet reader asks for new transactions every 5 minutes | paced per endpoint, falls back across endpoints |
| **PumpPortal** (free stream) | one connection at a time (more can get the address banned for an hour) | one, held by a database lock | the lock; only `subscribeNewToken` and `subscribeMigration` are used |
| **Telegram Bot API** (free) | about 30 messages a second overall, one a second to one chat | 3 messages so far (a test and two alerts) | spacing of 1.1 s, a **ceiling of 40 alerts in 24 hours**, and Telegram's own "slow down" answer is obeyed (up to an hour) |
| **Helius** (optional key) | free credits if a key is ever added | not configured | none needed |

## What changed on 2026-10-11 to stay inside the limits

1. **Meter and brake for the data the hosted database sends** (`packages/db`: bytes counted on the pool's sockets; `lib/cloudScan.ts`: daily budget of 100 MB).
2. **The hosted lab recomputes its analyses every 6 hours instead of every time 12 lessons changed.** Each recompute reads all lessons (about 6 MB and growing); it was
   running about ten times a day, roughly half of everything the site read. The laptop still recomputes about hourly (reading there is free).
3. **The Radar's bundle is kept for a minute on the hosted site** (it was 15 seconds) and the edge may keep a complete answer for 30 seconds; the Radar asks every 30 seconds
   (it was 20); the Telegram page every minute; the Learning page every 2 minutes (the analyses change hourly).
4. **Screens untouched for two hours stop asking** until touched again (a tab left open for days read from the database all night).
5. **The hosted site refreshes the network ranking itself only when it is 20 minutes old** (the laptop does it every 4 minutes), because a refresh takes ~20 seconds of function time.
6. **Telegram**: daily ceiling, "slow down" obeyed, one message a second at most.
7. The Ops page shows the usage; `scripts/limits-check.ts` prints it with Vercel's own counters.

## Measured costs (production build, one request each; the laptop's database has 30 days of data, the hosted one about 7)

| request | CPU | answer | database read |
| --- | --- | --- | --- |
| Radar bundle (14 routes in one) | 143 ms | 286 KB local, ~100 KB hosted | 1.8 MB local, **0.2 MB hosted** (8 queries) |
| `/api/lab` (Learning) | 25 ms | 350 KB | the stored analyses, ~180 KB |
| `/api/my-trades` | 17 ms | 77 KB | the journal |
| `/api/telemetry` (every open screen, once a minute) | 22 ms (5 s on the first call after idle: starting up) | 1 KB | a few small queries |
| other polled routes | 3 to 8 ms | 1 to 90 KB | small |
| hosted lab recompute | 1 to 2 s | none | **6 MB**, now at most every 6 hours |

## If a warning mail arrives anyway

- **Vercel "usage" mail (75% or 100%)**: open Vercel > Usage to see which number. For CPU: lower `SCAN_CPU_BUDGET_S_PER_DAY` in the Vercel project (default 300) and redeploy. For invocations: close screens
  you are not using. Nothing is billed on Hobby; at 100% of CPU the project is blocked for 30 days, which is why the daily budget exists.
- **Supabase "egress" or "database size" mail**: lower `EGRESS_BUDGET_MB_PER_DAY` (default 100) or `RETENTION_DAYS`, or set `SCAN_STORAGE_LIMIT_MB` lower; run `scripts/limits-check.ts` to see the daily numbers.
  Pushing the lab's analyses from the laptop instead of recomputing on the hosted site is the next step if needed.
- **Supabase "paused" mail**: restore the project in its dashboard; nothing was lost. Keep the laptop daemon (or the site) active.
- **DexScreener, GeckoTerminal or the RPC refusing requests**: nothing to do; the system pauses and retries. Persistent refusals show as an older "Updated N min ago" on the pages.
- **Telegram "bot blocked" or stops delivering**: check the Telegram page; a send that Telegram refuses is recorded there with its reason.

## What is not covered, honestly

- The Vercel and Supabase counters are the vendors'; the meter and the budgets are our own estimate of the same things and can differ by some percent. The Ops page and
  `limits-check.ts` show ours; the dashboards show theirs.
- Active CPU on Vercel is not readable through its API on the Hobby plan; the scans' share is measured, the pages' share is estimated from the table above.
- If the laptop is off, the hosted site scans for itself while a screen is open (that is what the CPU and egress budgets limit); the exit alerts and the network ranking
  need the laptop.
