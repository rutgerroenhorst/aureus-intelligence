# Cloud scanning and the learning loop

How the Vercel site keeps its data fresh without a machine of its own, and how the Self-Optimizer gets its data.
(Supersedes the browser-driven design described in `LEARNING_SYSTEM.md` / `LEARNING_QUICKSTART.md`.)

## 1. The site scans the market itself

There is no always-on server on Vercel. Instead the web app runs the worker's own cycle on demand:

```
AppShellElite (every open screen, once a minute)
   -> GET /api/telemetry      -> { lastWorkerCycleAt, scan: { scan:{running,due}, learning:{running,due} } }
   -> POST /api/scan          only when something is due
         claim lease (scan_lease row)  ->  waitUntil( runScan() ; runLearning() )  -> 202 immediately
```

- `apps/web/lib/cloudScan.ts` owns the leases and the jobs. `runScan()` imports `apps/worker/src/run.ts` and calls
  `scanOnce()`: exactly the cycle `pnpm worker:once` runs (discovery, scoring, writes to Postgres, heartbeat).
  `next.config.mjs` needs `experimental.externalDir` and the `.js -> .ts` `extensionAlias` for that import.
- **A scan only starts while somebody has the site open** and the newest scan of ANY scanner is older than
  `SCAN_EVERY_MINUTES` (default 10). A closed site costs nothing and scans nothing; opening it catches up within a
  minute. Data is "Live" in the shell for 20 minutes after a scan.
- If another scanner is running (the laptop worker, a scheduled job), its heartbeat keeps `due` false and the site
  never scans. Both can coexist.
- `scan_lease` (migration 0025) makes sure a job runs once at a time across devices and instances. A job that dies
  frees itself when its lease TTL passes; a failed job is retried after 2 minutes.
- Every job writes `{ok, ms, cpuMs, ...}` to `scan_lease.last_result`, so Vercel "Active CPU" per scan can be read
  with `select name, last_result from scan_lease`.
- Migration 0025 also makes `ensure_time_partitions()` SECURITY DEFINER: the web role has no DDL rights, but the
  monthly partition rollover must still work.

### Driving it from outside (optional)

`GET|POST /api/scan` with `Authorization: Bearer $CRON_SECRET` (env var, not set by default) runs a tick without a
browser; `?only=scan|learning` narrows it, `?force=1` ignores the minimum interval. Behind Vercel Authentication an
outside caller also needs the protection-bypass header. Without `CRON_SECRET` nothing outside can trigger a tick.

### Limits to keep in mind

Vercel Hobby: 1M invocations, 4 CPU-hours, 300 s per function per month. A scan measured 1.0 to 1.3 s of CPU locally,
so a screen open 24/7 costs roughly 2 CPU-hours a month. Raise `SCAN_EVERY_MINUTES` if the CPU budget gets tight.
The `/api/scan` function is limited to 300 s in `apps/web/vercel.json` (first matching pattern wins, so it is listed
before the generic 60 s entry).

## 2. The learning loop

After each scan (and every `LEARNING_EVERY_MINUTES`, default 5, otherwise) `runLearning()` does:

1. `updateOutcomes()` re-measures every coin that is still `pending` (and winners for 24 h) with batched DexScreener
   calls (`tokens/v1/solana/{30 mints}`) and labels the ones that can be labelled.
2. `trackQualified()` reads the same routes the Radar tabs use (`cate`, `buy_signals`, `ultra_momentum`, `elite`,
   `incubation`) and records every listed coin that was not already tracked for that tab in the last 24 h.
   The baseline market cap is fetched live at that moment, not taken from the stored value.
3. Hourly, `/api/learning-generate-suggestions` proposes filter cut-offs.

### How a coin is graded (`decideOutcome` in `lib/learning-engine.ts`)

| label | rule |
| --- | --- |
| winner | market cap reached 2x the baseline at any check (kept, even if it falls back) |
| rugpull | under 0.5x, or liquidity under $100, without ever reaching 2x |
| dead | no pool listed an hour after qualifying, or nothing traded after the watch period |
| loser | still between 0.5x and 2x after `LEARNING_HORIZON_HOURS` (default 6) |
| pending | anything else: too early to call |

Coins are only measured when a tick runs, i.e. while the site is open or another scheduler drives `/api/scan`.
A spike that comes and goes between two ticks is invisible. Treat win rates as "what was observed".

### Suggestions (`lib/learning-stats.ts`)

For every tab and age bucket (`<2h, 2-6h, 6-12h, 12-24h, 24-48h, 48h+`) and metric (buy ratio, top-10 holders,
danger score, volume velocity, price velocity, score, liquidity) the best cut-off is searched among nine quantiles.
It must keep at least half of the winners and 30% of the coins, lift the win rate by at least 10 points over the
group's own win rate, and reach 50% confidence after correcting for the nine cut-offs tried. Needs about 10 graded
coins with at least 5 winners and 5 non-winners per group, so expect the first suggestions after a day or two of
tracking. Suggestions are only proposals (`pending_review`); older ones are marked `superseded`, never deleted.

`filter_suggestions.current_threshold` holds the edge the group currently lets in (its lowest or highest observed
value), not an active filter. `age_bucket_min/max` are in hours.
