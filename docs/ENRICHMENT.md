# ENRICHMENT.md — asynchronous on-chain (Helius) enrichment

Helius runs as an **asynchronous enrichment engine**, fully decoupled from the
discovery + market pipeline. Missing/slow/failing on-chain data never blocks
discovery — it only holds back the on-chain rules, which stay INCOMPLETE (a data
wait), never a fabricated PASS.

## Flow
```
Dex Screener discovery → normalization → market observations → price/liquidity/volume
features → preliminary rule evaluation → (if Helius LIVE) enqueue HELIUS_ENRICHMENT
→ holder/authority enrichment → onchain_enrichment persisted → REEVALUATE_CANDIDATE
→ features + rules recompute with on-chain intel → deterministic state transition
```

Job types: `DISCOVERY_SCAN`, `MARKET_REFRESH` (the main cycle), `HELIUS_ENRICHMENT`,
`REEVALUATE_CANDIDATE` (the async Redis queue). Enrichment and re-evaluation run in
a separate drain step that never blocks the market scan.

## Reliability (Redis queue)
- **Idempotent enqueue** — one in-flight job per (type, candidate).
- **Per-candidate lock** — a job never runs twice concurrently; a worker restart
  re-claims cleanly (jobs live in Redis, not memory).
- **Exponential backoff + jitter** retries; **dead-letter** past the attempt budget
  → `enrichment_failures`.
- **Circuit breaker** on Helius, independent of the Dex Screener breaker.
- **API timeouts**; the **bot/API key is never logged** (errors sanitized).
- A Helius failure blocks only Helius-dependent checks; market/liquidity/structure
  rules keep working.

## Data collected (real Helius, no fabrication)
Implemented now: token **supply**, **top holders** (largest accounts),
**holder concentration** (top-10 / supply), **mint/freeze authority**.
Honestly **INCOMPLETE** (require a funding/tx graph, not yet built): deployer +
funding source, insider concentration, launch-bundle patterns, sell simulation.
Any datapoint that cannot be reliably determined is `UNAVAILABLE`/`INCOMPLETE`
with a stored reason — never assumed PASS.

## Enrichment status
`NOT_REQUESTED → QUEUED → RUNNING → PARTIAL|COMPLETE`, plus `FAILED`, `RETRYING`,
`STALE`. Stored per candidate with queued/started/completed/last_success timestamps,
attempts, next_retry_at, last_error, data version, and a response hash (idempotency).
Per-dataset status lives in `onchain_enrichment.datasets`. Because deployer/insider/
bundle are not yet implemented, a successful enrichment is currently **PARTIAL**.

## Incremental recompute (dependency map)
`top holders → holder_concentration → SAFE-03/holder rule → Safety aggregate →
readiness/state re-evaluation`. On enrichment success the deterministic engines
re-run reading `onchain_enrichment`; only meaningful changes are persisted (the
existing change-based policy). **No thresholds lowered, no forced promotion** — the
state may stay UNRESOLVED, or move to RESEARCHING / REJECTED / STRUCTURE_WATCH etc.
strictly per the existing rules.

## The UI distinguishes four things
- a real rule **FAIL** (bad coin),
- **waiting on data** (INCOMPLETE + enrichment not COMPLETE),
- enrichment **FAILED** (with error + attempts),
- **STALE** data (past TTL, re-queued).

Candidate page shows enrichment status, per-dataset progress, last success,
retries/errors, and which rules are Helius-blocked. `/system` shows Helius mode,
queue depth, enriched/re-evaluated per cycle, circuit-breaker state, status +
tier counts. `/today` shows awaiting/running/partial/complete/failed. `/discover`
filters by enrichment status and sorts by monitoring priority.

## Active-candidate monitoring (priority tiers)
Deterministic scheduling priority (NOT a win probability):
- **TIER0 DORMANT** — REJECTED/EXPIRED/rug/inactive pool → no normal rescans.
- **TIER1 LOW** — weak/low-liquidity UNRESOLVED → ~20 min.
- **TIER2 ENRICHMENT** — strong market data, no critical market FAIL, awaiting
  Helius → ~2 min, prioritized for enrichment.
