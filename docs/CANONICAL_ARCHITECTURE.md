# Canonical decision architecture

## One source of truth
`apps/web/lib/candidateView.ts` → `getDecisionViews()` builds **CandidateDecisionView**,
the single object every surface renders:

| Surface | Reads |
|---|---|
| Today (`app/today`) | `getBoardView()` |
| Action Board (`app/action-board`) | `getBoardView()` |
| API (`/api/action-board`) | `getBoardView()` |
| Candidate detail | `getDecisionViews()` → `DecisionHeader` |
| Buckets / best-candidate / counts | `lib/boardSections.ts` |

No page recomputes status, safety, drain, blocker, priority or plan. Because Today and
the Action Board call the same builder, their counts cannot disagree.

## Authority rules
- **action status / priority / ranks / plan** → persisted `candidate_action_status`
  (the worker is the only writer).
- **liquidity_drain** → recomputed **LIVE** from the liquidity series on every read.
  The frozen `onchain_enrichment` copy is never authoritative for it.
- **all other on-chain data** → latest `onchain_enrichment`.

## Canonical blocker (one primary, fixed priority)
`lib/decisionRules.ts` → `canonicalBlocker()`:
1 critical Safety FAIL · 2 stale data · 3 sellability · 4 critical drain ·
5 Core Safety incomplete · 6 no valid structure · 7 overextended ·
8 plan levels unusable · 9 confirmation scans · 10 slippage/R:R.
Everything else becomes a *secondary* blocker. Rule IDs are humanised
(`RULE_PLAIN`) — the UI never shows a bare rule ID as the reason a user can't act.

## Two safety layers
- **CORE SAFETY** (`requiredForSafety: true`): supply, holders, holder_concentration,
  authorities, insider_concentration, sellability, liquidity_drain, deployer_funding.
  Can independently reach PASS.
- **ADVANCED ON-CHAIN** (`layer: "advanced"`): bundle_contamination, deployer_sales,
  wallet_clusters. Free-tier UNKNOWN; **never blocks Core Safety or ENTRY_READY**
  (regression-tested in `packages/safety-engine/src/reachability.test.ts`).

## TOO_EXTENDED is structural
Never a raw return or band width. Extended = price above **max chase**, or more than
one **base-width above the established high**. A wide/volatile band with price
mid-range is `NO_STRUCTURE`, not extended.

## Plan validity (§6)
A provisional plan is shown only when: structure exists (not NO_STRUCTURE), a trigger
type is named, invalidation is present, max chase > entry area, price is not far below
a stale structure or above max chase, and liquidity isn't draining. Otherwise the UI
shows **NO ENTRY AREA SHOWN** with the exact reasons. Everything before ENTRY_READY is
labelled **PROVISIONAL — NOT AN ENTRY YET**.

## Priority ↔ status (§7)
ENTRY_READY→CRITICAL · ENTRY_APPROACHING→PRIMARY · SETUP_FORMING/FUNDAMENTAL_WATCH→
PRIMARY (max 5, quality floor) or SECONDARY · DISCOVERED→OBSERVATION ·
REJECTED/INVALIDATED/EXPIRED→DORMANT. `ENTRY_APPROACHING + OBSERVATION` is impossible.

## Cadence (§8) — persisted `next_scan_at` from status
ENTRY_READY 7s · ENTRY_APPROACHING 12s · SETUP_FORMING 15s · TOO_EXTENDED 30s ·
FUNDAMENTAL_WATCH primary 30s / secondary 120s · DISCOVERED 300s · dormant 24h.
Implemented by `cadenceForStatus()` in `apps/worker/src/pipeline.ts`.

## Operational notes
- Postgres runs in Docker; if the machine sleeps and the container is recreated, re-run
  `db/migrations/*.sql` in order **and** `pnpm db:seed` (the engine catalogs are seeded,
  not migrated — an empty `feature_definitions` causes FK errors on every candidate).
- Start the worker detached: `nohup node --env-file=.env.local --import tsx apps/worker/src/run.ts start & disown`.
- A machine sleep leaves a **hole in the time series**, not just downtime: on 2026-07-28
  both `prices` and `liquidity_snapshots` stop at 20:01 and resume 13:43 the next day.
  After a restart, expect ~1h of `CORE SAFETY INCOMPLETE` fleet-wide while
  `liquidity_retention_1h` rebuilds a real baseline. That is correct behaviour — it is
  the system refusing to certify no-drain over a period it did not observe.
