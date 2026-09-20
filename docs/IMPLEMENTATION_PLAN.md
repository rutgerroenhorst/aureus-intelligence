# IMPLEMENTATION_PLAN.md — Aureus Intelligence

Version 0.1 — the phased build plan and file tree presented for review **before
any UI is built** (per the working method, step 3). Each phase ends with a
concrete, testable exit criterion; no phase is "done" until its tests pass.

---

## Guiding constraints (carried from the brief)

- Small reliable MVP over a large mock interface.
- No phase complete without tests.
- Be explicit about what is real vs mock vs stale vs missing.
- No automated trading, ever.
- Deterministic engines; the LLM never moves a gate.
- Deliver exact local run commands at the end.

## Proposed file tree (target)

```
aureus-intelligence/
├─ docs/
│  ├─ PRODUCT_REQUIREMENTS.md          ✅ done
│  ├─ ARCHITECTURE.md                  ✅ done
│  ├─ SOURCE_CAPABILITY_AUDIT.md       ✅ done
│  ├─ DATABASE_SCHEMA.md               ✅ done
│  ├─ IMPLEMENTATION_PLAN.md           ✅ (this file)
│  ├─ VALIDATION_REPORT.md             ⬜ Phase 8
│  ├─ KNOWN_LIMITATIONS.md             ⬜ Phase 8
│  └─ NEXT_PHASE.md                    ⬜ Phase 8
├─ db/
│  ├─ migrations/0001_init.sql         ✅ written (unrun)
│  ├─ migrations/0002_roles.sql        ⬜ Phase 1
│  └─ seeds/                           ⬜ Phase 1 (source_health, mock candidates)
├─ packages/
│  ├─ contracts/        # shared TS types: Finding, Confirmation, CandidateState, Alert, engine I/O
│  ├─ db/               # pg client, migration runner, repositories
│  ├─ ingestion/        # adapters + rate limiter + dead-letter + raw store
│  ├─ normalization/    # raw → canonical mappers + conflict detection
│  ├─ features/         # deployer graph, clusters, demand/retention/attention
│  ├─ core-engines/     # Safety / Quality / Entry + state reducer (pure)
│  └─ notifications/    # alert builder + channel interfaces
├─ workers/
│  └─ py/               # outcome engine + graph/stat analysis (Phase 7)
├─ apps/
│  ├─ worker/           # Node: schedulers, queue consumers, engine runner
│  └─ web/              # Next.js UI (Phase 6 — AFTER review)
├─ scripts/             # setup, migrate, seed, ingest-batch
├─ docker-compose.yml   # postgres + redis
├─ .env.example
├─ package.json         # workspaces (pnpm)
└─ tsconfig.base.json
```

## Phase 0 — Foundations & review gate  ← WE ARE HERE

Deliverables: repository audit, source-capability audit, PRD, ARCHITECTURE,
schema (SQL + doc), this plan. **Exit criterion:** owner reviews and approves the
four questions' separation, the decision states, the source corrections
(esp. "no Dex Screener WS", GeckoTerminal 10 rpm, Bubblemaps/FOMO gated), and this
file tree. **No UI until this is approved.**

## Phase 1 — Repo skeleton + DB up + migration runs

- pnpm workspace, `tsconfig.base`, lint (eslint) + format (prettier) + `vitest`.
- `docker-compose.yml` (postgres:16, redis:7); `scripts/migrate.ts` runner.
- `packages/contracts` first cut of the finding/confirmation/state/alert types.
- `packages/db` client + repositories for identities and raw_events.
- `0002_roles.sql` (app/outcome/readonly), `source_health` seed from the audit.
- **Exit:** `docker compose up -d && pnpm migrate` succeeds; a smoke test inserts a
  token/pool/candidate and reads it back; `pnpm typecheck && pnpm lint` clean.

## Phase 2 — Ingestion layer (real, address-first)

- Token-bucket rate limiter (Redis) seeded from audit; per-source budgets.
- Retry + exponential backoff + jitter; dead-letter on permanent failure.
- Idempotency keys; mint/pool dedup; **raw_events** write before normalize.
- Adapters: **Dex Screener** (profiles/boosts/tokens/pairs — polled),
  **GeckoTerminal** (on-demand OHLCV/reserves, hard 10 rpm), **Helius**
  (webhook receiver + tx backfill; requires key), **Bubblemaps** (iframe/stub),
  **FOMO** (manual-import interface).
- Freshness service (TTLs from PRD §6) marking rows STALE.
- **Exit:** ingest **one real batch** of live Solana candidates end-to-end into
  raw_events + normalized tables; adapter fixture tests + rate-limiter test +
  idempotency/dedup test + dead-letter test pass. Sources needing keys degrade to
  clearly-labelled MOCK when the key is absent (never silently).

