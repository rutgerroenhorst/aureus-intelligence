# RESEARCH_LAB.md — Aureus Validation Lab

A research environment (not a trading bot) to test whether Aureus's rules select
better coins than a raw Dex Screener feed. It measures outcomes over the
price/liquidity/volume time-series **already collected** — no new signals, sources,
Telegram, or Helius. All numbers are facts from the database; there are no AI
conclusions and no probability claims.

## Components

### 1. Replay Engine (candidate page → "Replay — lifecycle")
Play/scrub the full lifecycle: a price sparkline plus every event (discovery,
snapshots, state transitions, notebook entries, alerts) at its real timestamp.
The cursor shows price, return-from-discovery, and the active state at each instant.

### 2. Paper Tracking (automatic)
For every candidate, from discovery, the worker computes and stores (idempotently,
each cycle — nothing manual):
- horizons **15m / 30m / 1h / 2h / 4h / 8h / 24h / 3d / 7d**;
- per horizon: return %, max drawdown, max run-up, liquidity, volume, and a
  `window_complete` flag;
- a per-candidate summary: discovery price/liquidity/FDV/volume, peak run-up,
  final return, max drawdown, time-to-peak, liquidity/volume growth, lifespan,
  and a **rug** flag (liquidity fell below 10% of discovery).

**Anti-look-ahead:** only points inside `[anchor, min(now, horizon)]` are used;
points past the horizon are never read; incomplete windows are flagged, not faked.

Tables: `paper_tracking`, `candidate_research` (both recomputable, not immutable).
Backfill all history: `pnpm validation:compute`.

### 3. Validation Dashboard (`/validation`)
Candidates, avg peak run-up, median final return, winrate, rug rate, avg lifespan,
avg liquidity/volume growth, avg drawdown, plus Top-10 (by peak) and Bottom-10 (by
final).

### 4. Compare Engine (`/validation`, "Compare engine")
Each cohort (e.g. **SAFE-05 Liquidity-stability PASS**, liquidity ≥ $25k, data
completeness ≥ 80%, buyer-growth PASS, retention PASS) vs the rest: n, winrate,
mean/median peak, mean final, mean drawdown, rug %. This is how you see which
condition actually separates winners from losers.

### 5. Rule Attribution (`/validation/rules`)
Per rule: how often PASS / FAIL / INCOMPLETE, mean peak run-up of each group, rug
rates, a Welch t-statistic between PASS and FAIL peaks, and a **verdict** —
`edge`, `⚑ no measurable edge`, or `not yet measurable` (flagged when a rule has
no PASS/FAIL variance or too few samples). We deliberately report the statistic and
sample sizes, **not** a p-value dressed up as certainty.

### 6. Research Mode (`/validation/research`)
Factual queries: pick a metric (peak / 4h / final) and a threshold. Returns the
matching candidates, the **rules they shared** (fraction PASS), the **strongest
features** (fraction available), and the **blockers that never occurred** in that
set. Example: peak ≥ 300%.

## The current headline finding (Helius OFF)
Because on-chain data is unavailable, **most SAFETY/QUALITY rules are all-INCOMPLETE
and cannot be attributed yet** — they have no PASS/FAIL variance. Only rules driven
by price/liquidity data (liquidity stability, overextension, capital retention,
freshness) currently split into PASS/FAIL. So the first, honest research conclusion
is: *proving edge for the on-chain rules requires turning the on-chain inputs on.*
Among the measurable rules, early cohorts already differ (e.g. Liquidity-stability
PASS showed materially higher mean peak and positive mean final vs the rest) — but
sample sizes are small and **24h+ windows are not yet complete**, so these are
directional, not conclusions.

## Honest limits of the current data
- **No complete 24h/3d/7d windows** — the scanner has not run continuously for a
  full day, so those horizons are reported as incomplete, never as final returns.
- **Small cohorts** for the measurable rules (tens, not hundreds) → attribution
  verdicts are conservative and mostly "not yet measurable".
- To strengthen the study: run `pnpm worker:start` continuously for several days,
  then re-read `/validation`. The lab needs *time* and (for the on-chain rules)
  *Helius*, not more code.
