# ARCHITECTURE.md — Aureus Intelligence

Version: 0.1 (foundations, pre-implementation review)
Companion to `PRODUCT_REQUIREMENTS.md`, `SOURCE_CAPABILITY_AUDIT.md`,
`DATABASE_SCHEMA.md`. Design conventions are inherited from
`../gold-swing-engine/` (determinism, frozen snapshots, score-as-diagnostic,
anti-look-ahead, no-conclusion rules).

---

## 1. Design principles (binding)

1. **Determinism first.** Every decision state is a pure function of stored
   observations + frozen thresholds + freshness + data-quality. Same inputs +
   same spec version + same parameter hash ⇒ identical output. Engines carry a
   `spec_version` and `param_hash`; outputs are stamped with both so mixed-version
   results are detectable (as in gold-swing STATE_TRANSITIONS §5).
2. **Append-only truth.** Raw source events and the discovery snapshot are
   immutable. Nothing overwrites the original observation; corrections are new
   rows superseding old ones, never edits.
3. **Address-first identity.** `(chain, mint)` and `(chain, pool)` are the only
   identities. Names/tickers are labelled data.
4. **Separation of the seven layers** (below). No layer reaches around another —
   the decision engine reads normalized features, not raw HTTP; the AI layer
   reads findings, not the DB.
5. **The LLM cannot move a gate.** The AI explanation layer is downstream of, and
   read-only against, deterministic findings. It cannot introduce data or change
   state. Enforced structurally (§9).
6. **Honesty over completeness.** Missing/stale/mock/conflicting data is
   first-class and visible. A gate on unknown data is `INCOMPLETE`/`UNRESOLVED`,
   never a guessed pass.

## 2. The seven layers

```
          ┌───────────────────────────────────────────────────────────┐
          │ 7. Outcome Engine  (offline, forward-window, never a gate)  │
          └───────────────────────────────────────────────────────────┘
                                   ▲ reads history
┌──────────┐  ┌──────────────┐  ┌──────────────────┐  ┌────────────────┐
│1.Ingestion│→│2.Normalization│→│3.Intelligence     │→│4.Decision Engine│
│ (adapters)│  │ (canonical    │  │  Features         │  │ (Safety/Quality│
│ raw events│  │  observations)│  │ (deployer graph,  │  │  /Entry → state│
│           │  │               │  │  clusters, demand,│  │  + findings)   │
│           │  │               │  │  retention, attn) │  │                │
└──────────┘  └──────────────┘  └──────────────────┘  └───────┬────────┘
                                                               │ findings + state
                                              ┌────────────────▼───────────────┐
                                              │5.AI Explanation (summary only)  │
                                              └────────────────┬───────────────┘
                                              ┌────────────────▼───────────────┐
                                              │6.Notifications (alert objects)  │
                                              └─────────────────────────────────┘
```

1. **Ingestion.** Source adapters (Dex Screener, GeckoTerminal, Helius,
   Bubblemaps, FOMO) with rate limiting, retries, exponential backoff, idempotency
   keys, dedup, dead-letter queue, and a **raw JSON event store**. Adapters emit
   raw events onto queues; they do not compute features.
2. **Normalization.** Raw events → canonical `observations`, `prices`,
   `liquidity_snapshots`, `transaction_aggregates`, `holder_snapshots`, etc., each
   with `source/observed_at/ingested_at/evidence_status/data_quality_confidence/
   raw_source_ref`. Dedup by `(source, natural_key, observed_at)`.
3. **Intelligence features.** Derived, still deterministic: deployer/funding
   graph, wallet entities & performance, holder clusters, launch-bundle detection,
   independent-demand metrics, capital-retention metrics, attention metrics.
   Written to feature tables tagged with the computation's inputs.
4. **Deterministic decision engine.** Safety → Quality → Entry, each producing
   findings and a sub-status; a state reducer maps (Safety, Quality, Entry,
   freshness, data-quality) → candidate state + `decision_state_history` row.
5. **AI explanation layer.** Given the findings for a candidate, produce a calm
   natural-language summary. Structurally sandboxed (§9).
6. **Notifications.** Turn state transitions + risk events into alert objects;
   in-app delivery now, channel adapters stubbed.
7. **Outcome engine.** Offline workers compute forward returns/MFE/MAE and build
   validation reports. **Physically separated** so forward data can never leak
   into a live gate.

## 3. Technology choices

