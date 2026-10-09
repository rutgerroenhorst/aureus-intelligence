# VALIDATION_REPORT.md — Aureus Intelligence

This report grows each phase. It records **actual command output**, not claims.
Phase 8 will add the full end-to-end MVP validation.

---

## Phase 1 — foundations, tooling, DB, ingestion adapters, legacy importer

Environment: macOS (Darwin 25.2.0), Node v24.16.0, pnpm 9.15.0 (via corepack),
Docker Desktop, PostgreSQL 16-alpine, Redis 7-alpine. Run date: 2026-07-22.

### Install / typecheck / tests

```
$ corepack pnpm install        → Done (165 packages)
$ corepack pnpm typecheck       → tsc -b, exit 0 (no errors)
$ corepack pnpm test            → 3 files, 23 tests passed
   ✓ packages/config/src/config.test.ts        (6 tests)
   ✓ packages/legacy-import/src/legacy-import.test.ts (8 tests)
   ✓ packages/ingestion/src/ingestion.test.ts  (9 tests)
```

Tests cover: source-mode resolution (Helius DEGRADED without a key, LIVE with
one), env validation failure, token-bucket limiter with an injected clock, Helius
UNAVAILABLE/MOCK labelling, Bubblemaps iframe + gated-cluster refusal, FOMO exact
mint resolution, importer value-guards / column-resolution / entity-detection.

### Environment check (`pnpm env:check`)

```
dexscreener   LIVE      (public REST, polling)
geckoterminal LIVE      (public REST, 10 rpm free)
helius        DEGRADED  (no HELIUS_API_KEY → on-chain checks UNAVAILABLE; Safety cannot PASS)
bubblemaps    DEGRADED  (iframe)
fomo          DEGRADED  (manual import only)
```

### Database migration (`pnpm db:migrate`)

A real error was caught by running against live Postgres and fixed:
`window` is a reserved word — `wallet_performance.window` → `perf_window`.
After the fix:

```
Applied (3): 0001_init.sql, 0002_roles.sql, 0003_legacy_staging.sql
Skipped (0): -
OK
```

### Structural validation (`pnpm db:validate`) — 56/56 checks passed

```
9 enums present · 32 tables present · 2 immutability triggers present
3 partitioned parents each with ≥1 partition
representative indexes present · representative unique constraints present
immutability enforced (decision_state_history UPDATE correctly blocked)
idempotent migrations (2nd run applied 0)

56/56 checks passed, 0 failed.
```

### Legacy importer end-to-end (synthetic workbook, `--commit`)

Verified against a synthetic workbook with Wallet DB / Blacklist / Candidate
Pipeline / Unresolved sheets (the real `Wallet_Deployer_Intelligence_DB.xlsx` was
not yet delivered):

```
Totals: IMPORTED=3  SKIPPED=1  UNRESOLVED=3  CONFLICTING=1
DB after commit:
  tokens=1  candidates=1  wallet_entities=1  blacklisted=1  discovery_snapshots=1
```

Confirmed behaviours: wallet deduped across two sheets into one entity; blacklist
flag applied; one valid candidate promoted with an **immutable discovery
snapshot**; a duplicate identity flagged **CONFLICTING**; a bad-mint row and the
Unresolved sheet kept **UNRESOLVED** (never promoted); an empty row **SKIPPED**;
original discovery timestamps and source refs preserved; the original row kept in
`raw_import_payload`.

### Reset (`pnpm db:reset`)

```
Dropping and recreating schemas (public, legacy)...
Re-applied 3 migrations. → tokens=0, staged=0, migrations=3 (clean)
```

### Status
Phase 1 exit criteria **met**. Database is clean and ready for the real legacy
import. Outstanding: run the real `Wallet_Deployer_Intelligence_DB.xlsx` once
delivered; add a `HELIUS_API_KEY` to flip Helius LIVE (optional).

---

## Phase 2 — Feature / Rule / Snapshot / Outcome engines + notebook

Run date: 2026-07-22. Same environment as Phase 1, migration `0004_engines.sql`
applied.

