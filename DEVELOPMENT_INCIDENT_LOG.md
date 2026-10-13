# Development Incident Log

## Data Loss: 2026-09-11

### Timeline

**Phase 1 Validation (Earlier)**
- Baseline: ~1,284+ candidates in database
- V2 snapshots: ~1,284+ records
- Model: v2.0-conservative-allowlist.2
- Status: Validated configuration

**Reset #1: Volume Deletion (During Session)**
- Command: `docker compose down -v`
- Effect: Deleted persistent PostgreSQL volume
- Impact: Complete loss of Phase 1 candidate dataset
- Recovery: None available (no backups)

**Reset #2: Unsafe db:test-reset (Later in Session)**
- Command: `corepack pnpm db:test-reset --target-db=test`
- Actual target: aureus database (not a separate test DB)
- Effect: Reset replacement development database
- Impact: Fresh post-migration state (5 candidates initial seed)
- Root cause: Safety guard was only a CLI flag, not database routing

### Current Database State

```
Database:    aureus
Volume:      aureus-intelligence_aureus_pgdata
Candidates:  6
V2 scores:   0 (reset)
Baseline:    Fresh post-migration
```

### Corrective Action

Implemented `db:test-reset-safe.ts`:
- Parses actual DATABASE_URL before destructive action
- Refuses unless target database ends in `_test`
- Never touches canonical `aureus` database
- Hard safety checks prevent future incidents

### Historical Record

This incident serves as a record that:

1. Original ~1,284 candidate dataset is NOT recoverable
2. Current development database is a fresh post-migration baseline
3. Counts before this date are archived history, not current system state
4. Database safety guards have been strengthened

### Development Implications

- All development work proceeds from fresh baseline
- No legacy data references available
- Wallet intelligence features will be built with current limited data
- Forensics will display current fresh schema state

---

## Missed Winner: 2026-10-12 / 2026-10-13 ($VEIL, a graduation that ran about 55x)

### What happened

- The pump.fun event stream recorded the graduation (2026-10-12 18:58 UTC). Every price lookup in the system (lab watch, Graduations feed, Check button, wallet sync, dossier, exit alerts) uses DexScreener's batch endpoint, which answers with ONE pair per coin.
  For a coin on many venues that pair was the old bonding-curve pair, which has no price after the graduation. The code read "no price" as "gone": the lab closed the coin after twelve polls, the Graduations tab said "no longer listed", and `discoverRunners` never re-adopted a closed coin.
- The coin traded at $85-110K for 35 minutes and under $310K for the first hour, then reached $4.85M. The owner saw it on someone else's screen the next day and asked why the system never showed it.

### Impact

- One coin in 1,430 checked (`scripts/dex-pair-check.ts`), but the biggest winner of the period. A held coin like this would also have produced no exit alert, and the Check button would have called it dead.

### Corrective action

- `apps/web/lib/dexPairs.ts` (ask the all-pools endpoint for a coin whose batch pair has no price, at most 8 times a pass) used in all seven places; the lab re-adopts closed `never_listed`/`gone` coins as runners; a "Hidden, but running now" strip on the Graduations tab; tests for every place.
- Details and the audit it led to: `docs/GRADUATION_AUDIT.md`.

### Lesson

- A silent "no data" is not "dead". When a source answers with something unusable for a coin that other sources know, fall back to the source that lists everything, and measure how often it happens before deciding it does not matter.
- An early explanation ("hidden because it was a born coin") was wrong; the data said otherwise (`organic`, twelve "gone" polls). Check the record before telling the owner why.

## Wrong Research Numbers: 2026-10-13 (decided-window bias)

### What happened

- The first exit-research numbers of the day (told to the owner in chat: "the more is sold at the first alert the better", "all out at 2x +7 points") rested on coins whose outcome was "decided" when they were last read. A coin that died is decided at once; a living coin only after 72 hours. The newest
  318 of 1,479 coins were therefore mostly dead ones, which made selling early look good.
- A second misreading: "74% lose half at the first look" was taken to mean the moment of graduation; the lab's first look is at a pool age of about 1.3 hours.

### Corrective action

- Both claims were withdrawn to the owner in chat and in the documents. Everything was redone on coins whose entry plus 72 hours was over by the latest reading (`MATURE` filter in `scripts/lab-exit-practice.ts` and `scripts/lab-alert-ladders.ts`; `MATURE=0` restores the old behaviour); the entry-timing table was redone on the pool's age (`docs/EXIT_PRACTICE.md`).

### Lesson

- Any statistic over "decided" outcomes needs a maturity filter on the entry time, or recent cohorts are biased towards the quick deaths. See `docs/EXIT_PRACTICE.md`, section 0.
