# Learning Lab

The `/learning` page. It replaces the old Learning tab as the place where the system learns from **every coin it has ever
followed**, not only the ones that happened to be listed on a Radar tab. The old Self-Optimizer grading is still on the page
(Tabs view, read-only) for reference.

The lab answers four questions, and nothing else on the page is allowed to claim more than the data can carry:

1. **Why do coins go?** Which things about a coin, at a given moment, go with it doubling (held, not a one-reading spike).
2. **Why don't they, and how do they die?** What goes with losing half within a day; the life of a coin from first look to end.
3. **Which of our own rules help or hurt?** Every rule the system uses to hide or reject a coin is graded by what happened to
   the coins it blocked, measured forward from the moment of the check.
4. **Which coins are bullshit?** Coins that trade volume but are never going anywhere, found by ranking coins by the lab's own
   odds and showing what removing the worst 10-50% would have cost in winners and saved in crashes, on coins the ranking never saw.

## 1. Data flow

```
scanner (prices, liquidity, raw DexScreener payloads, enrichment)          lab collectors (what the scanner does not keep)
        |                                                                      |  price tail, hourly candle repair,
        |                                                                      |  unique buyers (GeckoTerminal), organic score (Jupiter)
        +--------------------------> lab_signals_ts <--------------------------+
        |                                  |
        v                                  v
   buildCoins() ----> lab_coins (one LESSON per coin: first-look features, snapshots at 0/1/3/6/12/24 h with forward labels, outcome)
                                           |
                                           v
                          computeReports() ----> lab_reports (one JSON per kind; the page only reads these)
                                           |
                                           v
                        GET /api/lab ----> /learning (9 views)
```

| table | holds | notes |
| --- | --- | --- |
| `lab_coins` | one lesson per coin | `snaps` = `[{tau, ts, f:{features}, y:{forward labels}}]`, `outcome` = class, held peaks, drawdowns, `now` snapshot for open coins; ~3 KB a coin |
| `lab_reports` | latest analysis per kind | `overview, insights, rules, models, nogo, lifecycle, hypotheses, live, tabs, headlines, meta`; ~120 KB in total |
| `lab_signals_ts` | collector rows | `price_tail, candle_tail, gecko_multi, jupiter`; pruned after 21 days; folded into lessons by the builder |
| `lab_hypotheses` | hypotheses with registration dates | the earliest date always wins when two databases are synced |
| `lab_watch` | the coins the lab watches itself (migration 0029) | lanes beyond the Radar's door, see section 5; polled by the lab, never part of the Radar's candidates |

Why lessons instead of history: the hosted database keeps 7 days of price history (`prune_history`), the laptop keeps
everything. A lesson is small, so what was learned survives the pruning, and the laptop's month of history can be pushed to
the hosted site once (`scripts/lab-push.ts`).

## 2. Definitions (the page shows the same wording)

- **First look**: the first time the scanner priced the coin. All "at first look" features use only what was known then.
- **Decision moments** `tau` = 0, 1, 3, 6, 12, 24 h after the first look. At each, the lab freezes the coin's features and
  waits for the next 72 h to label it. A moment only counts once its whole window has been seen: counting early winners while
  waiting for the losers made every base rate look better than it is (measured: doubling base rate 27% instead of 11%).
- **Held**: a price level counts only if the coin stayed at it for about half an hour with at least 3 readings (2 when readings
  are more than 15 minutes apart, which is the rule for hourly candles). A one-reading spike is never a "peak".
- **Phantom reading**: a price/liquidity jump of 20x or more that falls back within a few scans. Removed (39 readings in 5
  coins at the time of writing). One of them once produced a "1,194x coin"; see `docs/TAIL_RESEARCH.md`.
- **Outcome classes** (first match wins; `classify` in `lib/lab/outcomes.ts`): MOONSHOT (held 10x), RUNNER (held 3x), BOUNCE (held
  1.5x), RUG (pool drained and the price at 30% or less within a day), DUMP (fell to half within 6 h and never held 1.5x), BLEED
  (older than a day and lost half by then without a sharp fall), ZOMBIE (older than a day, between half and 1.5x: nothing happens),
  DEAD (no pool left), OPEN (not followed long enough, or fewer than 8 clean readings: never called a winner or a loser). A held
  peak is never demoted by what came later.