| Concern | Choice | Rationale |
|---|---|---|
| Frontend | **Next.js (App Router) + TypeScript**, responsive PWA, server components + SSE for realtime | matches brief; SSR for calm fast pages; SSE (not WS) fits our polling model |
| API/services | **TypeScript (Node)** service layer | one language across FE/BE; strong typing for the finding contracts |
| Analysis workers | **Python** where it earns its place (graph analysis, stats, outcome reports via pandas/networkx); **TypeScript** for the deterministic engines | engines stay in TS so the contract types are shared and testable with the API; heavy numeric/graph work goes to Python |
| Primary DB | **PostgreSQL** | relational integrity for identities/findings/history; JSONB for raw payloads |
| Time-series | Postgres **partitioned tables** for `prices`/`liquidity_snapshots`/`transaction_aggregates` (partition by time); optional TimescaleDB extension later | avoid premature infra; partitioning covers MVP volume |
| Queue / cache | **Redis** (BullMQ queues + rate-limiter + cache) | mature, simple, good rate-limiting primitives |
| Raw event store | Postgres `raw_events` (append-only, JSONB) + object storage later | keep everything replayable |
| Realtime to UI | **SSE** channel per client; server pushes state/alert deltas | our data is polled server-side; SSE is simpler and sufficient |

**Why SSE over WebSocket:** the upstream sources have no sockets (audit §A/§B), so
the server polls and computes; the browser only needs a one-way push of
already-computed deltas. SSE is less operationally heavy and reconnects cleanly.

## 4. Monorepo layout (proposed — see IMPLEMENTATION_PLAN for phasing)

```
aureus-intelligence/
  docs/                         # these documents
  db/
    migrations/                 # numbered SQL migrations (0001_init.sql ...)
    seeds/                      # source_health seed, mock candidates
  packages/
    contracts/                  # shared TS types: Finding, CandidateState, Alert, engine I/O
    core-engines/               # deterministic Safety/Quality/Entry + state reducer (pure, unit-tested)
    ingestion/                  # source adapters, rate limiter, dead-letter, raw store
    normalization/              # raw event -> canonical observation mappers
    features/                   # deployer graph, clusters, demand/retention/attention (TS)
    db/                         # db client, repositories, migration runner
    notifications/              # alert builder + channel interfaces (in-app impl)
  workers/
    py/                         # Python: outcome engine, graph/stat analysis
  apps/
    web/                        # Next.js app (built after review)
    worker/                     # Node worker process: schedulers, queue consumers, engine runs
  scripts/                      # dev/setup scripts
  .env.example
  docker-compose.yml            # postgres + redis for local dev
  package.json / tsconfig.base.json
```

## 5. Ingestion layer detail

- **Scheduler** (Node worker) holds per-source **token-bucket rate limiters**
  seeded from `SOURCE_CAPABILITY_AUDIT` and *corrected at runtime* from observed
  429s → written to `source_health`.
- **Discovery pollers:** Dex Screener `/token-profiles/latest/v1` +
  `/token-boosts/latest/v1` (60 rpm budget); Helius webhook receiver for
  pool-creation / deployer activity.
- **Per-candidate refreshers:** Dex Screener `/tokens/v1` & `/token-pairs/v1`;
  GeckoTerminal OHLCV/reserves on demand (hard 10 rpm cap, coalesced).
- **Reliability:** every adapter call is wrapped with retries + exponential
  backoff + jitter; permanent failures land in a **dead-letter queue** with the
  request context. **Idempotency:** each raw event has a deterministic
  `idempotency_key = hash(source, endpoint, natural_key, observed_at)`; re-ingest
  is a no-op. **Dedup:** mint/pool dedup at normalization via unique constraints.
- **Raw store:** every successful response persisted to `raw_events` (JSONB)
  before normalization, so the pipeline is fully replayable and the discovery
  snapshot is reconstructable.
- **Freshness/staleness:** each normalized row carries `observed_at`; a freshness
  service marks rows STALE past their class TTL (PRD §6).

## 6. Deterministic decision engine

Pure functions in `packages/core-engines`, no I/O, fully unit-testable:

```
safety(features, thresholds)   -> { status: PASSED|INCOMPLETE|FAILED, findings[] }
quality(features, thresholds)  -> { demand, capital, attention ∈ {WEAK,DEVELOPING,CONFIRMED}, findings[] }
entry(features, ohlcv, liq)    -> { status: TOO_EARLY|WAIT_FOR_LEVEL|READY|OVEREXTENDED|INVALIDATED|EXPIRED,
                                    level, invalidation, rr, findings[] }
reduce(safety, quality, entry, freshness, dataQuality) -> { state, transitionReason }
```

- **Hard-gate rule:** in `safety`, any finding with `severity=CRITICAL`
  short-circuits to `FAILED`; **no positive signal can offset it** (mirrors
  gold-swing "score cannot override a failed gate").
- **INCOMPLETE vs FAILED:** missing critical data ⇒ `INCOMPLETE` ⇒ candidate
  `UNRESOLVED`; *evidence of harm* ⇒ `FAILED` ⇒ `REJECTED`. The two are never
  merged.
