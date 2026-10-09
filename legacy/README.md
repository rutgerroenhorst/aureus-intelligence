# Legacy import drop zone

Place the source files here to run the legacy migration. **These files may
contain private data and are gitignored** (only this README and `.gitkeep`s are
tracked).

## Files the importer expects

| File | Put it at | Used for |
|---|---|---|
| `Wallet_Deployer_Intelligence_DB.xlsx` | `legacy/inbox/Wallet_Deployer_Intelligence_DB.xlsx` | Wallet DB, Deployer-Funding DB, Blacklist, Bundler detection, Candidate pipeline, Observation Log, Unresolved, Data Quality |
| `Command Center.html` (optional) | `legacy/inbox/command-center.html` | **Context/navigation only** — never imported as database fact |

The importer auto-detects sheets by header signature, so exact sheet names are not
required, but the workbook must be the one described above.

## Run

```bash
pnpm import:legacy            # dry-run: parses + writes staging + report, no promotion
pnpm import:legacy --commit   # promote staged rows into canonical tables
```

Output: a timestamped report in `legacy/reports/` with counts of
imported / skipped / unresolved / conflicting rows, plus per-row reasons.