### Install / typecheck / tests
```
$ corepack pnpm typecheck   → tsc -b, exit 0 (no errors)
$ corepack pnpm test        → 7 files, 51 tests passed
   ✓ config (6) · legacy-import (8) · feature-engine (9) · rule-engine (9)
   ✓ ingestion (9) · outcome-engine (5) · tests/integration (5, live Postgres)
```

### Migration 0004 + seed
```
$ pnpm db:migrate → Applied 0004_engines.sql (idempotent on re-run)
$ pnpm db:seed    → Seeded 24 features, 18 rules, 4 engine versions
DB check: 11 engine tables · 7 immutability triggers · 24 feature_definitions · 18 rule_definitions
```

### Required Phase-2 validations (all covered by passing tests)
| Requirement | Where | Result |
|---|---|---|
| Missing Helius data prevents Safety PASSED | rule-engine.test.ts | Safety = INCOMPLETE → state UNRESOLVED ✓ |
| Hard FAIL cannot be compensated | rule-engine.test.ts | insider FAIL → REJECTED despite green quality ✓ |
| Stale data blocks ENTRY_READY | rule-engine.test.ts | freshness FAIL → ENTRY_WATCH ✓ |
| Same input + same engine version → same result | feature/rule determinism tests | deep-equal ✓ |
| Snapshots immutable | integration.test.ts | UPDATE rejected ("immutable") ✓ |
| Rule history survives state transition | integration.test.ts | rule_evaluations count unchanged after 2 transitions ✓ |
| Feature versioning works | integration.test.ts | 2 versions retained (append-only) ✓ |
| Outcome uses no future data | outcome-engine.test.ts | spike beyond horizon ignored; window_complete flag ✓ |
| Duplicate events idempotent | integration.test.ts | duplicate outcome horizon rejected (UNIQUE) ✓ |

### Real public candidate (`pnpm validate:live`)
Fetched a live Dex Screener Solana token (mint `A4LE…pump`, pool `9bM4…kTuj`).
Feature engine computed `marketcap_liquidity_ratio=4.34`, `buyer_seller_ratio=4.04`,
`data_completeness=0.5`, `data_freshness=1`; retention/growth = MISSING (single
snapshot); all on-chain features = UNAVAILABLE (no Helius). Decision:
**Safety=INCOMPLETE, Quality=WEAK → state UNRESOLVED** — the correct, non-fabricated
outcome.

### Status
Phase 2 exit criteria **met**. No UI built (per the review gate). Outstanding:
wire the engine runner/scheduler into a worker process and build the reporting
queries (Deliverable 8) in the next increment.

---

## Phase 3 — Working vertical slice (worker + Next.js web app)

Run date: 2026-07-22. Node 24, Next.js 14.2.15, Postgres 16 + Redis 7.

### Build / typecheck / tests
```
$ corepack pnpm typecheck                  → tsc -b, exit 0
$ corepack pnpm -C apps/web exec tsc --noEmit   → exit 0 (web)
$ corepack pnpm exec tsc --noEmit -p apps/worker/tsconfig.json → exit 0 (worker)
$ corepack pnpm test                       → 7 files, 51 tests passed
```
Two real bugs caught by running the worker against live data + Postgres and fixed:
`rule_evaluations` had no `spec_version/param_hash` columns; a `discoveryAtMs`
shorthand typo. Both fixed; worker then processed 8/8.

### End-to-end pipeline (real Dex Screener data)
```
$ pnpm worker:once  → processing 8 candidate mint(s) (helius=DEGRADED)
                      8/8 processed → all UNRESOLVED
DB after runs: 17 candidates = 17 distinct (token, pool)  → no duplicates
               582+ feature_values · 291+ rule_evaluations · snapshots · schedules
```