- `next build` writes to `.next-build`, `next dev` to `.next` (driven by `NEXT_DIST_DIR`
  in `apps/web/package.json`, not by argv sniffing — Next re-reads the config in child
  processes whose argv lacks "build"). This means `pnpm -r build` is safe to run while the
  dev server is up; it used to overwrite the running server's chunks and 500 every page.
  `next start` must set the same var, which the `start` script does.

## History coverage is part of the measurement (`analyzeLiquidityDrain`)
A horizon is only reported when its baseline is genuinely that old — baseline age must be
within `max(H, 15m)` of the horizon `H`. Absence of a sample only means "no meaningful
change" while we were *watching*; across an outage it means nothing, so a baseline sitting
on the far side of a gap is reported in `unmeasured[]` instead of being used. If no horizon
survives, drain is `INCOMPLETE`/`stale`, never a clean `OK`. `maxGapMs` carries the largest
observation hole to the UI (`observationGapMs`), and `sinceDiscovery` spans any outage by
definition so it never drives severity. A dead pool (≤ $500) is still `FAIL` regardless of
history — that reading needs no baseline.

## Grading the system against its own decisions (migration 0011)
Until now the pipeline only ever measured what it liked: a terminal verdict set the
candidate dormant immediately, so it was **structurally incapable of learning whether
a rejection was correct**. A filter that rejects all 240 candidates has perfect
precision and zero value, and from the inside those two cases look identical.

- `candidate_verdicts` — one anchor per (candidate, verdict), recorded the FIRST time
  that verdict is entered, so a rejection is graded from the moment we walked away.
- `verdict_outcomes` — forward ret/MFE/MAE per horizon (m15/h1/h6/h24), measured with
  the outcome-engine's anti-look-ahead window. Fewer than 2 observations in a window
  is recorded as `UNOBSERVABLE`, never as a 0% return — a coverage hole must not read
  as a flat result.
- `candidates.observe_until` — a 24h learning tail. Terminal verdicts keep a cheap
  10-minute observation cadence purely so the outcome is measurable. It never promotes
  a candidate, never returns it to the board, and never feeds a gate.

Run `tsx apps/worker/src/grade.ts [m15|h1|h6|h24]` for the cohort tables plus the
ENTRY_READY binding-constraint histogram.

**Reading it:** a REJECTED cohort with high median MFE means we walked away from real
moves (opportunity cost). Deep median MAE means the rejection saved money. A high
`unobs` count means we stopped watching, so that cohort says nothing either way.

## Round-trip cost (`packages/cost-model`)
Plans used to show a target with no notion of what it costs to get in and back out. On
the pool depths this scanner finds, that cost is routinely **larger than the target**.
Constant-product impact is `S/Q` with `Q ≈ liquidityUsd/2`, paid on both legs, plus
LP + platform fees on both legs:

    GINGY, $12.3K pool, $500 position
      buy impact 8.1% + sell impact 8.1% + fees 2.5%  ≈  18.8% round trip
      break-even  +23.2%   ⇒  a "+20% target" is a losing trade

`validatePlan()` now invalidates any plan whose target does not clear break-even with
margin, and the card shows the round trip, the break-even move, and the largest
position that keeps the round trip under 10% at that depth.

## Why ENTRY_READY never fires
`entryReadyBlockers()` returns exactly which of the 7 preconditions are false, from the
same input object `deriveStatus()` uses, so the explanation cannot drift from the
decision (proved exhaustively over all 128 combinations in `evidence.test.ts`). The
grade report histograms this across every candidate that got close — turning "it never
fires" from a guess into a number.

## Two outages that looked like "the site doesn't work"

**1. Missing time partitions (the real cause).** `prices`, `liquidity_snapshots` and
`transaction_aggregates` are RANGE-partitioned by month. `0001_init` created `2026m07`
with the comment *"A maintenance job creates future months"* — that job was never
written. On the month rollover every market-data INSERT began failing with
`no partition of relation ... found for row`. The worker logged one error per
candidate, kept reporting healthy cycles, and the board silently drained to zero.
Fixed by `ensure_time_partitions()` (migration 0012) plus `apps/worker/src/partitions.ts`,
which runs on worker boot (fatal if the current month is unwritable) and hourly.