- **Standing cohort**: coins that have not already fallen apart at the moment (above half the first price and within 65% of the
  own high). Models, insights and the no-go filter use only these; a coin already down 90% cannot crash again and would make
  "what predicts a crash" look far better than it is. The fallen are reported separately.
- **Censored coins**: coins the scanner stopped following (rejected, expired, dormant) are 54% of all coins. The lab's price-tail
  collector keeps pricing them for 100 hours, and a one-off repair (`scripts/lab-repair.ts`) fills the older ones from
  GeckoTerminal hourly candles, so a rejection can finally be graded by what the coin did afterwards.

## 3. Statistical policy

- Every rate carries its sample (`k of n`) and a 90% Wilson interval. Samples below 8-15 are drawn faded or as a dash.
- Feature tests: AUC (rank based) with a Hanley-McNeil interval, Benjamini-Hochberg q-values over all tests run, and the same
  direction in the earlier and the later half of the coins. **Strong** = q < 0.05 and |AUC - 0.5| >= 0.07 and the same direction
  in both halves. **Suggestive** and **weak** are labelled as such; the page shows how many tests were run.
- Models (ridge logistic regression on a dozen transformed features): fitted on the earlier 60% of coins, judged on the later
  40%. **Valid** only if the AUC's lower interval bound is above 0.55 with at least 12 positives on the test side.
- Odds shown for live coins are never raw model output. A live score is mapped to what happened to coins that scored in the
  same fifth when predicted by models that had not seen them (time-blocked cross-fit), so a number cannot be more extreme than
  anything observed. A moment's model is used only for coins whose age is within a factor of two of it; a coin whose age fits no
  validated moment gets no number, only flags.
- Hypotheses are written down with a date **before** they are tested; the only evidence that counts is coins first seen after
  that date. The earlier coins are shown as "where the idea came from".
- Nothing here is investment advice. The ladder result used throughout is a fixed, boring exit plan (stop at -50%, a quarter sold
  at 2x, 5x and 10x, 40% trailing stop on the rest, 5% cost, 72 h) so that groups can be compared; it is not a recommendation.

## 4. Collectors (free, keyless)

| collector | source | per round | for |
| --- | --- | --- | --- |
| price tail | DexScreener `tokens/v1` (30 mints a call) | up to 150 coins no longer followed, <= 100 h old, one reading per 25 min | grading rejections |
| candle repair | GeckoTerminal `ohlcv/hour` | `scripts/lab-repair.ts` only, about 8 calls a minute | old censored coins |
| unique buyers/sellers | GeckoTerminal `pools/multi` (30 pools a call) | <= 3 calls | `uniq_buyers_h1`, buy/sell wallets |
| organic score, holders, developer history | Jupiter lite-api `tokens/v2` (50 mints a call) | <= 3 calls | `organic_score`, `holders`, `dev_*` |

All collectors only touch coins this database's scanner has a candidate for (joined by mint), treat a failed or rate-limited call
as "try next round" (GeckoTerminal refuses often from shared IPs; Jupiter and DexScreener are the dependable ones), and never
write a guess. Unique buyers, organic score and holder counts exist only as snapshots, so the lab can learn from them only for
coins it watches from now on; the page says so.

## 5. Lanes: what the Radar's door turns away

The Radar admits a coin only when its pair is at least 60 minutes old and worth at most $150K (`DISCOVERY_MIN_AGE_MIN`,
`DISCOVERY_MAX_MCAP_USD` in `apps/worker/src/run.ts`; the age floor is a measured choice, the first hour has ten times the downside).
That is a decision about what the Radar shows. It also means the system never finds out what happens to the coins it refuses, and
it cannot see a coin like HOTBOT (worth about $550K an hour after graduating, so no setting of the filters could let it in).
The lab therefore follows those coins as well, without touching the Radar:

