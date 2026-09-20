# SNAPSHOT_AND_OUTCOME_SPEC.md — Aureus Intelligence

Snapshot engine `se-0.1.0` (`packages/snapshot-engine/`) and outcome engine
`oe-0.1.0` (`packages/outcome-engine/`). Both write immutable records; the outcome
engine additionally enforces anti-look-ahead.

## 1. Snapshots

### Schedule
For each candidate, snapshots are scheduled at fixed offsets from the **exact
discovery timestamp**:

`discovery (0) · +15m · +1h · +6h · +24h · +72h · +7d · +30d`

(`computeSchedule(discoveryAtMs)` → `{kind, scheduledForMs}[]`, kinds
`discovery/m15/h1/h6/h24/h72/d7/d30`.)

### Contents
Each `candidate_snapshots` row bundles, as it was at that instant:
- **market** (price, mcap, fdv), **liquidity**, **holders**, **wallet_flows**;
- the full **feature set** (`snapshot_features`) and **rule results**
  (`snapshot_rules`);
- the **decision_state**, a single **data_quality_status**
  (`OK/DEGRADED/CONFLICTED/STALE`, via `deriveDataQualityStatus`), and the
  **engine_versions** used.

### Immutability
`candidate_snapshots`, `snapshot_features`, `snapshot_rules` are **immutable**:
`UNIQUE(candidate_id, kind)` means one snapshot per instant, and UPDATE/DELETE are
blocked by trigger. Verified by `tests/integration.test.ts` (UPDATE rejected with
"immutable").

## 2. Research notebook

`research_notebook_entries` is an **append-only, totally-ordered** timeline per
candidate (`appendNotebookEntry` assigns a monotonic `seq` under a
transaction-scoped advisory lock). Entry types: `discovery, wallet_event, funding,
liquidity, rule_transition, alert, note, outcome, lesson`. UPDATE/DELETE blocked.
This is the "for every candidate, an append-only timeline" requirement.

## 3. Outcomes

### Scheduling
`buildOutcomeSchedules(anchorAtMs)` creates a horizon row for each of
`m15…d30` per **anchor** (`discovery` or `alert:<id>`), stored in
`outcome_schedules` (the one mutable table: `PENDING → DONE/SKIPPED`).
`dueSchedules(now)` returns rows whose `due_at` has passed.

### Measurement (`measureOutcome`)
From the anchor, over the window `[anchorAt, min(now, anchorAt + horizon)]`:
- **return** (last ÷ anchor − 1), **MFE** (max ÷ anchor − 1), **MAE** (min ÷ anchor − 1);
- **time_to_peak**, **time_to_failure** (first ≤ 50% of anchor);
- **liquidity_loss_pct** (anchor liq − min liq) ÷ anchor liq;
- **holder_growth** (last − anchor);
- **rug_label**: `rug` (liq loss > 90%) / `soft_fail` (return < −70%) / `survived`;
- **sim_entry_return** (vs a simulated entry price);
- **false_positive** (accepted state but failed outcome) / **false_negative**
  (REJECTED but MFE > 100%) — only when the window is complete;
- **reached_state**.

### Anti-look-ahead (binding)
- Only points **inside the horizon window** are used. Points after the horizon are
  **never** read; points after `now` cannot exist. Verified by the outcome test
  (a 10× spike *beyond* the 1h horizon does not affect the 1h MFE).
- `window_complete` is true only once `now ≥ anchor + horizon`. Incomplete windows
  are recorded but **must be excluded from aggregate reports**; false-pos/neg are
  left null until complete.
- `outcome_measurements` is **immutable** and `UNIQUE(candidate, anchor, horizon)`
  (idempotent — a horizon is measured once). Verified by the integration test
  (duplicate rejected, UPDATE rejected).
- In production the outcome worker runs under the `aureus_outcome` DB role, which
  has **no write access** to feature/rule/state tables (0002_roles.sql) — forward
  data structurally cannot leak into a live gate.

## 4. Report inputs (next phase)
The measurements above feed the Deliverable-8 reports (rule precision/recall,
rejected winners, accepted failures, expectancy per state, cohort/narrative/source/
pattern breakdowns). Survivorship is avoided because **every** candidate — including
`REJECTED` and `EXPIRED` — is scheduled and measured.