**2. An unordered `LIMIT`.** The canonical query capped at `LIMIT 200` with no
`ORDER BY`, so Postgres returned an arbitrary 200 of 430 candidates. The board showed
129 REJECTED coins and **zero** FUNDAMENTAL_WATCH ones. An ENTRY_READY candidate could
have been invisible by pure luck. The cap is now applied to a decision-ordered set
(status priority → entry rank → quality rank → recency) at `LIMIT 400`, guarded by
`apps/web/lib/candidateView.test.ts`.

**Systemic vs per-item faults.** 25 identical `candidate error` lines per cycle read as
routine noise while nothing was being written at all. `runCycle()` now groups the
cycle's errors and logs `SYSTEMIC FAULT` when one error accounts for ≥50% of attempted
candidates (min 3) — one coin failing is normal, every coin failing the same way is an
outage.

## Recovery: one command
`pnpm up` (`scripts/up.sh`) starts Docker Desktop if needed, brings up the containers,
applies migrations and seeds catalogs when missing, starts the worker, and reports web
health. `pnpm status` reports without changing anything. Postgres and Redis now carry
`restart: unless-stopped` so they return with Docker.

The web app no longer shows a raw 500 when Postgres is down: `app/error.tsx` probes
`/api/health` (server errors are sanitised before reaching the client, so the message
cannot be parsed), names the fault, prints the fix, and hard-reloads once the database
answers. `apps/web/lib/db.ts` sets `connectionTimeoutMillis` — without it a stopped
container made every request hang instead of failing fast.

## Strategy: the graduated universe (Option B)
The ground-zero audit found the system discovering one market and judging it by another's
standards. `token-profiles/latest` returns brand-new launches with a **median pool of
$2,513**; entry demanded $30,000 liquidity and $250,000 volume. Exactly **1 of 229**
cleared both. Zero signals in 240 candidates was the arithmetic working, not a bug — at
$2.5k depth a $500 position costs **82% to round-trip and needs +458% to break even**.

Discovery now targets pump.fun coins that already **migrated to PumpSwap**. Measured
2026-08-21: `search?q=pumpswap` returned a median pool of **$127k with 27 of 30 above the
entry floor**, versus $8k and 0 of 6 from `token-profiles/latest`. The 98.6% that die have
already died. Configure with `DISCOVERY_QUERIES` and `DISCOVERY_MIN_LIQUIDITY_USD`
(default $15k — deliberately below the $30k entry floor so near-misses stay observable and
gradeable, but far above the dust).

**Discovery starvation (why the source swap alone did nothing).** Newly discovered mints
were appended *after* the due list and the result truncated to `MAX_CANDIDATES_PER_CYCLE`.
With 406 overdue candidates the backlog filled every cycle by itself and nothing new could
ever enter. Discovery now holds a reserved share of each cycle (`DISCOVERY_CYCLE_SHARE`,
default 0.4); the backlog fills the remainder.

## Tier-gated data is not "pending"
13 features measured **0% OK across ~1,500 evaluations each** — they need a paid indexer
(smart-money labels, wallet clustering, social attention). Reporting them as INCOMPLETE
told the user Core Safety was *pending*, which implies waiting resolves it. It never does;
it needs a purchase decision.

`TIER_UNAVAILABLE_FEATURES` in `packages/rule-engine/src/rules.ts` names them explicitly.
Rules answerable only by buying data return **NOT_APPLICABLE** with the reason, and SAFE-01
no longer blocks on them — but **obtainable data still blocks**, which is regression-tested
(`"the escape hatch is not a bypass"`). The unknowns stay visible as UNKNOWN RISK; they are
never silently upgraded to a pass.

### Corrections to the audit
Two of the audit's proposed cuts were wrong and were not made:
- `packages/legacy-import` is **not** unreferenced — `scripts/import-legacy.ts` calls it.
  The original grep covered `apps/` and `packages/` but not `scripts/`.
- `alert-engine` + `notifications` have sent 0 alerts because nothing ever reached
  ENTRY_READY. That is untriggered, not dead, and is exactly the path wanted once the
  graduated universe starts producing signals.

## The setup this system actually trades
Break-out → pull-back → hold → enter. `ProximityStage` named `RETEST_PENDING` and
`RECLAIM_PENDING` from the start and **returned neither** — the entry window itself, the
moment price comes back to the level it just broke, had no state and could not be shown,
ranked or waited for. Three defects made that possible:

