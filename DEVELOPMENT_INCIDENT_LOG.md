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
