#!/usr/bin/env bash
# Bring Aureus from "nothing works" to "everything works", idempotently.
#
# Written because the recurring failure in this project is not a code bug: the
# machine sleeps, Docker Desktop quits, Postgres goes with it, and every page 500s.
# Recovery was a sequence of half-remembered commands. Now it is one.
#
#   ./scripts/up.sh          start everything
#   ./scripts/up.sh --status report only, change nothing
set -uo pipefail
cd "$(dirname "$0")/.."

BOLD=$'\033[1m'; DIM=$'\033[2m'; GRN=$'\033[32m'; RED=$'\033[31m'; YLW=$'\033[33m'; OFF=$'\033[0m'
ok()   { printf "  ${GRN}✓${OFF} %s\n" "$1"; }
warn() { printf "  ${YLW}!${OFF} %s\n" "$1"; }
bad()  { printf "  ${RED}✗${OFF} %s\n" "$1"; }
step() { printf "\n${BOLD}%s${OFF}\n" "$1"; }

STATUS_ONLY=0
[ "${1:-}" = "--status" ] && STATUS_ONLY=1

# ── 1. Docker daemon ────────────────────────────────────────────────────────
step "Docker"
if docker ps >/dev/null 2>&1; then
  ok "daemon running"
else
  if [ "$STATUS_ONLY" = 1 ]; then bad "daemon NOT running"; else
    warn "daemon down — starting Docker Desktop"
    open -a Docker 2>/dev/null || { bad "could not launch Docker Desktop"; exit 1; }
    for _ in $(seq 1 60); do docker ps >/dev/null 2>&1 && break; sleep 2; done
    docker ps >/dev/null 2>&1 && ok "daemon running" || { bad "daemon did not come up in 120s"; exit 1; }
  fi
fi

# ── 2. Containers ───────────────────────────────────────────────────────────
step "Containers"
if [ "$STATUS_ONLY" = 0 ]; then docker compose up -d >/dev/null 2>&1; fi
for c in aureus_postgres aureus_redis; do
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$c"; then ok "$c up"; else bad "$c DOWN"; fi
done
if [ "$STATUS_ONLY" = 0 ]; then
  printf "  ${DIM}waiting for postgres…${OFF}\r"
  for _ in $(seq 1 60); do docker exec aureus_postgres pg_isready -U aureus >/dev/null 2>&1 && break; sleep 1; done
fi
docker exec aureus_postgres pg_isready -U aureus >/dev/null 2>&1 \
  && ok "postgres accepting connections" || { bad "postgres not ready"; exit 1; }

# ── 3. Schema + catalogs ────────────────────────────────────────────────────
# Catalogs are SEEDED, not migrated: an empty feature_definitions produces an FK
# error on every candidate, which looks like a scanner bug rather than a setup gap.
step "Schema"
TABLES=$(docker exec aureus_postgres psql -U aureus -d aureus -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null || echo 0)
MIGRATIONS=$(ls db/migrations/*.sql 2>/dev/null | wc -l | tr -d ' ')
if [ "${TABLES:-0}" -lt 10 ]; then
  if [ "$STATUS_ONLY" = 1 ]; then bad "only $TABLES tables — schema missing"; else
    warn "only $TABLES tables — applying $MIGRATIONS migrations"
    for f in db/migrations/*.sql; do
      docker exec -i aureus_postgres psql -U aureus -d aureus -q -v ON_ERROR_STOP=0 < "$f" >/dev/null 2>&1
    done
    TABLES=$(docker exec aureus_postgres psql -U aureus -d aureus -tAc \
      "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
    ok "$TABLES tables"
  fi
else
  ok "$TABLES tables"
fi

FEATURES=$(docker exec aureus_postgres psql -U aureus -d aureus -tAc \
  "SELECT count(*) FROM feature_definitions" 2>/dev/null || echo 0)
if [ "${FEATURES:-0}" -lt 1 ]; then
  if [ "$STATUS_ONLY" = 1 ]; then bad "catalogs not seeded (feature_definitions empty)"; else
    warn "catalogs empty — seeding"
    corepack pnpm db:seed >/dev/null 2>&1 && ok "catalogs seeded" || bad "seed failed"
  fi
else
  RULES=$(docker exec aureus_postgres psql -U aureus -d aureus -tAc "SELECT count(*) FROM rule_definitions" 2>/dev/null || echo 0)
  ok "$FEATURES features, $RULES rules seeded"
fi

# ── 4. Worker ───────────────────────────────────────────────────────────────
step "Worker"
if pgrep -f "apps/worker/src/run.ts" >/dev/null 2>&1; then
  ok "running (pid $(pgrep -f 'apps/worker/src/run.ts' | head -1))"
elif [ "$STATUS_ONLY" = 1 ]; then
  bad "not running"
else
  warn "not running — starting"
  nohup node --env-file=.env.local --import tsx apps/worker/src/run.ts start \
    > /tmp/aureus-worker.log 2>&1 < /dev/null & disown
  for _ in $(seq 1 40); do grep -q "cycle done" /tmp/aureus-worker.log 2>/dev/null && break; sleep 2; done
  grep -q "cycle done" /tmp/aureus-worker.log 2>/dev/null \
    && ok "running, first cycle complete" \
    || warn "started but no cycle yet — tail /tmp/aureus-worker.log"
fi

# ── 5. Web ──────────────────────────────────────────────────────────────────
step "Web"
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 90 http://localhost:3000/api/health 2>/dev/null || echo 000)
case "$CODE" in
  200) ok "http://localhost:3000 healthy" ;;
  000) warn "dev server not responding — start it with: pnpm dev" ;;
  503) bad "web up but database unreachable (HTTP 503)" ;;
  *)   bad "unexpected HTTP $CODE from /api/health" ;;
esac

printf "\n${DIM}status only: ./scripts/up.sh --status${OFF}\n"
