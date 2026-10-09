# OPERATIONS.md — running Aureus Intelligence 24/7

Two supported ways to run continuously: **PM2** (tested local path) or **Docker
Compose app services** (provided, build required). Postgres + Redis always run via
Compose.

## Worker modes
```bash
pnpm worker:once     # one bounded cycle, then exit
pnpm worker:watch    # loop (short-lived dev)
pnpm worker:start    # long-running: lock + heartbeat + circuit breaker + graceful shutdown
```

## Option A — PM2 (recommended for local 24/7)
```bash
pnpm add -g pm2            # once
pnpm build:web            # build the Next.js app for `next start`
pm2 start ecosystem.config.cjs
pm2 logs                  # tail worker + web logs
pm2 stop all              # graceful stop (SIGINT → clean worker shutdown)
```
Both processes auto-restart on crash (like `restart: unless-stopped`). The worker
finishes its in-flight cycle on stop (`kill_timeout: 8000`).

## Option B — Docker Compose
```bash
docker compose up -d                    # postgres + redis only (default)
# after filling .env.local (incl. any Helius/Telegram keys):
docker compose --profile apps up -d     # + worker + web (build the image first run)
```
The `worker` and `web` services set `restart: unless-stopped`; `web` has an HTTP
healthcheck on `/today`. The app image (`Dockerfile`) is provided but has **not**
been built in the dev sandbox — build it on your machine.

## Reliability features (in the worker)
- **Distributed lock** (Redis `SET NX PX`) — two workers never run the same cycle.
- **Heartbeat** → `worker_heartbeats` (shown on `/system` and the `/today` LiveBar).
- **Circuit breaker** per source — opens after repeated failures, half-opens after
  a cooldown; skips calls while open.
- **Retries + exponential backoff + jitter** in the HTTP adapter.
- **Adaptive polling** — active states scanned faster, REJECTED/EXPIRED go dormant
  (`next_scan_at` per candidate).
- **Bounded concurrency** (`MAX_CONCURRENT_CANDIDATES`) — no uncontrolled fan-out.
- **Per-candidate fault isolation** — one bad candidate never breaks the cycle.
- **Graceful shutdown** on SIGINT/SIGTERM — releases the lock, closes the DB pool.
- **Structured JSON logs**.

## Polling configuration (env)
See `.env.example`: `DISCOVERY_POLL_INTERVAL_SECONDS`,
`ACTIVE_CANDIDATE_POLL_INTERVAL_SECONDS`, `RESEARCHING_POLL_INTERVAL_SECONDS`,
`WATCHLIST_POLL_INTERVAL_SECONDS`, `STALE_AFTER_SECONDS`,
`MAX_CANDIDATES_PER_CYCLE`, `MAX_CONCURRENT_CANDIDATES`, `WORKER_TICK_SECONDS`.

## Monitoring
- **/today** — LiveBar: LIVE/OFFLINE, next-poll countdown, cycles, scanned today,
  alerts today, queue depth, Telegram mode (via SSE `/api/live`).
- **/system** — infra status, worker heartbeat/uptime/avg cycle, notification
  queue, Telegram connectivity, active alert-policy version, data-source modes.
- **/alerts** — every alert event + delivery status + Telegram message id + errors.

## Health / recovery
- Worker crash → PM2/Docker restarts it; the lock TTL expires so the next start
  re-acquires cleanly.
- DB or Redis down → worker logs errors, records `source_health`, and keeps
  looping; the UI still serves the last persisted state (Redis-down degrades the
  lock to single-worker assumption, so it keeps running).
- Dead-letter / failures → `notification_failures`, `dead_letter_events`.