### Required slice validations (verified live in the browser)
| Requirement | Result |
|---|---|
| Homepage renders with database data | /today shows tiles (9 scanned, 8 unresolved, 1 researching) + cards ✓ |
| Discover filters work | `?minLiq=15000` returned only ≥$15K rows ✓ |
| Candidate page renders rule evidence | Safety/Quality/Entry rules with evidence + "changes if" + missing ✓ |
| Helius DEGRADED shown visibly | /system "DEGRADED · on-chain UNAVAILABLE"; candidate "DATA INCOMPLETE" banner ✓ |
| Incomplete safety blocks Entry Ready | all candidates UNRESOLVED, reason "Critical safety data is incomplete" ✓ |
| Stale records labelled | per-record freshness badges (fresh/aging/stale) ✓ |
| Duplicate polling → no duplicate candidates | 17 candidates = 17 distinct (token,pool) after repeated cycles ✓ |
| Missing API response doesn't crash UI | null price/liquidity render as "—"; worker logs + continues ✓ |
| Mobile layout doesn't break | 375px: tiles reflow, cards stack, nav scrolls ✓ |
| Dex Screener link uses chain/pool | `https://dexscreener.com/solana/{poolAddress}` ✓ |
| Fixtures never shown as live | mock/manual candidates excluded from all UI queries ✓ |

### Screenshots
Captured live (in the session transcript): /today (desktop + mobile), /discover
(with a filter applied), a candidate detail page (Safety/Quality/Entry/Timeline),
and /system.

### Status
Vertical-slice exit criteria **met**. Stopping at the review gate. Next increment:
wire Helius on-chain adapters (so candidates can progress past UNRESOLVED), a
snapshot/outcome scheduler, GeckoTerminal OHLCV for Entry structure, and SSE live
updates. See KNOWN_LIMITATIONS.md.

---

## Phase 4 — Continuous scanner + Telegram alerts + monitoring

Run date: 2026-07-23. Migration `0005_alerts.sql` applied.

### Build / typecheck / tests
```
$ corepack pnpm typecheck                → exit 0
$ tsc --noEmit (apps/worker, apps/web)   → exit 0
$ corepack pnpm test                     → 11 files, 81 tests passed
   new: alert-engine (15) · notifications (7) · tests/alerts (4, DB) · apps/worker reliability (4)
```

### Continuous worker — verified live
```
$ pnpm worker:start (WORKER_TICK_SECONDS=5)
  → started, RUNNING heartbeat, 10 cycles observed
  → adaptive polling: 16 candidates cycle 1, then 1/cycle, 9 when discovery re-ran
  → SIGINT → "shutting down" → heartbeat STOPPING → clean exit (lock released)
```

### Required Phase-4 validations
| Requirement | Where | Result |
|---|---|---|
| Worker runs multiple cycles | live run | 10 cycles, JSON logs ✓ |
| Duplicate polling → no duplicate alert | tests/alerts.test.ts | dedup on evidence_hash ✓ |
| Worker restart → no duplicate alert | tests/alerts.test.ts | fresh channel still "duplicate" ✓ |
| ENTRY_READY without Safety PASS → nothing | alert-engine.test.ts | not emitted ✓ |
| Stale data → no high-priority alert | alert-engine.test.ts | freshness gate blocks ✓ |
| Critical Safety FAIL → RISK alert | alert-engine.test.ts | RISK emitted ✓ |
| Telegram failure is retried | tests/alerts.test.ts | retryPendingDeliveries → SENT ✓ |
| Token never in logs | notifications.test.ts | error sanitized, no token ✓ |
| Delivery correctly recorded | tests/alerts.test.ts | status SENT + message_id ✓ |
| Cooldown works | tests/alerts.test.ts | new-hash within window → cooldown ✓ |
| New valid transition → new alert allowed | alert-engine.test.ts | different hash ✓ |
| Mock candidates never alert live | worker guard + UI excludes source mock/manual | ✓ |
| Helius DEGRADED prevents ENTRY_READY | alert-engine.test.ts | never fires ✓ |
| Worker heartbeat updated | live run + /system | RUNNING/STOPPING ✓ |
| UI works while worker offline | browser | LiveBar OFFLINE, pages render ✓ |
| Circuit breaker after repeated errors | reliability.test.ts | opens/half-opens ✓ |
| Graceful shutdown | live run | SIGINT clean exit ✓ |
| Bounded concurrency | reliability.test.ts | ≤ limit ✓ |

Tests use a **FakeChannel**; a real Telegram message is sent only via
`pnpm telegram:test` with valid credentials.