- **Findings** are the universal currency: `{rule_id, severity, explanation,
  evidence, source, observed_at, invalidation ("what would change this")}`.
- **Score is diagnostic only.** Any numeric score is logged, shown as a raw
  number, and **never gates** a state until validated (PRD §8/§11). No
  `probability`/`confidence` labels.
- **Freezing:** on entering `QUALITY_CONFIRMED` and again at an entry level, the
  relevant feature snapshot is frozen and referenced by later findings, so a level
  and its invalidation don't silently drift with new indicator values.

## 7. State reducer

A single reducer owns the mapping to the canonical states (PRD §4), consuming
engine sub-statuses + freshness + open critical data-quality issues. It is the
**only** writer of `decision_state_history`. `ENTRY_READY` requires the full §7.1
conjunction; any clause dropping produces an immediate reasoned transition out.
Every write records `from_state, to_state, reason, evidence_ref, spec_version,
param_hash, at`.

## 8. Notifications

`packages/notifications` builds alert objects from state transitions + risk
events, dedups per `(candidate_id, type)`, sets expiry, and writes `alerts`.
Delivery via a `NotificationChannel` interface; `InAppChannel` implemented,
`TelegramChannel`/`EmailChannel`/`PushChannel` are stubs throwing
`NotImplemented` and registered as disabled.

## 9. AI explanation boundary (structural, not merely instructed)

The AI layer is sandboxed so it **cannot** bypass gates:
- **Input:** only the already-computed, structured `findings[]` + current state
  for one candidate. It never receives DB access, tools, or raw source data.
- **Output contract:** free-text summary + an array of `cited_finding_ids`. A
  post-processor **rejects** any output whose claims reference a `finding_id` not
  in the input set, or that contains a number/address not present in the input
  findings (regex/entity check). Rejected → fall back to a templated,
  non-AI summary.
- **No authority:** its output is stored as `ai_summary` on the candidate,
  labelled "narrative", and is **never** read by any engine, reducer, or alert
  condition.
- **Banned-term filter:** the same lexicon ban (`probability`, `confidence %`,
  `A+`, guarantee language) is enforced on AI output.

This makes the LLM a *renderer of evidence*, incapable of inventing a signal.

## 10. Outcome engine isolation (anti-look-ahead)

- Runs as **separate Python workers** reading only historical
  `prices`/`liquidity_snapshots`/state history.
- Writes only to `outcomes` and report tables. It has **no path** to write
  features, findings, or state — enforced by DB role/grants (outcome worker uses a
  role without write access to engine tables).
- Forward-window metrics are excluded on incomplete windows and never surfaced to
  live views except in the Outcomes reporting pages.

## 11. Data-quality & conflict handling

- Two sources disagreeing on the same `(pool, metric, ~observed_at)` beyond a
  tolerance → a `data_quality_issue` (severity by metric); if the metric is a
  *required* Entry/Safety input, the issue is `CRITICAL` and blocks green states.
- Duplicate mints/pools across sources reconcile to one identity via unique
  constraints; the reconciliation is logged, not silent.
- Every UI number renders with a **data badge**: real / stale / mock / missing /
  conflicting.

## 12. Security & secrets

- All source calls server-side; keys only in server env, never shipped to client.
- `.env.local` gitignored; `.env.example` lists keys with empty values.
- DB roles: `app` (RW engine tables), `outcome` (RW outcomes only, RO history),
  `readonly` (UI reads via API only — the browser never touches the DB).
- No private keys / seed phrases / exchange credentials anywhere in schema or
  code. No trading capability exists to be abused.

## 13. Testing strategy (foundation)

- **Engines:** pure unit tests with fixture features covering each rule's
  pass/incomplete/fail and each state transition (including the hard-gate
  override, the INCOMPLETE≠FAILED split, and the `ENTRY_READY` conjunction
  dropping each clause in turn).
- **Ingestion:** adapter tests against recorded fixtures + a rate-limiter test +
  idempotency/dedup test + dead-letter test.
- **Normalization:** raw→canonical mapping tests incl. conflict detection.
- **AI boundary:** tests that fabricated numbers/uncited findings are rejected.
- **Outcome:** anti-look-ahead test (no forward leak; incomplete windows
  excluded).
- **E2E (MVP):** ingest one recorded batch → engines → state → alert → outcome
  row, asserting labels for mock/stale/real.

## 14. Deferred / explicitly not built now

- WebSocket infrastructure (no upstream sockets exist).
- Bubblemaps data API parsing (gated); FOMO crawler (prohibited).
- Statistical scoring model as a gate (diagnostic only until validated).
- Notification delivery channels beyond in-app (interfaces only).
- Multi-tenant/auth beyond single private operator.