## Phase 3 — Normalization + intelligence features

- Raw → canonical mappers with **conflict detection** → `data_quality_issues`.
- Features: deployer identification + funding-graph trace (Helius), holder
  snapshots, **our** cluster detection, launch-bundle detection, independent-demand
  metrics, capital-retention metrics, attention metrics (with boost/paid
  correction).
- **Exit:** feature tables populate from the Phase 2 batch; conflict, duplicate,
  and missing-data cases produce issues; unit tests on each feature with fixtures.

## Phase 4 — Deterministic engines + state reducer

- **Safety Engine** (10 hard-gate categories) → PASSED/INCOMPLETE/FAILED, findings
  with rule_id/evidence/source/timestamp/severity/explanation/invalidation;
  critical failure short-circuits, no positive offset.
- **Quality Engine** → Independent Demand / Capital Retention / Attention, each
  WEAK/DEVELOPING/CONFIRMED.
- **Entry Engine** → range/reclaim/retest, invalidation, slippage/price-impact,
  overextension, min RR, expiry → TOO_EARLY/WAIT_FOR_LEVEL/READY/OVEREXTENDED/
  INVALIDATED/EXPIRED.
- **State reducer** → canonical states + `decision_state_history`; `ENTRY_READY`
  full conjunction; score diagnostic-only; banned-term filter.
- **Exit:** pure unit tests for every rule (pass/incomplete/fail), the hard-gate
  override, INCOMPLETE≠FAILED, and each `ENTRY_READY` clause dropping in turn.

## Phase 5 — Notifications + engine runner (worker)

- Alert builder for all 9 objects; dedup per (candidate,type); expiry; in-app
  `InAppChannel`; Telegram/email/push stubs.
- `apps/worker`: scheduler polls sources, runs pipeline, invokes engines, writes
  alerts; SSE publisher of deltas.
- **Exit:** a state transition on a seeded candidate produces the right alert with
  all required fields; stub channels register disabled; tests green.

## Phase 6 — Web UI (ONLY after Phase 0 approval)

Next.js (App Router), the calm gold/charcoal system (Deliverable 9 palette).
Pages: Today, Discover, Candidate Detail, Entry Watch, Entry Ready, Wallet
Intelligence, Deployer/Funding Intelligence, Watchlists, Position Risk, Outcomes,
Data Quality, Sources/Health, Settings. Candidate card + detail per the brief's
field lists; every number carries a data badge (real/stale/mock/missing/
conflicting); SSE live updates.
- **Exit:** desktop + mobile pass; empty/stale/conflict states render; no page
  claims guaranteed profit (automated copy check).

## Phase 7 — Outcome engine (Python, isolated)

- Forward returns 1h/6h/24h/72h/7d/30d, MFE/MAE, time-to-peak, liquidity drain,
  rug label, holder delta, max stage, simulated-entry outcome + slippage,
  false pos/neg, reason.
- Reports: rule precision/recall, rejected winners, accepted failures, expectancy
  per state, cohort/narrative/source/pattern breakdowns.
- **Exit:** anti-look-ahead test (no forward leak; incomplete windows excluded);
  outcome role has no write path to engine tables; reports render in Outcomes page.

## Phase 8 — Validation & review (Deliverable 12)

- Lint, typecheck, tests, migrations, API error handling; mobile/desktop UX;
  empty/stale/conflicting/duplicate/hard-fail/watchlist-transition tests;
  no-guaranteed-profit check.
- Write `VALIDATION_REPORT.md`, `KNOWN_LIMITATIONS.md`, `NEXT_PHASE.md`.
- **Exit:** all green; exact local run commands documented.

## Sequencing / dependencies

`P0 → P1 → P2 → P3 → P4 → P5`, then `P6` (UI) and `P7` (outcomes) can proceed in
parallel, then `P8`. UI (P6) is hard-gated on P0 approval.

## Open decisions for the owner (needed before/at Phase 1)

1. **Directory placement** — I created the platform under
   `aureus-intelligence/` (the working dir root holds the unrelated "Acquisition
   Leak" site). Confirm, or specify a different root.
2. **The referenced `Wallet_Deployer_Intelligence_DB.xlsx` and Solana "Command
   Center HTML" do not exist** anywhere in the Projects tree. If you have them,
   share them and I'll migrate their content (working method step 7); otherwise we
   start the wallet/deployer DB fresh from schema.
3. **Helius API key** — required for the on-chain backbone. Free dev tier is fine
   to start; without it, on-chain features run in labelled MOCK mode.
4. **Package manager** — plan assumes **pnpm** workspaces. Confirm or switch to
   npm workspaces.
5. **Python worker** — confirm Python is acceptable for the outcome/graph workers
   (the rest is TypeScript).
