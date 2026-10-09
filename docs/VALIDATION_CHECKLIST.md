# VALIDATION_CHECKLIST.md — Aureus Intelligence private alpha

A tick-box validation of the whole pipeline. Status legend: `[x]` verified this
pass · `[~]` works with a documented caveat · `[ ]` not yet / deferred.
Last validated: 2026-07-23 (Helius DEGRADED — no on-chain, expected).

## 1. Pipeline end-to-end (Dex Screener → DB → Feature → Rule → Snapshot → UI)
- [x] Dex Screener discovery poll returns Solana mints; bounded per cycle.
- [x] Normalization writes tokens/pools/candidates idempotently (candidate deduped on mint+pool).
- [x] Time-series persisted: prices, liquidity_snapshots, transaction_aggregates, observations.
- [x] Feature engine runs and persists 24 feature_values per candidate per poll.
- [x] Feature math verified against raw data (e.g. `liquidity_retention_15m` = latest/baseline; `data_completeness` = present/expected classes).
- [x] Rule engine runs and persists 18 rule_evaluations; aggregates computed.
- [x] State reducer sets candidate.current_state + append-only decision_state_history + notebook entry.
- [x] Discovery snapshot persisted once (immutable); outcome schedules created.
- [x] UI reads all of this from Postgres (server components).

## 2. Pages show correct live data
- [x] `/today` — stat tiles, ≤10 cards, live SSE bar (LIVE/OFFLINE, next-poll countdown, counts).
- [x] `/discover` — table + filters (verified `minLiq`, `state`); mock rows excluded.
- [x] `/candidate/[id]` — Safety/Quality/Entry/Timeline + alerts + "why this state".
- [x] `/candidate/[id]?debug=1` — **Debug Mode**: all 24 features, all rules, full transition history.
- [x] `/alerts` — honest empty-state under Helius DEGRADED.
- [x] `/system` — infra, worker heartbeat/uptime/avg-cycle, notifications, engine + policy versions.
- [x] All routes return HTTP 200; nonexistent candidate → 404; no runtime 500s.
- [x] Dex Screener deep-links use `solana/{pool}`.

## 3. Bugs / inconsistencies found this pass
- [x] **FIXED — duplicate processing of multi-pool mints.** A mint with >1 candidate
  (different pools) was processed once per candidate; `processMint` always resolves
  to the mint's primary pair, so it inserted **duplicate `(pool, observed_at)`
  time-series rows** and wasted API calls. Fix: dedup the cycle's work by mint;
  also advance the triggering (secondary) candidate's `next_scan_at`. Verified: the
  duplicate count held at 2 (pre-existing) and did **not** grow across further cycles.
- [~] **Unbounded append-only growth of `feature_values` / `rule_evaluations`.**
  ~24 + 18 rows written per candidate per poll even when values are unchanged
  (4330 → 8026 feature rows in minutes of soak). Not a correctness bug; **reads stay
  fast** (indexed: `feature_values_cand_idx`, latest-features plan 0.5ms). Recommended
  fix (next increment): persist a feature/rule row only when its value/status changes
  since the last one, or add periodic pruning/partition rotation. Documented in
  KNOWN_LIMITATIONS.
- [~] **`SAFE-05-LIQUIDITY-DRAIN` says "liquidity history unavailable" when only 15m
  data exists.** The rule needs the 1h retention + lp-change-rate inputs; with a
  gap in the series (worker restarts) these are MISSING → INCOMPLETE, which is
  correct, but the wording could mention 15m data is present. Cosmetic; no fix made.
- [~] **`worker_heartbeats.cycle_count` serializes as a string** in the SSE payload
  (pg returns bigint as text). Displays correctly; cosmetic type only.
- [x] No duplicate candidates created by repeated polling (candidates = distinct token+pool).
- [x] Missing/failed API response does not crash worker or UI.

## 4. Logging & debug info (why a candidate gets a state)
- [x] Worker logs each transition with `from`, `to`, `reason`, and `safety/quality/entry` aggregates (structured JSON).
- [x] `decision_state_history.reason` stored and shown on the candidate page ("Why this state").
- [x] Debug Mode surfaces the exact features + rules + transitions behind the state.

## 5. Debug Mode on candidate page
- [x] Toggle `⚙ debug mode` / `✕ exit debug mode` (via `?debug=1`).
- [x] Table of all 24 feature values (status, value, window, reason).
- [x] Table of all 18 rule evaluations (family, result, severity, explanation, changes-if).
- [x] Table of all state transitions (from→to, safety, entry, reason).

## 6. Multi-hour soak (worker safety)
- [x] Worker runs continuously across many cycles (10+ observed), 0 errors.
- [x] **Memory stable** — RSS ~52–59MB, no upward drift (no leak) over the soak window.
- [x] **CPU** near-idle between cycles (~0.1%), short cycle bursts (~300ms).
- [x] **No duplicate processing** after the fix (duplicate rows flat).
- [x] **API errors / retries** — HTTP adapter has retries+backoff+jitter; circuit
  breaker unit-tested (opens after 5 failures, half-opens after cooldown). 0 live errors this run.
