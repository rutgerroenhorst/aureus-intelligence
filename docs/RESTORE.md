# Going back to a known state

Two restore points are tagged in git (and pushed to GitHub):

| tag | what it is |
| --- | --- |
| `restore/2026-10-10-current` | the live system on 2026-10-10, before the overnight work: Learning Lab, lanes, system loop, Runners tab, Lab line on Radar cards, Next 14.2.35 (production `main` at commit `2b1a160`) |
| `restore/2026-10-10-before-lab` | the system as it was that morning, before the Learning Lab existed (commit `0eef8a8`: trade journal, polling back-off) |

Two more tags mark the states after the overnight work, so you can always go forward again:

- `release/2026-10-10-overnight`: free data sources, the pump.fun event stream, the coin dossier, Home, the Graduations tab, RugCheck holder snapshots, hypotheses H7-H10
  (everything in `docs/LEARNING_LAB.md` and `docs/DATA_SOURCES.md`).
- `release/2026-10-11-final`: all of that plus the lean coin cards (Enter and DexScreener everywhere, no Dossier button or Lab line) and the wallet sync (`docs/WALLET.md`).
  `scripts/restore-baseline.sh release/2026-10-11-final` goes back to this one.

## Put the code back (one command, nothing is deleted from history)

```bash
scripts/restore-baseline.sh                              # back to restore/2026-10-10-current
scripts/restore-baseline.sh restore/2026-10-10-before-lab   # back to before the Learning Lab
```

It makes a NEW commit on `main` whose files are exactly the tagged state (files added since are removed in that commit), pushes it,
and Vercel deploys it as the production site. Every earlier commit stays in the history, and the state `main` had just before the restore
is tagged `pre-restore/<date-time>`, so the work is never lost: `scripts/restore-baseline.sh pre-restore/<date-time>` goes forward again.
This document and the script stay on `main` after a restore. It refuses to run with uncommitted changes.

## The data needs nothing

Every database change of the overnight work only ADDS (new tables, new rows); no existing table or column is altered or dropped, so the
previous code runs unchanged against the current databases and simply ignores the new tables. Nothing has to be undone in Supabase or in
the laptop database. (If a migration ever has to be removed: `DROP TABLE` of the tables it created, named in the migration file.)

Migrations added since the restore point: `0029_lab_watch.sql`, `0030_pump_feed.sql`, `0031_wallet.sql` and `0032_trade_peak_known.sql`; they only create tables (`lab_watch`, `pump_launches`, `pump_graduates`, `wallet_watch`, `wallet_txs`, `wallet_fills`), grants and nullable columns on `my_trades` (`sold_usd`, `sold_fraction`, `tokens_held`, `peak_known`). The restore point's code ignores them. The wallet sync (docs/WALLET.md) added 144 rows to `my_trades` (`source = 'wallet'`) and corrected 5 of the user's own rows; the hosted journal as it was before is saved in `backups/2026-10-10-before-overnight/hosted-my_trades-before-wallet.json`, and `DELETE FROM my_trades WHERE source = 'wallet'` removes the added rows.

`0033_trade_chain.sql` (2026-10-11, networks beyond Solana: docs/HOT_NETWORKS.md) adds one column, `my_trades.chain` (text, default `'solana'`), applied to both databases. Code from before it never reads it, and every older row is `solana`. The same work adds a `lab_reports` row of kind `hotchains` (the ranking of the networks; delete it with `DELETE FROM lab_reports WHERE kind = 'hotchains'` if you want it gone) that the laptop worker/daemon refreshes every 4 minutes (`HOT_LOOP=0` switches that off).

`0034_exit_alerts.sql` (2026-10-11, docs/EXIT_ALERTS.md) adds two small tables, `exit_alerts` and `exit_alert_kv` (which exit alerts went out; no token, no chat id), applied to the laptop database only so far. The alerts need a git-ignored `.env.exit-alerts.local` with the Telegram bot token; without it the loop does nothing, and `EXIT_ALERTS=0` switches it off. Code from before never reads either table. `0035_telegram_messages.sql` adds the log of what was sent to Telegram (text, kind, result; no token, no chat id), applied to both databases; both migrations are additive.