- **TIER3 WATCH** — STRUCTURE_WATCH/QUALITY_CONFIRMED → ~40 s.
- **TIER4 TRADE** — ENTRY_WATCH/ENTRY_READY → ~12 s.
Priority also uses liquidity/volume trend, pair age, enrichment status, last
meaningful change, freshness, and proximity to the next state. Stored per
candidate: tier, priority_score + components, next/last scan, monitoring window,
consecutive_stable_cycles, downgrade/stop reasons. `next_scan_at` survives a
restart. Candidates can be downgraded (ENTRY_READY→ENTRY_WATCH→…→REJECTED).

## Enable Helius (you, locally)
```
# .env.local
HELIUS_API_KEY=your-key
```
Restart the worker. `/system` will show Helius **LIVE**, enrichment jobs will run,
and TIER2 candidates get enriched → re-evaluated. The key is read only from the
environment and never logged or stored.

## Queue + reevaluation flow (fair scheduling)
The queue is **one Redis ZSET per job type** (`aureus:enrich:z:<type>`), not a single
shared list. Each job carries a UUID `id`; idempotency is a dedup set keyed
`<job_type>:<candidate_id>`, and a per-`(type,candidate)` lock (`…:lock:<type>:<c>`)
lets a HELIUS_ENRICHMENT and a REEVALUATE_CANDIDATE for the *same* candidate run
without blocking each other.

Each cycle drains **fairly**: `claimDue("REEVALUATE_CANDIDATE", …, MAX_REEVAL_PER_CYCLE)`
first (bounded, default 10), then `claimDue("HELIUS_ENRICHMENT", …, MAX_ENRICH_PER_CYCLE)`
(default 5). A job is `ack`ed only after its work succeeds; failures `retry` with
exponential backoff + jitter and dead-letter after `ENRICHMENT_MAX_ATTEMPTS` (5).

**Why this was needed (the bug):** the previous single ZSET scored every job `0`, so
`ZRANGEBYSCORE` broke ties lexicographically — `"HELIUS_ENRICHMENT"` sorts before
`"REEVALUATE_CANDIDATE"`, so under a claim limit the reevals at the back were never
reached. Result: enrichment ran (`changed=true`) but `reeval=0` every cycle and the
queue grew (25→39→41→42→53). Per-type queues + reeval-first drain remove the
starvation; reevals now drain each cycle so the backlog stabilizes.

**One job, end to end** (trace logs `candidate_id`/`job_id`/`job_type`/`stage` only —
never the key or RPC URL): `claimed → enriched(status=PARTIAL,changed) →
reeval_enqueued → acked`, then `reeval_claimed → reevaluated → acked`. Only a
`changed` enrichment enqueues a REEVALUATE, so an unchanged (idempotent) response
does **not** re-queue — that is what stops the per-cycle re-queue growth.

**Rate-limit safety:** the Helius JSON-RPC path is throttled by a token bucket
(`HELIUS_RPS`, default 8 rps, burst 3); a `429` surfaces `Retry-After` as a retryable
error so the queue backs off rather than hammering the free plan. `MAX_ENRICH_PER_CYCLE`
is *not* raised to force throughput.

**Metrics** (heartbeat detail + `stats()`): `enqueued/claimed/completed/retried/
deadlettered/duplicateEnqueue`, `enrichQueueByType`, `uniqueQueued`, `oldestJobAgeMs`,
plus `enriched`/`reeval` counts per cycle — enough to watch depth, duplicates
prevented, and reeval latency.

## Honest status
The engine is built and tested end-to-end in DEGRADED mode (discovery unblocked,
tiers assigned, nothing fabricated). **Live Helius verification and the 1h/12h/24h
reports require your API key and continuous uptime** — those cannot be run without
the key. With enrichment only PARTIAL (holders + authorities), Safety still won't
fully PASS until deployer/insider/bundle datasets are added; candidates may
legitimately remain UNRESOLVED. That is reported honestly, not worked around.
