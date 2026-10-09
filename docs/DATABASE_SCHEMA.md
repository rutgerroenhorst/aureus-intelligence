# DATABASE_SCHEMA.md — Aureus Intelligence

Companion narrative for `db/migrations/0001_init.sql`. The SQL is the source of
truth; this explains intent, invariants, and the provenance contract.

Validation status: **written, not yet run against a live Postgres** (local Docker
daemon was down at authoring time). Running the migration is part of Deliverable
12 and a gate before the MVP is called done.

## Provenance contract (every observation-class table)

These columns appear on every table that records something we *observed* (not
identities and not pure link tables):

| Column | Meaning |
|---|---|
| `source` | which adapter produced it (`source_t` enum) |
| `observed_at` | the **source's** clock for the datum (nullable if none given) |
| `ingested_at` | **our** clock when we stored it |
| `evidence_status` | `VERIFIED / ASSUMED / MISSING / GATED / MANUAL / MOCK / STALE` |
| `data_quality_confidence` | 0..1 subjective/derived confidence in the datum |
| `raw_source_ref` | URL / tx signature / slot — human-checkable pointer |
| `raw_event_id` | FK to `raw_events` (the exact replayable payload) |

## Immutability invariants

- **`discovery_snapshots`** — exactly one per candidate, `UPDATE`/`DELETE`
  blocked by trigger. This is the frozen "what we knew at discovery".
- **`decision_state_history`** — append-only, `UPDATE`/`DELETE` blocked. The
  state reducer is the only writer.
- Observation tables are **append-only by convention**: a correction is a new row
  with a later `observed_at`, never an edit. (Not trigger-enforced, to keep write
  paths simple; enforced in the repository layer.)

## Identity model

- `tokens (chain, mint)` and `pools (chain, pool_address)` are unique. Symbol and
  name are `*_label` columns — never used for lookup, dedup, or joins.
- `candidates` bind `(chain, token, pool, discovered_at)` + a human
  `candidate_code` (e.g. `AUR-2026-000123`). Multiple pools for one mint → distinct
  candidates possible; reconciliation is explicit.

## Determinism stamps

Engine-output tables (`risk_findings`, `confirmations`,
`decision_state_history`, `simulated_entries`, `outcomes`) carry `spec_version`
and (except outcomes) `param_hash`, so results from different engine versions or
parameter sets are never silently mixed — inherited from
`gold-swing-engine/STATE_TRANSITIONS.md §5`.

## Time-series & partitioning

`prices`, `liquidity_snapshots`, `transaction_aggregates` are **range-partitioned
by `observed_at`** (monthly). PK is composite `(id, observed_at)` as Postgres
requires the partition key in the PK. A maintenance job pre-creates next month's
partition. `ohlcv` is a plain table (lower volume, on-demand).

## Score-as-diagnostic

`wallet_performance.win_rate` and any future numeric score are **diagnostic
columns**. No engine gate reads them as a threshold until out-of-sample
validation supports it (PRD §8/§11). Column comments and code enforce this.

## Cluster provenance (anti-fabrication)

`clusters` are our **own** Helius-derived holder-graph groupings
(`source='aureus_derived'`, with `linkage_evidence` = the edges used). Bubblemaps
data is never written here; when a Bubblemaps key exists, its output would land in
a separate table tagged `source='bubblemaps'`. We never fabricate membership.

## Roles (least privilege — created in a later migration)

- `app` — RW on engine/ingestion tables.
- `outcome` — RW on `outcomes` + report tables, **RO** on history/prices; **no**
  write path to features/findings/state (anti-look-ahead enforced by grant).
- `readonly` — SELECT for the API's read path.

## Table inventory (maps to Deliverable 3 list)

tokens · pools · candidates (+ discovery_snapshots, discovery_events) ·
observations · prices · liquidity_snapshots · transaction_aggregates · ohlcv ·
deployers · funding_wallets · wallet_entities · wallet_performance ·
holder_snapshots · clusters · launch_bundles · social_observations ·
fomo_observations · risk_findings · confirmations · decision_state_history ·
watchlists (+ watchlist_members) · alerts · simulated_entries · positions ·
outcomes · source_health · data_quality_issues · raw_events · dead_letter_events.
