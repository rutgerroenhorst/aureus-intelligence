# TRANSITION_MATRIX.md — Aureus Intelligence

The deterministic state reducer (`packages/rule-engine/src/transition.ts`,
`reduceState`). It consumes the aggregated rule statuses and produces exactly one
candidate state. **First matching clause wins** — the table is ordered and total.

## Inputs to the reducer
- `safety ∈ {PASSED, INCOMPLETE, FAILED}` — from the SAFETY family (hard-fail dominates).
- `quality ∈ {WEAK, DEVELOPING, CONFIRMED}` — from the QUALITY family.
- `entry ∈ {TOO_EARLY, WAIT_FOR_LEVEL, READY, OVEREXTENDED, INVALIDATED, EXPIRED}` — from the ENTRY family (only consulted when quality = CONFIRMED).
- `positionRiskFail` — any POSITION_RISK FAIL (only with an open position).
- `freshnessOk` — DQ-01-FRESHNESS = PASS.
- `openCriticalDataQuality` — DQ-02-SOURCE-CONFLICT = FAIL (HIGH/CRITICAL).
- `aged` — `now − discoveredAt > discoveryTtl` (default 72h).

## Ordered transition table

| # | Condition (first match wins) | → State | Reason |
|---|---|---|---|
| 1 | `safety = FAILED` | **REJECTED** | a critical safety gate failed (cannot be compensated) |
| 2 | `safety = INCOMPLETE` | **UNRESOLVED** | critical safety data incomplete (unknown ≠ bad) |
| 3 | `safety = PASSED` ∧ `hasOpenPosition` ∧ `positionRiskFail` | **POSITION_RISK** | open position threatened |
| 4 | `safety = PASSED` ∧ `quality = CONFIRMED` ∧ `entry = OVEREXTENDED` | **OVEREXTENDED** | confirmed token, price stretched |
| 5 | `… quality = CONFIRMED` ∧ `entry = READY` ∧ `freshnessOk` ∧ ¬`openCriticalDataQuality` | **ENTRY_READY** | full conjunction green + fresh |
| 6 | `… quality = CONFIRMED` ∧ `entry = READY` ∧ (stale ∨ conflict) | **ENTRY_WATCH** | entry ready but data stale / conflicted |
| 7 | `… quality = CONFIRMED` ∧ `entry = WAIT_FOR_LEVEL` | **ENTRY_WATCH** | waiting for the level |
| 8 | `… quality = CONFIRMED` ∧ `entry = INVALIDATED` | **ENTRY_WATCH** | invalidated; re-watch |
| 9 | `… quality = CONFIRMED` ∧ `entry = EXPIRED` | **EXPIRED** | entry window expired |
| 10 | `… quality = CONFIRMED` ∧ `entry = TOO_EARLY` | **QUALITY_CONFIRMED** | confirmed, entry not yet in play |
| 11 | `safety = PASSED` ∧ `quality = DEVELOPING` | **STRUCTURE_WATCH** | safety passed, quality developing |
| 12 | `safety = PASSED` ∧ `quality = WEAK` ∧ `aged` | **EXPIRED** | discovery window elapsed unqualified |
| 13 | `safety = PASSED` ∧ `quality = WEAK` | **RESEARCHING** | gathering evidence |

`RESEARCHING` is also the initial state at candidate creation (before the first
evaluation). Every one of the ten canonical states is reachable.

## The ENTRY_READY conjunction (row 5)
`ENTRY_READY` requires **all** of: Safety PASSED · Quality CONFIRMED · Entry READY
· data fresh (`freshnessOk`) · no open critical data-quality conflict. If any
clause drops, the reducer immediately leaves ENTRY_READY (rows 6–10), never
"sticking" on a stale green. Positive signals cannot substitute for a failed
clause.

## Determinism
The reducer is a pure function; combined with the versioned rule/feature engines
and `param_hash`, the same inputs always yield the same state. Verified by
`rule-engine.test.ts` (hard-fail → REJECTED, missing Helius → UNRESOLVED, stale →
ENTRY_WATCH, all-green → ENTRY_READY, overextension → OVEREXTENDED, position risk →
POSITION_RISK) and the determinism test.