### Web (verified in browser)
`/today` LiveBar shows **LIVE** (green pulse) with next-poll countdown, cycles,
scanned/alerts today, queue, Telegram mode — and **OFFLINE** when the worker is
stopped. `/alerts` renders (honest empty-state under Helius DEGRADED). `/system`
shows worker heartbeat, uptime, avg cycle, notification queue, Telegram
connectivity, and active alert-policy version. Mock/test alerts are excluded from
all live views.

### Status
Phase-4 exit criteria **met**. Stopping at the review gate. The 24/7 scanner runs
and can send reliable, deduplicated Telegram alerts; with Helius still degraded, no
entry alerts fire on live data yet (correct). Next: wire Helius on-chain so
candidates progress and real alerts flow.

---

## Phase 5 — Write-amplification fix + readiness / why-not

Run date: 2026-07-23. Migration `0006` applied. No state-machine or threshold
change; no Telegram/Helius/new-source work.

### Build / typecheck / tests
```
$ corepack pnpm typecheck    → exit 0 (root + apps/web + apps/worker)
$ corepack pnpm test         → 13 files, 108 tests passed  (new: changeDetect 16, readiness 11)
```

### Write amplification — before vs after (same ~25-candidate cycles)
| Table | Before (per cycle) | After steady-state | Reduction |
|---|---|---|---|
| feature_values | ~437 | ~63–71 | ~85% |
| rule_evaluations | ~327 | ~21–29 | ~93% |
| raw prices (time-series) | 25 | 25 | 0% (preserved by design) |

The after-residual is real market movement — only the ~3 price-derived features per
actively-traded token that crossed epsilon are written; the ~21 unchanged features
(MISSING/UNAVAILABLE + within-epsilon numerics) are skipped. Truly stable candidates
write ~0 feature/rule rows per cycle. The one-time first cycle after deploy rewrites
each candidate once to back-fill evidence_hash.

### Success criteria (§9)
- feature/rule row growth drops sharply for stable candidates (~85% / ~93%).
- raw observations remain full-resolution (prices/liquidity/tx +1 per candidate/cycle).
- STATE OUTCOMES UNCHANGED by the persistence change: 129 UNRESOLVED, 18 REJECTED,
  0 promoted to STRUCTURE_WATCH/QUALITY/ENTRY. No artificial promotion.
- readiness summaries match the underlying rules (verified on the candidate page).
- worker stable; all 108 tests pass.
- indexes present: feature_values_cand_idx, rule_evaluations_rule_idx, (pool_id, observed_at DESC).

### Readiness / why-not (verified in browser)
- Today cards: coverage chips S/Q/E + Data%, deterministic strongest positive
  (freshness only as fallback), blocker with <=2 readable items + "+N missing safety
  checks", last meaningful change.
- Discover: sort by discovered/freshness/liquidity/volume/pair-age/data-completeness/
  incomplete-critical; Safety S/Q/E, Data%, Blocker, Last-change columns.
- Candidate: readiness header (coverage + inputs available/total, data completeness)
  + "Why not progressing?" (blocked-by, already-confirmed, still-missing human-readable,
  next conditions, next eligible state = null when a FAIL blocks). Debug Mode intact
  (features + rules + transitions + versions + evidence hashes).
- No probability/confidence language anywhere (asserted by a readiness test).
- All routes 200 (incl. sorts + debug); mobile layout holds.

### Status
Phase-5 exit criteria met. Stopping at the review gate. Deterministic state machine
unchanged; UNRESOLVED candidates are now clearly differentiated by readiness + blocker.

---

## Phase 6 — Validation Lab (research + validation)

Run date: 2026-07-23. Migration 0007 applied. No new signals/sources/Telegram/Helius.

### Build / typecheck / tests
```
$ corepack pnpm typecheck   → exit 0 (root + web + worker)
$ corepack pnpm test        → 14 files, 115 tests passed  (new: research 7)
```

### Paper tracking backfill (pnpm validation:compute)
```
candidate_research = 206  rugs = 11  24h-complete = 0
window completeness by horizon: m15=205 m30=202 h1=196 h2=188 h4=156 h8=93 h24/d3/d7=0
```
Automatic: the worker also recomputes paper tracking per candidate each cycle.