| lane | what | how it gets on the watch list |
| --- | --- | --- |
| `fresh` | the Radar's own coins (everything else in this document) | the scanner's candidates |
| `graduate` | turned away as under 60 minutes old | the worker's discovery pass (`apps/worker/src/labWatch.ts`, `noteTurnedAway`) |
| `runner` | turned away as worth more than $150K, or found on Jupiter's top lists | the same hook, and `discoverRunners` (`lib/lab/lanes.ts`): Jupiter's free organic-score, most-traded and trending lists, filtered to $0.3M-$150M, 3 hours to 60 days old, liquidity $40K+, organic score 30+, 300+ holders |

`collectWatch` polls each watched coin from DexScreener (30 mints a call): every 8 minutes for the first 6 hours, every 30 minutes
until 48 hours, then every 2 hours, for 7 days (hosted: 20 / 60 / 180 minutes, at most 120 coins at once). Readings are stored in
`lab_signals_ts` (source `watch`, about 540 bytes each) and the builder turns them into lessons exactly like scanner readings, with
`lane` set and a `via:<feed>` tag. A coin the Radar later adopts is left to its normal lesson. Every analysis except the lane table
(`lanes` report), the live list and the hypotheses H6 uses only `fresh` coins: the models were fitted on them.

The Radar's **Runners** tab (`/api/runners`) lists the watched runners with their latest reading, split into healthy, established
ones and young, exploding ones, with the lab's result so far at the top (empty until the first runners have been followed 3 days).
Until then it shows a **prior** from history (`scripts/lab-prior.ts`, report `prior`, run on the laptop and copied by `lab-push.ts`):
what the Radar's own coins did after their first reading worth $300K+ with $40K+ of liquidity and a pair 3+ hours old. On 2026-10-10:
87 such coins, 67 with the whole 72 hours seen: 19% held 2x, 12% held 3x, 65% were worth half or less a day later, and the fixed exit plan
averaged -25%. Crossing $300K does not make a coin special; the runner lane tests whether looking healthy (organic score, holders) does.

### Free facts per coin (added 2026-10-10, see docs/DATA_SOURCES.md)

- **Static facts** (`lib/lab/statics.ts`, one `static` row per coin): the launchpad (Jupiter) and what the team paid DexScreener for, with times:
  profile, boosts (with amounts), ads, community takeover. Features `lp_pump`, `lp_other`, `paid_profile`, `profile_delay_min`, `boost_amount`,
  `boost_n`, `ad_n`, `cto`, read AS OF each snapshot (nothing paid later is counted; tested). Backfilled for every lesson; new coins are
  filled in a few per round. Developer counts are kept only for coins that were new when checked (an older coin's count would include coins
  launched after it).
- **Market backdrop** (`lib/lab/regime.ts`): SOL price, Solana DEX volume per day (DefiLlama, with history so old lessons get it), pump.fun
  volume, fear and greed, DexScreener's trending narratives. Features `regime_sol_24h`, `regime_dex_vol`; the "Market now" strip on the
  Learning overview, Home and the Runners/Graduations tabs.
- **Jupiter organic flow**: net buyers and organic volume are now collected with the same call (`net_buyer_share`, `organic_vol_share`, for
  coins seen from now on).

### pump.fun's event stream (laptop only)

`apps/worker/src/pumpFeed.ts` holds PumpPortal's free websocket (one connection in the whole system, guarded by a database lock): every
launch goes to `pump_launches` (72 h), every graduation to `pump_graduates` with what was known (minutes from launch to graduation, the
creator's first buy, Mayhem Mode, the creator's launches in the 72 h before) and into the watch list from minute 0 (lane `graduate`, reason
`pump_migration`; polled every 2 minutes at first, then thinning out; watched 5 days). The long-running worker starts it (`PUMP_FEED=0`
switches it off); `scripts/lab-daemon.ts` runs the same stream plus the lab rounds when the worker is not running. About a thousand
graduations a day, and a large share graduate within minutes because the creator bought the whole curve (85 SOL): those are split out in the
"Anatomy of pump.fun graduations" table once enough coins have run their three days, and hypotheses H7 (born graduated), H8 (Mayhem Mode) and
H9 (one-off creators) were written down before any of them had.

