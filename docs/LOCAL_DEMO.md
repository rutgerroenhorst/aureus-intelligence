# LOCAL_DEMO.md — run the Aureus Intelligence alpha locally

A working vertical slice: Dex Screener → discovery → normalization → feature engine
→ rule engine → decision state → snapshot → website. On-chain (Helius) is not
wired yet, so every candidate honestly stays **UNRESOLVED / RESEARCHING** and
Safety never PASSes — the UI shows exactly why.

## Prerequisites
- Node ≥ 20 (tested on 24), Docker Desktop running, `corepack` enabled
  (`corepack enable`). All `pnpm` commands below can be run as `corepack pnpm …`
  if `pnpm` is not on your PATH.

## First run (from `aureus-intelligence/`)

```bash
pnpm install
pnpm db:start        # postgres:16 + redis:7 via docker compose
pnpm db:migrate      # applies migrations 0001–0004
pnpm db:seed         # loads 24 feature + 18 rule definitions, engine versions
pnpm worker:once     # ONE bounded poll of live Dex Screener candidates
pnpm dev             # Next.js on http://localhost:3000
```

Open **http://localhost:3000** → it redirects to `/today`, which will not be empty
after a successful `worker:once`.

## What each page shows
- **/today** — a **live** status bar (worker LIVE/OFFLINE, next-poll countdown,
  cycles, scanned today, alerts today, queue, Telegram mode) + stat tiles + up to
  10 recent candidate cards.
- **/discover** — filterable table (state, min liquidity, min volume, max pair age,
  search by mint/symbol/pool).
- **/alerts** — every alert event with level, transition, policy, delivery status,
  Telegram message id, and errors.
- **/candidate/[id]** — header + **Safety / Quality / Entry / Timeline**. Shows a
  "DATA INCOMPLETE" banner and, per rule, PASS/FAIL/INCOMPLETE with evidence,
  "changes if", and missing data; the timeline merges discovery, snapshots, state
  transitions, notebook entries, and observations.
- **/system** — Postgres/Redis status, adapter statuses, Helius/Bubblemaps/FOMO
  modes, last poll, last worker run, queue depth, engine versions, recent errors.

## The continuous scanner

```bash
pnpm worker:once     # a single bounded cycle
pnpm worker:watch    # loop (short-lived dev)
pnpm worker:start    # long-running 24/7: lock + heartbeat + circuit breaker + graceful shutdown
```
For real 24/7 use, run under PM2 or Docker — see `docs/OPERATIONS.md`. Live worker
status appears on `/today` (LiveBar) and `/system`.

## Telegram alerts (optional)
```bash
pnpm telegram:test   # sends "Aureus Intelligence Telegram connection successful."
```
Full setup in `docs/TELEGRAM_SETUP.md`. Without it, notifications are DEGRADED
(alerts still recorded on `/alerts`, just not delivered). With no Helius key,
candidates stay UNRESOLVED so no entry alerts fire — expected.

- Bounded by `WORKER_MAX_CANDIDATES` (default 8) and `WORKER_POLL_MS` (default
  60000). It never runs uncontrolled ingestion.
- **Idempotent**: candidate identity is deduped on (mint, pool) — re-polling the
  same pair never creates a duplicate candidate.
- Errors are logged per candidate and recorded in `source_health`; a failed poll
  does not crash the process.

## Enabling on-chain (optional, later)
Add `HELIUS_API_KEY=…` to `.env.local`. This flips Helius from DEGRADED to LIVE;
on-chain features + Safety wiring land in the next increment. Without it, the app
is fully functional and truthful — it just cannot progress a candidate past
UNRESOLVED, and it labels every on-chain feature UNAVAILABLE.

## Reset
```bash
pnpm db:reset        # drop + recreate schema, re-migrate (dev only)
pnpm db:seed
pnpm db:stop         # stop containers
```

## Screenshots
Captured live during validation (see the session transcript / VALIDATION_REPORT):
`/today`, `/discover`, a candidate detail page, and `/system`, on desktop and
mobile widths.