- [x] **Stale data** — freshness feature + per-record UI badges (fresh/aging/stale); STALE blocks green states.
- [x] **Database performance** — key query plans use indexes (candidate page 0.5ms, today 0.2ms).
- [~] Longer (multi-day) soak not run in this environment; extrapolated from a stable ~1.5h window. Run under PM2/Docker for true 24/7 (OPERATIONS.md).

## 7. Determinism & safety invariants (re-confirmed)
- [x] Missing Helius data → Safety INCOMPLETE → candidate UNRESOLVED (never PASS).
- [x] Hard FAIL cannot be compensated by positive rules.
- [x] Stale / conflicting data blocks ENTRY_READY.
- [x] Duplicate polling / worker restart → no duplicate alert (exact-once dedup).
- [x] Helius DEGRADED prevents ENTRY_READY alerts.
- [x] Graceful shutdown on SIGINT/SIGTERM (lock released, pool closed).
- [x] 81 automated tests pass; full typecheck clean.

## 8. Write amplification (Phase 5)
- [x] feature_values written only on change (new / status / numeric>epsilon / evidence / version / checkpoint); NaN/Inf never stored.
- [x] rule_evaluations written only on change (result / severity / evidence / missing-fields / version / checkpoint).
- [x] Raw observations kept full-resolution (prices/liquidity/tx +1 per candidate/cycle).
- [x] Per-cycle growth dropped ~85% (features) / ~93% (rules) at steady state; stable candidates ≈ 0.
- [x] Indexes present: `feature_values_cand_idx`, `rule_evaluations_rule_idx`, `(pool_id, observed_at DESC)`.
- [x] 16 change-detection unit tests cover every rule (epsilon, status, UNAVAILABLE→OK, version, checkpoint, NaN/Inf).

## 9. Readiness / why-not (Phase 5)
- [x] Deterministic coverage per family (pass/fail/incomplete + required inputs available/total) — no probability.
- [x] "Why not progressing?" shows blocker, confirmed ✓, missing ○ (human-readable), next conditions, next eligible state.
- [x] A FAIL is shown as a blocker, not "missing"; next eligible state = null when a FAIL blocks.
- [x] Strongest positive is deterministic (severity → family → PASS), freshness only as fallback.
- [x] Cards show ≤2 blockers + "+N missing safety checks".
- [x] Helius DEGRADED still blocks entry progression (states unchanged: 0 promoted).
- [x] Debug Mode intact (features + rules + transitions + versions + evidence hashes).
- [x] 11 readiness unit tests; no probability language anywhere.
- [x] Today / Discover / Candidate render readiness; Discover sorting works; all routes 200; mobile holds.

## 10. Validation Lab (Phase 6)
- [x] Replay Engine: playable price sparkline + event timeline per candidate.
- [x] Paper Tracking: automatic per-cycle + `pnpm validation:compute` backfill; horizons 15m–7d.
- [x] Anti-look-ahead: points past the horizon never used (unit-tested); incomplete windows flagged.
- [x] Validation Dashboard `/validation` (counts, returns, winrate, rugs, lifespan, growth, drawdown, top/bottom 10).
- [x] Compare Engine: cohort vs rest (winrate / mean-median return / drawdown / rug%).
- [x] Rule Attribution `/validation/rules`: PASS/FAIL/INCOMPLETE, mean peak per group, rug%, significance, no-edge flag.
- [x] Research Mode `/validation/research`: factual queries (shared rules, strongest features, blockers never present).
- [x] No probability/confidence claims (asserted by research tests); numbers are facts only.
- [x] Honest window-coverage caveat shown (24h+ incomplete); all routes 200; 115 tests pass.

## 11. Async Helius enrichment + monitoring tiers (Phase 7)
- [x] Discovery/market pipeline unblocked when Helius is offline (DEGRADED run).
- [x] Async Redis queue: idempotent enqueue, per-candidate lock (no double-run), backoff retries, dead-letter.
- [x] Enrichment idempotent (same response hash → no change, single upsert row).
- [x] Partial data stays INCOMPLETE; nothing fabricated; real FAIL shown separately from "awaiting data".
- [x] Helius failure isolated (circuit breaker); market rules unaffected; token never logged.
- [x] Incremental recompute on enrichment (holders → holder_concentration → safety → state), no forced promotion.
- [x] Monitoring tiers deterministic (T0–T4); WATCH > UNRESOLVED, ENTRY_WATCH > STRUCTURE_WATCH; REJECTED dormant; next_scan_at persisted.
- [x] UI: candidate enrichment panel + blocked rules; /system enrichment+tier stats; /today counts; /discover filter+priority sort.
- [x] Existing Validation Lab + all prior tests still pass (135 total).
- [ ] LIVE Helius verification + 1h/12h/24h reports — **requires your HELIUS_API_KEY + uptime** (not runnable here).

## How to re-run this checklist
```bash
pnpm db:start && pnpm db:migrate && pnpm db:seed
pnpm worker:start          # let it run; watch /today LiveBar + /system heartbeat
pnpm test                  # 81 tests
# open /candidate/<id>?debug=1 to inspect any candidate's features/rules/transitions
```