`0036_prune_rule_evaluations.sql` (2026-10-11, docs/LIMITS.md) replaces one function, `prune_history()`, so that it also deletes superseded rows of the rule-evaluation log (the newest row of
every rule of every candidate is kept). Applied to both databases; only the hosted site ever calls it (when `RETENTION_DAYS` is set; on the Vercel project it was lowered from 7 to 4 that evening).
The laptop database is never pruned. Going back to the 0026 version of the function is `CREATE OR REPLACE FUNCTION` with the body in `0026_cloud_retention.sql`; rows deleted from the hosted
database are gone (the hosted copy is a rolling window by design; the laptop database keeps its own, separate record of the laptop's own scans).

`0037_wallet_flows.sql` (2026-10-11, docs/WALLET.md) adds `wallet_flows` (deposits and withdrawals of SOL found in the wallet's transactions) and one column, `wallet_txs.flows_read` (default false); `0038_coin_checks.sql` (docs/COIN_CHECK.md)
adds `coin_checks` (the user's Check presses with what was measured). Both additive, applied to both databases; code from before ignores them (`DROP TABLE wallet_flows` / `coin_checks` removes them).

Environment variables on Vercel: none were added or changed overnight. On 2026-10-11 three production variables of type *sensitive* were added for the 24/7 exit
check: `CRON_SECRET`, `EXIT_ALERT_TOKEN`, `EXIT_ALERT_CHAT_ID` (docs/EXIT_ALERTS.md). Without them the route answers 401 or "no bot token configured" and nothing else changes.

**The database clock (2026-10-11).** The hosted database has the extensions `pg_cron` and `pg_net`, one entry in Supabase Vault (`aureus_cron_secret`) and four jobs:
`aureus-exit-alerts` (every 2 minutes, calls `/api/cron/exit-alerts`), `aureus-maintenance` (hourly, calls `/api/scan`: a market scan if one is due, the learning round and the
housekeeping, the same round a screen asks for), `aureus-learning` (at :30 every hour, `/api/scan?only=learning`) and `aureus-cron-cleanup` (daily, deletes the clock's own run history
older than 2 days). To stop them: `LAB_SYNC_URL=<hosted connection string> corepack pnpm exec tsx scripts/cron-setup.ts remove` (add `--secret` to delete the vault entry as well); the extensions are
harmless and stay. The site then behaves as before: scans only while a screen is open, exit alerts only from the laptop daemon. The extra rows in `exit_alert_kv` (`hosted_tick`,
`hosted_tick_ok`, `streaks`) and the 111 rows copied into the hosted `exit_alerts` are only read by the new code.

Background processes started on the laptop during the overnight work: `scripts/lab-daemon.ts` (holds pump.fun's event stream and runs a lab round every 10 minutes). Stop it with `pkill -f lab-daemon`. The restore point's worker does not start it or the stream. If it was started with `LAB_SYNC_URL`, it also writes one row (`lab_reports`, kind `gradlist`) to the hosted database every 3 minutes; that row is additive and the restore point's code never reads it (delete it with `DELETE FROM lab_reports WHERE kind = 'gradlist'` if you want it gone).

## The laptop worker

The long-running worker loads its code when it starts. After a restore, stop it (Ctrl+C in its terminal) and start it again with
`pnpm worker:start`. To keep the new code but turn the Learning Lab's own rounds off: start it with `LAB_IN_WORKER=0`.

## Last-resort copies of the data (made 2026-10-10 15:30, before the overnight work)

In `business takeoverAI/backups/2026-10-10-before-overnight/` (not in git):

- `local-aureus.dump`: a full `pg_dump -Fc` of the laptop database. Restore into an empty database with
  `docker exec -i aureus_postgres pg_restore -U aureus -d <empty db> --no-owner < local-aureus.dump`.
- `cloud/*.jsonl.gz`: every table of the hosted (Supabase) database as JSON lines, plus `_manifest.json` with the row counts. This is a record
  of the data, not a one-command restore: the hosted database is never altered destructively, so it should never be needed.

## Vercel

Production is a plain deployment of `main`, so restoring `main` (above) restores the site. The two latest production deployments at the
restore point were `aureus-intelligence-79nahhub7-rutgerroenhorsts-projects.vercel.app` (`2b1a160`) and
`aureus-intelligence-7084jltyg-rutgerroenhorsts-projects.vercel.app` (`7ad6b8d`). On the free plan the dashboard's "Instant Rollback" may only
offer the previous deployment, which is why the git route above is the reliable one.