**How graduations end, read from the readings (`lib/lab/pump.ts`, shown on Radar > Graduations).** The 72-hour lessons need three days, but
the watch readings already show what happens in the first hours. Three kinds of "graduation" turned out to be different things (first
80 minutes of the stream, 2026-10-10; the page recomputes it, read the page for current numbers):

- *Born graduated* (creator bought >= 50 SOL in the creating transaction and the coin graduated within 2 minutes): the pool opens with
  $40-65K of liquidity, the price often climbs for a few minutes, and then the pool is emptied (the creator sells everything into it; the
  liquidity tokens of a pump.fun graduation are burned, so it is a sell-off, not a classic liquidity pull). Of the first 24, 14 were already
  emptied and 7 of the 8 that could be judged at about an hour were.
- *Mayhem Mode*: all 14 first "graduations" left a pool holding $2-$29 (DexScreener and RugCheck agree on the liquidity; the pool had about
  0.1 SOL against 400M tokens). Not tradable in any real size.
- *Organic* (everything else with a known launch): real pools of $8-50K at the start.

Definitions: *empty* = first liquidity reading under $1,000; *drained* = the pool held at least $10K at some reading and later fell under 10%
of that peak and under $5K; the one-hour judgement uses the first reading taken 55-100 minutes after graduation. The Graduations tab and Home
show by default only coins that are real pools, still standing, and not born graduated or Mayhem; "Everything" shows the rest with the reason.
Descriptive only: H7 and H8 are still judged on the 72-hour lessons, forward-only, by the loop.

**Who holds the coin (RugCheck, laptop only).** `lib/lab/rugcheck.ts` takes one snapshot of RugCheck's free report for each new coin (watch list
and the Radar's own, first seen in the last 6 hours, pool of at least $5K; 8 calls a round, 1.2 s apart, a 429 pauses it for 15 minutes) and keeps
it in `lab_signals_ts` (source `rugcheck`). Holder shares leave out the pool's own token accounts (checked on real reports: a fresh coin's pool can hold
90% of the supply). Features `rc_top1`, `rc_top10`, `rc_insider_pct`, `rc_insiders`, `rc_lp_locked`, `rc_risk_n`, `rc_holders` are read as of each
snapshot (never before it was taken, except that the very first look accepts a snapshot up to 25 minutes later). They are not in the live-odds
models until a forward test says they earn their place; hypothesis H10 (insider networks of 5% or more hold 2x less often than under 0.5%) is
registered for graduations first seen after 2026-10-10 15:35 UTC. The Graduations cards show holders, largest wallet and insider share, and flag
"insider networks hold N%", "one wallet holds N%" and "liquidity not locked" (warnings only; nothing is hidden because of them yet). First real
example: a coin 12 minutes after graduation with 2,698 holders where insider networks of 4,759 wallets held 91% of the supply.

