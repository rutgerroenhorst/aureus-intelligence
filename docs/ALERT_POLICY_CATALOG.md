# ALERT_POLICY_CATALOG.md — Aureus Intelligence

Alert engine `ae-0.1.0` (`packages/alert-engine/`). Alerts are produced by a
**deterministic policy engine**, not scattered `if`-statements and never by a lone
AI score. A candidate is "good enough to notify" only through explicit rule
results + a valid state transition + sufficient data quality.

## Every alert requires (binding)
- a **valid state transition** (alerts fire on change, not every poll);
- explicit **rule results** (from the deterministic rule engine);
- **fresh** required inputs (freshness gate);
- **no critical safety FAIL**;
- **no stale critical inputs**;
- **reproducible** conditions → a stable `evidence_hash` used for exact-once dedup.

No fake data. No alert when Helius data is required but unavailable. No guaranteed
profit language anywhere.

## Alert levels
`INFO < WATCH < HIGH_PRIORITY < ENTRY_READY < RISK` (SYSTEM is operational).
`TELEGRAM_MIN_ALERT_LEVEL` filters what is delivered.

## Policies

Each policy carries `policy_id, version, level, required transition, required
rules, forbidden failures, thresholds, cooldown, severity, template, enabled,
explanation`. Thresholds come from one frozen config (`DEFAULT_ALERT_CONFIG`).

### `NEW_WATCH` — level WATCH
Fires when a candidate first reaches **STRUCTURE_WATCH** or **QUALITY_CONFIRMED**
with **no safety FAIL** and no critical failure. "Something worth watching formed."

### `HIGH_PRIORITY` — level HIGH_PRIORITY
Fires on transition to **ENTRY_WATCH** when: safety not FAILED, no critical FAIL,
quality ≥ DEVELOPING, data fresh, **liquidity ≥ minimum**, and **not overextended**.
(The state machine only reaches ENTRY_WATCH when quality is CONFIRMED and safety
PASSED, so on-chain confirmation is already present.)

### `ENTRY_READY` — level ENTRY_READY
Fires **only** on **ENTRY_WATCH → ENTRY_READY** and **only** when the full
conjunction holds:
- Safety aggregate = **PASSED**;
- Data-quality aggregate = **PASS** (fresh, no open critical conflict);
- **no critical FAIL**;
- data freshness within threshold;
- **liquidity ≥ configured minimum**;
- **not overextended**;
- **at least one clear invalidation** available;
- not already sent for this state/version (dedup).
- **If Helius = DEGRADED → never fires.** On-chain confirmation is mandatory. A
  WATCH-level note ("On-chain confirmation unavailable — not entry ready") is used
  instead.

### `RISK` — level RISK
Fires when a **previously-surfaced** candidate degrades: safety FAIL, liquidity
drain (SAFE-05), deployer/blacklist risk (SAFE-02), insider concentration
(SAFE-03), overextension, **loses ENTRY_READY**, or becomes **REJECTED / EXPIRED /
POSITION_RISK**. RISK **overrides HIGH-priority** and **bypasses cooldown**.

### SYSTEM — level SYSTEM
Operational (worker offline, Dex Screener unreachable, DB/Redis down, Telegram
delivery failures, Helius LIVE→DEGRADED, queue backlog). Emitted by the worker's
monitoring, surfaced on `/system`. (Telegram delivery of SYSTEM alerts is the next
increment; the signals are already tracked in `worker_heartbeats` / `source_health`.)

## Deduplication & cooldown
- `alert_events` is **UNIQUE on `dedup_key`** =
  `candidate:policy:version:state_to:evidence_hash`. Identical conditions never
  alert twice — including after a worker restart or an identical re-poll.
- **Cooldown** per (candidate, level) suppresses a *new-hash* alert within the
  window; the event is still recorded, delivery marked SKIPPED. RISK bypasses.
- A genuinely new state transition → new `dedup_key` → a new alert is allowed.
- Delivery is **retry-safe**: FAILED deliveries are retried (bounded attempts);
  `telegram_message_id`, attempts, and `last_error` are stored.

## Message templates
Compact HTML (see `packages/notifications/src/format.ts`). All dynamic token
symbols are HTML-escaped. ENTRY_READY messages include invalidation + risks and
"Not financial advice." RISK messages show previous → new state and the reason.
