# KNOWN_LIMITATIONS.md — Aureus Intelligence (alpha vertical slice)

Honest list of what this slice does **not** yet do. None of these are hidden in
the UI — the app labels missing/degraded data everywhere.

## Data / coverage
1. **On-chain (Helius) not wired.** Deployer, funding, holders, clusters, bundles,
   authorities, sellability are all UNAVAILABLE. Consequently **Safety never
   PASSes** and every candidate stays UNRESOLVED (or RESEARCHING before its first
   full evaluation). This is by design until a Helius key + on-chain adapters land.
2. **Unique buyers/sellers approximation.** Dex Screener aggregates give buy/sell
   *transaction* counts, not unique wallets, so `unique_buyer_growth` and
   `buyer_seller_ratio` are MISSING (we do not fake unique-wallet counts).
3. **GeckoTerminal not yet polled by the worker.** The adapter exists (verification
   / OHLCV, 10 rpm) but the slice ingests Dex Screener only; OHLCV-based Entry
   structure features are therefore MISSING.
4. **Discovery source = Dex Screener token-profiles.** These skew to freshly
   promoted / pump.fun tokens, several of which report no standard pool liquidity
   (shown as "—", not zero).

## Engine / pipeline
5. **Only the discovery snapshot is taken by the worker.** Later horizons
   (+15m…+30d) are scheduled (`outcome_schedules`) but a scheduler to fire them and
   run the outcome engine is not yet wired.
6. **Outcome measurement not yet executed on a timer.** The engine + schedules
   exist and are tested; the periodic runner is next-increment work.
7. **Time-series rows accumulate per poll.** No compaction yet; fine at slice
   volumes.

## Web
8. **Read-only, no realtime push.** Pages are server-rendered with
   `force-dynamic` (fresh on each load); there is no SSE/websocket live update yet
   — reload to refresh.
9. **No auth.** Private local alpha only; do not expose the port publicly.
10. **Mock/test candidates are filtered out** of the UI (source `mock`/`manual`)
    rather than deleted, because their history rows are immutable by design.

## Ops
11. **Stale-response fallback is partial.** On a failed Dex Screener poll the
    worker records `source_health` DEGRADED and skips the cycle; it does not yet
    replay the last successful response as a labelled-STALE view (the UI already
    shows per-record freshness, so nothing is presented as fresher than it is).
12. **Redis is running but only used for the ingestion rate-limiter in-process.**
    The distributed limiter / queue is not yet the transport between worker and web.

## On-chain enrichment (Phase 7)
28. **No Helius key in this environment** → enrichment runs in DEGRADED (paused).
    Live enrichment, features UNAVAILABLE→AVAILABLE, rule INCOMPLETE→PASS/FAIL, and
    the 1h/12h/24h reports require your key + continuous uptime — not runnable here.
29. **Only holders + authorities enriched so far.** Deployer, funding source,
    insider concentration, launch bundles, and sell simulation need a funding/tx
    graph — still INCOMPLETE, so even with a key Safety may not fully PASS and
    candidates can legitimately stay UNRESOLVED (not a bug).
30. **Enrichment is one datapoint set per candidate** (recomputable), refreshed
    after `ENRICHMENT_TTL_MINUTES`; no historical on-chain series yet.
31. **liquidity/volume trend inputs to priority are null for now** (computed from
    stored series is a future refinement) — tiers still order correctly by state +
    proximity + staleness.

## Validation Lab (Phase 6)
23. **No complete 24h/3d/7d windows yet.** The scanner has not run continuously for
    a full day, so those horizons are reported as incomplete — not as final returns.
    Fix: run `pnpm worker:start` for several days, then re-read `/validation`.
24. **On-chain rules cannot be attributed** while Helius is off — they are
    all-INCOMPLETE (no PASS/FAIL variance). Only price/liquidity-driven rules split.
25. **Small cohorts.** Measurable-rule cohorts are tens, not hundreds → attribution
    verdicts are conservative ("not yet measurable"); compare-engine deltas are
    directional, not statistically conclusive.
26. **Rug heuristic** = liquidity < 10% of discovery; it can miss slow bleeds and is
    only as good as the sampled liquidity series.
27. **Discovery price = first observation**, which for tokens listed before we began
    polling is later than pair creation — early pre-discovery moves are not captured.

## Persistence / readiness (Phase 5)
19. **RESOLVED — feature_values/rule_evaluations write amplification.** Change-based
    persistence now writes a feature/rule row only on a meaningful change (or a 60-min
    audit checkpoint), cutting per-cycle growth ~85% / ~93%. Historical rows and
    immutable snapshots are preserved; raw time-series stays full-resolution.
20. **Readiness is a persisted summary updated on meaningful change.** Lists
    (Today/Discover) read the denormalized `candidates.readiness`; the candidate
    detail computes it live for freshness. Both use the same deterministic model.
21. **Audit-checkpoint rewrites.** Every feature/rule is re-persisted at least once
    per `FEATURE/RULE_AUDIT_CHECKPOINT_MINUTES` (default 60) even if unchanged, as an
    integrity heartbeat — a small, bounded write floor by design.
22. **Old rows carry NULL evidence_hash** until first re-touched after deploy, so the
    first cycle post-migration rewrites each candidate once to back-fill it.

## Alerts / worker (Phase 4)
13. **No live entry alerts yet.** Because Helius is not wired, candidates stay
    UNRESOLVED, so NEW_WATCH / HIGH_PRIORITY / ENTRY_READY never fire on live data.
    The full alert path is verified with fixtures + a fake Telegram transport.
14. **SYSTEM-level Telegram alerts not delivered yet.** Worker-offline / source-down
    / queue-backlog signals are tracked (`worker_heartbeats`, `source_health`) and
    shown on `/system`, but are not yet pushed to Telegram (only candidate alerts are).
15. **Docker app image not built in the sandbox.** `Dockerfile` + the `apps` compose
    profile are provided but unbuilt here; the tested 24/7 path is PM2 (`OPERATIONS.md`).
16. **Single-instance assumption if Redis is down.** The distributed lock degrades
    to "run anyway" when Redis is unreachable, so don't run two workers without Redis.
17. **Retry budget is simple.** Failed deliveries retry up to a fixed attempt count
    each cycle; there is no exponential backoff schedule per-delivery yet.
18. **SSE stream caps at 10 min** then the browser reconnects (by design); there is
    no server-push auth (private local use only).

## Verified-safe behaviours (not limitations, but worth stating)
- Missing Helius data cannot produce a Safety PASS.
- A hard FAIL cannot be compensated by positive rules.
- Stale data / source conflict blocks ENTRY_READY.
- Duplicate polling does not create duplicate candidates.
- A missing/failed API response does not crash the worker or the UI.
- Alerts arise only from valid transitions + rule evidence + fresh data — never a lone score.
- Duplicate polling / worker restart never produces a duplicate alert (exact-once dedup).
- The Telegram bot token is never logged or stored in the database.
- Helius DEGRADED prevents any ENTRY_READY alert.
- The worker shuts down gracefully on SIGINT/SIGTERM and releases its lock.