**The phone.** The stream can only be held by a long-running process on the laptop. With `LAB_SYNC_URL` (a connection string for the hosted
database) set, the worker or `scripts/lab-daemon.ts` copies one small snapshot (graduations of the last 72 hours with their readings, and the
summary above) into the hosted `lab_reports` table every 3 minutes (kind `gradlist`, one row, replaced each time, left out of `/api/lab`
and of the lab's "computed at"). The hosted Radar, Home and coin dossier read it and say how old it is; without the variable they say that
the stream runs on the laptop. Nothing else is copied: the raw readings stay local (about 85 MB a day would not fit the free database).

A watched coin that the exchange stops listing is closed with a terminal "dead" reading: every window of such a coin is decided as "did not
happen" and it counts as followed for the whole window (leaving dead coins out would make the survivors look like everybody).

### Pages

`/coin/<mint>` is a dossier for any coin from free sources, each reported on its own (RugCheck insider networks and liquidity lock, Jupiter
organic stats, DexScreener orders, price history, the lab's lesson and odds, what the stream knew, your own entry); every Radar card, runner
and live-list row links to it. `/home` is a one-screen view for a phone: market, what needs a decision, your open trades against the example
exit plan, runners, fresh graduations.

## 6. The system loop (top of the Overview)

A system improves itself through a closed loop, not through more analysis: measure, propose one small change, test it on coins it
has not seen yet, adopt it only when it is proven, repeat. The loop card is that loop on one screen:

- **Scoreboard**, four numbers with a per-day trend: Radar listings that held 2x, Radar listings that lost half within a day, the share
  of coins behind the door that held 3x, and hours scanned in the last 24.
- **Experiments**: every hypothesis (H1-H6) with how far the smaller group is from the number needed to judge it.
- **Needs you**: at most three decisions, raised only when the evidence passes its gates (forward-only coins, enough in both groups,
  bigger than chance): a hypothesis confirmed or contradicted, a production rule that blocks coins that do better than the ones it lets
  through, a lane that does better than the Radar, scanning gaps. The default is "nothing needs you". Nothing changes behaviour by itself:
  a flag on Radar cards is information only, and hiding a coin always waits for a person.

Results > My Trades also compares each open trade with an **example exit plan** (`lib/exitPlan.ts`: a quarter sold at 2x, 5x and 10x, a
stop at -50% until the first sale and 40% below the peak after it) using only the journal's highest, lowest and latest market caps. It is a
comparison, not advice, and shows two assumptions it has to make (price rose to its peak first; a stop fills at its level).

Each Radar card also shows one **Lab** line when the lab has something checked to say: how often coins that scored the same way lost
half within a day or doubled within three days (`/api/lab-odds`, from the stored live report).

## 7. Where it runs

- **Hosted**: inside the learning tick (`lib/cloudScan.ts` `runLearning`, which already runs every 5 minutes while a screen is
  open). The lab round (`lib/lab/tick.ts` `runLab`) runs at most every 15 minutes, only while today's CPU allowance
  (`SCAN_CPU_BUDGET_S_PER_DAY`) is not used up, holds its own lease (`scan_lease` name `lab`), and its CPU is counted inside the
  learning job. Per round: collectors, at most 25 lessons, and the reports about hourly (or after 12 changed lessons). A report
  recompute costs about 1 s of CPU on a laptop. Nothing runs while no screen is open (same rule as the scans).
- **Laptop**: the long-running worker (`pnpm worker:start`) runs a lab round every 10 minutes between scan cycles
  (`maybeRunLab` in `apps/worker/src/run.ts`; `LAB_IN_WORKER=0` switches it off, `LAB_EVERY_MINUTES` sets the pace; a failure is
  logged and never stops scanning). A restart of the worker is needed once to load it. `corepack pnpm exec tsx scripts/lab-tick.ts [force]`
  does the same by hand. The laptop database has the full month of history, so lessons built there are richer.
- **Sync**: `TO_URL=<hosted url> LAB_REPORTS=1 corepack pnpm exec tsx scripts/lab-push.ts` copies lessons and hypotheses from the
  laptop to the hosted database and recomputes the hosted reports. A lesson replaces a stored one only when it is at least as
  complete (clearly earlier start, or same start (within 45 min) with more readings or a later end), so pushing twice, or
  pushing after the hosted site learned something, loses nothing, and a hosted rebuild from pruned history can never overwrite a
  complete lesson.
- **Case study**: `corepack pnpm exec tsx scripts/lab-case.ts` builds the HOTBOT case from live market data into `lab_reports` (kind
  `cases`); `lab-push.ts` copies it to the hosted database. GeckoTerminal refuses often, so the script says so and can simply be run again.
- **Rebuild everything**: `corepack pnpm exec tsx scripts/lab-build.ts` (lessons + reports; `LAB_REPORTS_ONLY=1` for the reports only).
- **Rehearse the hosted rights**: `LAB_AS_ROLE=aureus_app DATABASE_URL=<hosted, as postgres> corepack pnpm exec tsx scripts/lab-tick.ts force`
  (needs `GRANT aureus_app TO postgres WITH SET TRUE` on the hosted database; revoke afterwards).

## 8. The views

Overview (the system loop, what the lab knows, how coins end, lanes beyond the door, how trustworthy the lessons are, collector status) · Why coins go · Why coins don't
(per moment, each feature with its bins, AUC, q and halves; "show all tested") · Filters (four kinds of coin, the filter simulator,
plain no-hoper rules checked on later coins, the scoreboard of the system's own rules) · Live coins (flags, kind, odds; cards on a
phone) · Life of a coin (hazard and survival, narrative/venue/hour splits) · Models (what each model learned and whether it
beat chance) · Hypotheses (registered ideas and their forward evidence) · Case: HOTBOT (the coin the door could not let in, with its market cap against the door) · Tabs (how each Radar tab's listings did, plus the
legacy Self-Optimizer).

## 9. What it says today (2026-10-10, 1,439 coins over 28 days; read the page for the current numbers)

- Of the 1,040 coins followed for the full 3 days, **16.1% held 2x, 9.7% held 3x, 5.8% held 5x and 2.7% held 10x** of their first price.
  Before the candle repair completed the tails of the 649 coins the scanner had dropped, the same figures read 19.0%, 11.0%, 6.0% and
  3.2% on only 463 coins: leaving the dropped coins out made the survivors look like everybody.
- No listing-time feature predicts winners strongly. Volume, trades and liquidity ratios drive **both** doubling and crashing: a busy
  coin is more likely to double and more likely to die. Crash risk is predictable (AUC 0.74, 0.69 and 0.67 at 1, 3 and 6 h, valid on later
  coins); doubling only at 6 h (AUC 0.68, 31 test positives, wide interval).
- The production dump gate ("fell 80% in 24 hours") is **costly at +6 h**: the coins it hides did better than the ones it lets through
  (173 coins). One plain no-hoper rule held up on later coins. Break-even for a blind-entry strategy needs an AUC of 0.70-0.75.
- Coins past $300K with real liquidity are not special: of 67 (whole window seen) 19% held 2x and 65% were worth half within a day.

### A data-quality incident, kept here so it is not repeated

The first candle repair (hourly closes from GeckoTerminal for coins the scanner dropped) merged series in the wrong units for coins whose
pool lists ANOTHER token first (GeckoTerminal returns the first token's price unless asked for `token=<mint>`): dead coins became
"moonshots" (173 of them, median 270,000x their first price) and the headline said 17% of coins held 10x. It was caught by a unit check
on the first rebuild, before anything was published. Fixed by: always asking for `token=<mint>`; a plausibility guard (the first
close after the scanner's last reading must be within 20x of that reading, checked when fetching and again when building); a forced
rebuild option (`LAB_FORCE=1`, because the "keep the richer lesson" rule also protects a lesson built from bad data); and re-fetching.
Cross-checked against GeckoTerminal's daily highs for the biggest winners afterwards. A series that fails the guard is refused, never merged.

## 10. Known limits

- 54% of coins were censored by the scanner; their tails are being completed (candle repair running at about 8 coins a minute),
  so survivorship bias shrinks as the repair finishes. Re-run `scripts/lab-build.ts` afterwards.
- The hosted database only sees coins that were scanned while a screen was open (or by the laptop worker). Coins launched while
  nobody watched are never seen there.
- Discovery blind spots found with HOTBOT (a coin the user holds that went about 10x): coins that graduate from pump.fun and pass
  $150K within the first hour, and coins days old that are already past the door's cap, never enter the Radar. The lanes (section 5)
  measure them from the moment the lab first sees them. The `graduate` lane only holds the young coins the worker's discovery pass
  happens to see in DexScreener's search and launch feeds; seeing every graduation from minute 0 needs an on-chain feed (a Helius
  key), which the system does not have. The `runner` lane is fed by Jupiter's lists, so it only holds coins that are already running.
- The lab's lessons for lane coins start when the lab first sees them, usually after a big move: a runner's "first look" is not its
  launch. Lanes are compared with the Radar's coins as groups, not as if they had been entered at the same moment.
- The lab follows at most 120 coins at once on the hosted site (600 on the laptop) and 7 days each; the free database is small.
