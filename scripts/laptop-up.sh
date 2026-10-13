#!/bin/sh
# Start the laptop side of the system, for example after a reboot (docs/DISASTER_RECOVERY.md).
#
#   scripts/laptop-up.sh            Docker (the database and Redis), then the worker in the background; logs in logs/
#   scripts/laptop-up.sh --daemon   the same, plus the lab daemon (the pump.fun event stream and the lab's rounds)
#   scripts/laptop-up.sh --status   what is running, and nothing else
#   scripts/laptop-up.sh --stop     stops the worker and the daemon (Docker stays up)
#
# The site itself needs none of this: it runs on Vercel and Supabase, the clock is in the database. What the laptop adds is the websocket stream of pump.fun, the lab's
# launch tables, the hot-network ranking refreshed every few minutes and the full research record in the laptop database.
# The hosted database's connection string is read from .env.hosted.local and handed to the worker as LAB_SYNC_URL, which is how the laptop and the site share state.
set -eu
cd "$(dirname "$0")/.."
mkdir -p logs

running() { pgrep -f "$1" >/dev/null 2>&1; }

status() {
  if docker info >/dev/null 2>&1; then
    echo "docker:      running ($(docker ps --filter name=aureus_ --format '{{.Names}} {{.Status}}' | tr '\n' ';'))"
  else
    echo "docker:      NOT running"
  fi
  running "apps/worker/src/run.ts" && echo "worker:      running" || echo "worker:      not running"
  running "scripts/lab-daemon.ts" && echo "lab daemon:  running" || echo "lab daemon:  not running"
}

case "${1:-}" in
  --status) status; exit 0 ;;
  --stop)
    pkill -TERM -f "apps/worker/src/run.ts" 2>/dev/null || true
    pkill -TERM -f "scripts/lab-daemon.ts" 2>/dev/null || true
    sleep 2
    status
    exit 0
    ;;
esac

# 1. Docker Desktop and the two containers (restart: unless-stopped brings them back by themselves; this only waits for them)
if ! docker info >/dev/null 2>&1; then
  echo "starting Docker Desktop ..."
  open -a Docker
  i=0
  until docker info >/dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -gt 60 ] && { echo "Docker did not start within 5 minutes"; exit 1; }
    sleep 5
  done
fi
docker compose up -d postgres redis >/dev/null
i=0
until [ "$(docker inspect -f '{{.State.Health.Status}}' aureus_postgres 2>/dev/null)" = "healthy" ]; do
  i=$((i + 1))
  [ "$i" -gt 36 ] && { echo "the laptop database is not healthy after 3 minutes: docker logs aureus_postgres"; exit 1; }
  sleep 5
done
echo "database and Redis are up"

# 2. the settings the worker needs (private files, never printed)
set -a
[ -f .env.hosted.local ] && . ./.env.hosted.local
[ -f .env.exit-alerts.local ] && . ./.env.exit-alerts.local
set +a
[ -n "${HOSTED_DATABASE_URL:-}" ] && export LAB_SYNC_URL="$HOSTED_DATABASE_URL"

# 3. the worker (it holds a lock in Redis, so a second copy would not double the work)
if running "apps/worker/src/run.ts"; then
  echo "the worker is already running"
else
  nohup corepack pnpm worker:start >> logs/worker.log 2>&1 &
  echo "worker started (log: logs/worker.log)"
fi

if [ "${1:-}" = "--daemon" ]; then
  if running "scripts/lab-daemon.ts"; then
    echo "the lab daemon is already running"
  else
    nohup corepack pnpm exec tsx scripts/lab-daemon.ts >> logs/lab-daemon.log 2>&1 &
    echo "lab daemon started (log: logs/lab-daemon.log)"
  fi
fi
sleep 3
status