1. **Breakout measured against the wrong level.** `lv.rangeHigh` spans the whole window
   including the breakout, so "price exceeded the range high" could never be true. The
   established base high (first 2/3) is the level, exactly as TOO_EXTENDED already did.
2. **Pull-back depth normalised by base width.** A 4%-wide base under a 12% breakout put
   the retest at "0.5 base-widths" and outside every sensible band. Distance to a broken
   level is a **percentage of that level**, not a multiple of the base.
3. **`reclaimConfirmed` was a single-tick check** (`now >= level`). It confirmed an entry
   the instant price touched back — a hair trigger, and the chase the system refuses
   everywhere else. It now requires `reclaimHoldObservations` (3) consecutive holds.

A confirmed reclaim more than `MAX_CHASE_ABOVE_BREAK` (8%) above the broken level is
`TOO_EXTENDED`, not an entry: previously that guard lived only in the no-structure branch,
so a runaway breakout kept the strongest label the engine has. All five stages are now
reachable and regression-tested against each other.

## Age window — fresh graduations, not mature tokens
Filtering on depth alone floated 26-day-old tokens to the top (CATE: 625h, $45m mcap,
+2.4% in 30m — a completed move, the worst possible entry). Measured age distribution on
`search?q=pumpswap`: 1–6h median pool $47k (3/3 tradeable), 6–24h $40k (5/7), >7d $711k
(already run). `DISCOVERY_MIN_AGE_MINUTES` (20) and `DISCOVERY_MAX_AGE_HOURS` (48) bound
the universe. The minimum is not caution — the setup needs a prior high to break out FROM,
and structure takes time to exist.

## Manufactured activity (`analyzeWashTrading`)
Holder concentration **cannot** catch bundled coins; bundling exists precisely to defeat
it, and it works. KEKODYSSEUS reported a top-10 of **17%** — healthier than most of the
fleet — while sitting at ENTRY_APPROACHING with a market that was bots trading themselves.

What bundling cannot fake is the shape of the flow:

    KEKODYSSEUS  $63,996 pool · $14,233 vol24 · 1,744 tx → turnover 0.22×, $8.16/trade
    WSOLP        $87,815 pool · $642 vol24    · 2,800 tx → turnover 0.007×, $0.23/trade

`ActivityClass` is REAL / THIN / PARKED / DUST_WASH / UNKNOWN. PARKED and DUST_WASH both
fail the quality floor and surface on the card. Note the labelling discipline: KEKODYSSEUS
is **PARKED**, not DUST_WASH — $8.16 a trade is small but not unambiguous dust, and moving
`MIN_AVG_TRADE_USD` to make it fit the louder label would be fitting the model to a guess.

## Calibrated to the position actually being traded
The whole system was built around a $500 nominal position — the slippage gate, the cost
model, and the tradability floors all inherited it. At a few euros those constraints
nearly vanish, and most of the market stops looking untradeable. `ENTRY_TRADE_SIZE_USD`
now defaults to **10**.

**Floors re-derived from forward outcomes**, not from the cross-sectional study:

    liquidity  8-20k   n=137  median dip -46%  46% halved
    liquidity 20-50k   n= 48  median dip -13%  31% halved   → MIN_LIQUIDITY_ENTRY_USD 20k
    vol24     <25k     n=125  median peak +4%  (dead)
    vol24  100-250k    n= 44  median peak +19% ← the old $250k floor excluded this
                                                → MIN_VOL24_ENTRY_USD 25k

The old $30k entry floor also sat *above* the $20k discovery floor, so 20–30k coins were
admitted and then permanently un-enterable; a test now pins entry ≤ discovery.

**Tradability is size-relative** (`tradableAtSize`). A fixed "$250k of daily volume"
answers the wrong question: the floor exists so the order does not move the market and
can be exited, which depends entirely on how much is at stake. Limits are 0.25% of pool
and 0.5% of 24h volume, so €10 clears a $20k pool while $500 does not.

**Age floor is one hour, not minutes.** Measured (h1 horizon):

    age <1h   n=258  median peak +11%  median dip -40%   43% HALVED
    age 1-6h  n= 75  median peak  +6%  median dip  -4%   13% halved
    age 6-24h n= 25  median peak +11%  median dip  -6%    4% halved

The first hour carries the same upside as the next twenty-three and ten times the
downside. Buying in the first minutes is the worst risk profile in the data.

**Turnover is a band, not a floor** (1–25×): below 0.5× the pool is parked (median peak
0%) and above 25× it is churn (median peak 0%, 26% halved).