### Research findings (facts from the data, verified in browser)
- Dashboard (206 candidates): avg peak run-up +47%, median final -46%, winrate 22%,
  rug rate 5%, avg lifespan 5.7h, avg liquidity growth +27%, avg drawdown -48%.
- Compare engine (directional, small samples): SAFE-05 Liquidity-stability PASS
  (n=17) mean peak +171% / mean final +15% vs rest +36% / -28%; discovery liquidity
  ≥$25k (n=14) rug 50% vs 2% (a surprising anti-signal worth flagging).
- Rule attribution: most SAFETY/QUALITY rules all-INCOMPLETE → "not yet measurable";
  measurable ones (Not overextended, Capital retention, Liquidity stability) show
  PASS/FAIL splits. No probability language emitted.
- Research mode (peak ≥ 300%): 4 candidates (Syrax +1857%); shared Data-freshness
  100%, Liquidity-stability 50%; blockers never present listed.
- Replay: playable price sparkline + event timeline per candidate (verified on Syrax).

### Anti-look-ahead
Paper tracking uses only in-window points; points past the horizon are never read
(unit-tested — a spike beyond 1h does not affect the 1h run-up); incomplete windows
flagged, not fabricated.

### Status
Phase-6 exit criteria met. Stopping at the review gate. The lab proves the
*framework* works and already differentiates cohorts; conclusive edge measurement
needs (a) continuous multi-day tracking for 24h+ windows and (b) Helius for the
on-chain rules. No trading logic added.

---

## Phase 7 — Async Helius enrichment engine + priority-tier monitoring

Run date: 2026-07-23. Migration 0008 applied. No Telegram/new-sources/new-signals.

### Build / typecheck / tests
```
$ corepack pnpm typecheck   → exit 0 (root + web + worker)
$ corepack pnpm test        → 18 files, 135 tests passed  (new: queue 6, tiers 7, enrichment 5 + DB 2)
```

### Verified in DEGRADED mode (no Helius key — the state I can run)
- Discovery + market pipeline runs normally with Helius offline (cycle ~1.7s, 25 candidates).
- Enrichment NOT enqueued (all 220 candidates NOT_REQUESTED); nothing fabricated.
- Monitoring tiers assigned deterministically: T0 dormant 28 · T1 low 189 · T2 enrichment 3 · T3/T4 0.
- /system shows Helius DEGRADED · enrichment paused, queue depth 0, breaker, status + tier counts.
- Candidate page: enrichment status, per-dataset progress, "awaiting Helius — data wait, not a rule failure",
  and the six Helius-dependent rules shown INCOMPLETE · awaiting data.
- /discover: enrichment column + filter + sort by monitoring priority.

### Unit/integration-tested guarantees
| Requirement | Test |
|---|---|
| Discovery works when Helius offline | DEGRADED run + drainEnrichment early-return |
| Enrichment job processed once (idempotent) | queue.test.ts |
| Duplicate response is idempotent | enrichment.test.ts (same response hash, upsert, 1 row) |
| Restart → no duplicate job | queue Redis dedup + lock (design) |
| Partial data stays INCOMPLETE | enrichment.test.ts (deployer/insider/bundle INCOMPLETE) |
| Real FAIL not shown as missing | UI: FAIL vs INCOMPLETE·awaiting data separated |
| Complete enrichment triggers reevaluation | worker drain enqueues REEVALUATE on change |
| Helius failure → retry→backoff→dead-letter | queue.test.ts + drain error path |
| Rate-limit/timeout → backoff | HTTP timeout + backoffMs |
| Token never in logs | helius.sanitizeMsg + notifications test pattern |
| WATCH scanned > UNRESOLVED; ENTRY_WATCH > STRUCTURE_WATCH | tiers.test.ts |
| REJECTED not normally rescanned | tiers dormant + dueCandidates excludes TIER0 |
| Restart preserves next_scan_at | persisted in DB (not memory) |
| Existing Validation Lab + tests still pass | 135 tests green |