## Finding coins before the move, not after it
Three separate defects meant every suggestion arrived already extended.

**1. The discovery source only sees large coins.** `search?q=pumpswap` ranks by liquidity,
so a coin appears only once it is big. Measured first-sighting market caps: MOMENTUM
$124k, catalyst $196k, RIKA $761k, BULLBALLS $892k, BREAKING $1.4m — while the band worth
entering is $10–50k. The launch feeds (`token-profiles/latest`, `token-boosts/latest`)
carry a median market cap of ~$14k and are now pulled alongside the search.

**2. Discovery spent every slot on coins it already had.** Search results were added to
the candidate set before the launch feed, and the reserved discovery slots (40% of a
25-coin cycle) filled with large caps that the due-list already rescans each cycle. The
small caps sat at the end of the set and were sliced off. Discovery now filters against
known mints first and spends its slots only on genuinely new ones — `new` and
`alreadyKnown` are both logged so this cannot silently regress.

**3. The liquidity floor was set for the wrong position size.** $20k is right for a $500
position and wrong for €10, and it was silently deciding which coins existed. Measured at
finer resolution:

    liq  2-4k  n=46  median peak  0%   (dead)
    liq  4-6k  n=29  median peak +5%   marginal against ~5% round-trip cost
    liq  6-8k  n=17  median peak +9%
    liq 8-12k  n=66  median peak +18%  p75 +51%
    liq 12-20k n=71  median peak +22%  p75 +62%   ← the productive band

The dead zone is below $4k, not below $8k. Floor is $6k.

## The entry area follows the trade, not the range top
`entryAreaLow` was `rangeHigh` in every case, so a coin that had pulled back was still
quoted an entry at the top of its own range — the level to sell into. Which level to buy
depends on the setup:

- broke out and retesting → the broken level (resistance became support)
- pulling back to a higher low → the swing low, with the stop just under it, capped at
  mid-range so chasing the bounce cannot creep back up

`PULLBACK_STAGES` (HIGHER_LOW_FORMING, PULLBACK_FORMING, BASE_FORMING) take the support
branch. With no support level the plan falls back rather than inventing one.

## Rug checks at $5–50k (`analyzeRugRisk`)
At launch stage most of the usual evidence does not exist yet, so the checks that remain
have to be the ones that end a coin outright. Built only from signals observable on the
free tier, and only from ones that survived checking against our own forward data.

| check | threshold | why |
|---|---|---|
| mint authority | active → DANGER | supply can be inflated under you |
| freeze authority | active → DANGER | your wallet can be frozen |
| largest single wallet | ≥20% → DANGER, ≥12% → concern | one exit ends the coin |
| top-5 float | ≥60% → DANGER, ≥40% → concern | the float is nominal |
| deployer holdings | ≥10% → DANGER | the creator has committed to nothing |
| market activity | DUST_WASH / PARKED → DANGER | bots, not a market |

**A top-10 aggregate cannot see this.** It hides the single case that matters most: one
wallet large enough to exit through the entire float. `analyzeInsider` now returns
`ownerShares` (per beneficial owner, pool/burn excluded) so the largest holder and the
top-5 are visible separately.

**Missing data is never CLEAN.** Unknown authorities or absent holder data yield UNKNOWN,
which the caller must treat as "not yet". A known disqualifier still outranks an unknown —
DANGER beats UNKNOWN.

**What did NOT survive checking.** "Only buys, no sellers" is common advice and it did not
hold up: buy-share ≥90% (n=12) produced a median peak of +6% against +4% for coins that
were mostly selling, with every middle bucket flat. It is recorded, not gated on. The bot
pattern that IS real is dust-sized trades against a parked pool, which `analyzeWashTrading`
already detects on trade size and turnover.

**`rug_risk` is a derived verdict, not a required dataset.** `requiredForSafety` governs
whether data must be PRESENT before Core Safety can pass; marking a judgement required made
every coin lacking it read INCOMPLETE. DANGER blocks through the hard-reject path in
`fundamentalWatch()`, where judgements belong.

**Dev-paid listings are recorded, not judged.** `/orders/v1/solana/{mint}` reveals whether
the creator paid for a Dexscreener profile or boosts. That cuts both ways — investment in
the project, or buying visibility to attract exit liquidity — and there is no forward data
yet to say which. It is captured so the grading pass can answer it later.