### Live-Helius gap (honest)
The **live verification (LIVE mode, real enrichment jobs, features UNAVAILABLE→AVAILABLE,
rules INCOMPLETE→PASS/FAIL, a real state re-evaluation) and the 1h/12h/24h reports
require a HELIUS_API_KEY and continuous uptime** — I have no key and cannot run for
hours. Add the key to `.env.local`, run `pnpm worker:start`, and `/system` +
`/candidate` will show the transitions. Even then, because only holders + authorities
are implemented (deployer/insider/bundle pending), Safety may stay INCOMPLETE and
candidates legitimately UNRESOLVED — reported, not forced.

### Status
Phase-7 exit criteria met for what is runnable without a key. Stopping at the review
gate. The next phase (per your note) is designing the Entry Engine — NOT built yet.

---

## Phase 8 — Enrichment queue + reevaluation fix (reeval=0 / queue growth)

**Symptoms reported (LIVE, your machine):** queue depth 25→39→41→42→53; every cycle
`status=PARTIAL, changed=true` yet `reeval=0`.

**Root cause:** the queue was a single Redis ZSET with every job scored `0`.
`ZRANGEBYSCORE` breaks score ties **lexicographically by member**, and
`"HELIUS_ENRICHMENT"` < `"REEVALUATE_CANDIDATE"`, so under a per-cycle claim limit the
reevaluations at the tail were never reached. Enrichment ran; reevals starved; the
reeval jobs (and re-queued work) accumulated → depth grew.

**Fix (queue + drain only — nothing new built):**
- One ZSET **per job type** (`aureus:enrich:z:<type>`); UUID job `id`.
- Dedup key = `<job_type>:<candidate_id>` (≥ candidate_id + job_type + version), and a
  per-`(type,candidate)` lock so enrichment and reeval for the same candidate don't block.
- Fair drain: claim **REEVALUATE_CANDIDATE first** (bounded `MAX_REEVAL_PER_CYCLE`=10),
  then HELIUS_ENRICHMENT (`MAX_ENRICH_PER_CYCLE`=5, not raised).
- `ack` only after the work succeeds; retry w/ backoff+jitter; dead-letter after 5.
- Only a **changed** enrichment enqueues a REEVALUATE → idempotent responses stop the
  per-cycle re-queue growth.
- Helius RPC token-bucket (`HELIUS_RPS`=8, burst 3); `429`+`Retry-After` → retryable backoff.
- Trace logs `candidate_id`/`job_id`/`job_type`/`stage` only — never key/RPC URL.

**Evidence (runnable without a key):**

| Proof | How |
| --- | --- |
| REEVALUATE not starved by 40 HELIUS jobs | queue.test.ts "REEVALUATE is NOT starved…" |
| Same-candidate enrich + reeval don't block | queue.test.ts "…do not block each other" |
| Feature `holder_concentration` UNAVAILABLE→OK after enrichment | tests/enrichment.test.ts recompute test |
| Enrichment idempotent (no re-queue on identical response) | tests/enrichment.test.ts idempotency |
| Full suite green, no regression | 138 tests pass (was 135) |

Queue-mechanics simulation (6 cycles, 8 new HELIUS/cycle, each enrich→1 REEVAL):

| Design | queue depth | enriched | REEVAL processed |
| --- | --- | --- | --- |
| OLD (single ZSET, lex ties) | 48 (growing) | 30 | **0 (starved)** |
| NEW (per-type + reeval-first) | 23 | 30 | **25 (drains)** |

**Live gap (honest):** the real before/after numbers you asked for — queue depth
stabilizing over time, enqueue/completion rates, reeval **latency** with real Helius,
and a real feature UNAVAILABLE→AVAILABLE + rule INCOMPLETE→PASS/FAIL on a live
candidate — require **your HELIUS_API_KEY and continuous uptime**. I have no key, so I
proved the mechanism with unit tests + a deterministic simulation, not a live run.
After you restart the worker, the heartbeat detail now carries `enrichQueueByType`,
`uniqueQueued`, `oldestJobAgeMs`, `enriched`, `reeval`, and full `queueStats` so the
live before/after is visible in `/system`. Stopping at the review gate.
