# Disaster recovery: how the system is put together, how it is kept safe, and how to get it back

Written 2026-10-13 at the owner's request: *"if the system breaks completely, or I change something and it suddenly behaves differently, I want to get it back"*, and *"only you and I can see it"*.
This file is the hub. The names and addresses of the accounts (project ids, the bot, the laptop's paths) are in `.private/INFRASTRUCTURE.md`, which is **not in git** (it is copied into every backup). No secret value is in either file.

## For the owner (Dutch, short)

- **Iets kapot of anders na een wijziging?** Zeg tegen Claude: *"herstel naar het laatste werkende punt"*. Claude zet de code terug met `scripts/restore-baseline.sh <tag>` en kijkt met `scripts/verify-system.ts` of alles weer klopt. Je data komt uit de backups.
- **Vóór een grote wijziging** laat Claude eerst een restore-tag zetten, een backup nemen en `verify-system.ts` draaien (stap "Before a risky change" hieronder). Vraag erom als het niet gebeurt.
- **Na een herstart van de laptop**: `scripts/laptop-up.sh` start Docker, de lokale database en de worker. De site zelf draait door op Vercel en Supabase.
- **Wat alleen jij kunt doen** (accounts): tweestapsverificatie aan op GitHub, Vercel, Supabase en je e-mail; de GitHub-repository op *private* zetten; de toegangscode in een wachtwoordmanager bewaren; een kopie van de map `backups/` buiten de laptop bewaren (externe schijf of een versleutelde cloudmap).

## The system on one page

```
 phone / laptop browser ──https──▶  Vercel: the Next.js site (apps/web)                   ◀── the lock: middleware.ts (docs/ACCESS.md)
                                       │  reads and writes                                    cookie from /login, or the service secret
                                       ▼
                         Supabase Postgres (the hosted database, Free plan)
                                       ▲  pg_cron + pg_net: six jobs call the site (/api/cron/*, /api/scan) with the service secret;
                                       │  the watchdog job messages Telegram when the site's exit check stops
   Telegram bot ◀── exit alerts ───────┘  (the site sends them; the laptop worker is a second sender)

 the laptop (optional extras): Docker { Postgres 16 (the research record, 4 GB), Redis }, the worker (pnpm worker:start), the lab daemon
 GitHub: the code (the laptop clone is a full copy)          data sources: DexScreener, GeckoTerminal, Jupiter, RugCheck, PumpPortal (websocket), Solana public RPC (all free, no keys)
```

- **Runs 24/7 without the laptop** (on the site and in the database): the Radar, the exit alerts every 2 minutes, the graduations feed every 3 minutes, an hourly scan and learning round, the watchdog (docs/EXIT_ALERTS.md, docs/GRADUATIONS_FEED.md, docs/CLOUD_SCAN_AND_LEARNING.md).
- **Needs the awake laptop**: the pump.fun websocket stream (the exact graduation second and the creator's launch buy), the lab's launch tables, the hot-network ranking refreshed every 4 minutes, the full-speed research scans in the laptop database.
- **The code**: `apps/web` (the site), `apps/worker` (the laptop worker), `packages/*` (shared engines), `db/migrations` (the schema, 38 files, additive only), `db/hosted` (SQL for the hosted database only), `scripts/` (operations), `docs/`.
- **Free-plan limits that must not be crossed** (docs/LIMITS.md): Vercel Hobby 4 CPU-hours a month and 1M invocations; Supabase Free 500 MB and 5 GB egress a month, and no backups of its own. **No paid service is ever added without the owner's yes.**

## Where everything lives

| thing | where | copy / way back |
| --- | --- | --- |
| the code | GitHub repository, and the laptop's clone | `git clone`; `backups/<date>/repo.bundle` (`scripts/backup.ts --git`) |
| the site | Vercel project, deploys from `main` on every push | `scripts/restore-baseline.sh <tag>`; or rebuild the project (below) |
| the hosted database | Supabase project | `backups/<date>/hosted/` (`scripts/backup.ts`), `scripts/restore-hosted.ts` |
| the clock (six jobs) and its vault entries | inside the hosted database | `scripts/cron-setup.ts install`; `backups/<date>/hosted/_cron.json` lists the jobs |
| the research record | the laptop's Postgres (Docker volume) | `backups/<date>/local-aureus.dump` (`scripts/backup.ts --local`) |
| restore points of the code | git tags `restore/*` and `release/*` | `git tag --list 'restore/*'` |
| secrets | see below; never in git | a password manager (the owner), the places in the table below |
| the docs | `docs/` (index: `docs/README.md`) | in git and in the bundle |
| the private inventory | `.private/INFRASTRUCTURE.md` | copied into every backup |

## Secrets: names, places, how to replace one

| secret | lives in | replace it |
| --- | --- | --- |
| `SITE_ACCESS_CODE`, `AUTH_SECRET` (the lock) | Vercel env (sensitive), `.env.access.local` | `scripts/access-code.ts rotate`, then push or redeploy (docs/ACCESS.md) |
| `CRON_SECRET` (the service secret) | Vercel env (production), the database's vault entry `aureus_cron_secret` | a new random string (32+ plain characters) in Vercel, then `CRON_SECRET=<new> scripts/cron-setup.ts install` (updates the vault), then redeploy |
| the Telegram bot token and chat id | `.env.exit-alerts.local`, Vercel env, the vault entries `aureus_telegram_token` and `aureus_telegram_chat` | BotFather `/revoke`; new values in the file and in Vercel; `EXIT_ALERT_TOKEN=... EXIT_ALERT_CHAT_ID=... scripts/cron-setup.ts install`; restart the worker |
| the hosted database's admin password | `.env.hosted.local`, the legacy `run-migrations.mjs` | reset it in the Supabase dashboard (Project Settings, Database); update `.env.hosted.local` |
| the site's database user (`aureus_app`) | Vercel env `DATABASE_URL` only | `ALTER ROLE aureus_app PASSWORD '<new>'` through `scripts/hosted-sql.ts --write`; the new URL into Vercel; redeploy |
| the Vercel command-line login | `~/Library/Application Support/com.vercel.cli/auth.json` | `vercel login` |
| GitHub, Vercel, Supabase, Telegram, e-mail | the owner | two-step verification on all of them |

**If a secret leaked**: replace it as above, then check `scripts/verify-system.ts`. A leaked access code or service secret lets a stranger read the data and use the site's own write routes (the journal's Enter button and the like; not change the code or the database's structure); a leaked database password is the serious one.

## Care routine

- `corepack pnpm exec tsx scripts/verify-system.ts` (add `--tests` to run the suite): about 30 checks, read-only, a minute. PASS / WARN / FAIL. Run it after every deployment and when something feels off.
- **Backups** (`scripts/backup.ts`; the output goes to `../backups/<date>-<label>/`, outside the repository, never to be committed; it holds personal data):

  | command | what | cost on the free database | when |
  | --- | --- | --- | --- |
  | `--tier user` | the journal, the Checks, the followed wallet and its reads, the alert state, the Telegram log, the lab's reports (11 tables) | under 1 MB of egress | daily |
  | `--tier essentials` (default) | everything except the big rolling history tables | about 45 MB | weekly |
  | `--tier all` | every table (108) | about 215 MB (4% of a month) | before a risky change; monthly |
  | `--local` | `pg_dump` of the laptop database (about 600 MB, a few minutes; needs 4 GB of free disk) | none | monthly, and before touching Docker |
  | `--git` | a `git bundle` of every branch and tag | none | weekly |

  Every hosted export reads one consistent snapshot (a table read earlier than its parent would not fit back). The first backup of 2026-10-13 (`...-0557-before-hardening`) predates that and fails three foreign-key checks on a restore into a database that enforces them; use a later one.
  **Copy the newest folder off the laptop** (external drive, encrypted cloud folder): a backup on the machine that is lost is no backup.
- **Disk**: the laptop database is 4 GB and grows; the Mac had 10 GB free once. `verify-system.ts` warns below 15 GB. Docker's build cache and unused images are the safe things to clear (`docker system df`).

## Before a risky change

1. `git tag -a restore/<date>-<what> -m "..." && git push origin restore/<date>-<what>` (a pointer to the working state; `release/*` tags mark states worth keeping).
2. `corepack pnpm exec tsx scripts/backup.ts --tier all --label before-<what>` (or `--tier user` for a small change).
3. `corepack pnpm exec tsx scripts/verify-system.ts > /tmp/before.txt`
4. Change on a branch; `corepack pnpm test`; `corepack pnpm --filter @aureus/web build`. A push to a branch other than `main` makes a Vercel *preview* (protected by a Vercel login); only `git push origin HEAD:main` changes the real site.
5. After the deployment: `verify-system.ts > /tmp/after.txt` and compare the two. Look at the real pages and at `scan_lease`/the clock heartbeat, not only at "green".
6. Database changes only ever *add* (new tables, nullable columns), so the previous code still runs against the new schema and a code rollback never needs a data rollback.

## Getting back

- **The code and the site** (a bad change, a broken deployment): `scripts/restore-baseline.sh restore/<tag>` makes a *new* commit on `main` whose files equal the tag, tags where `main` was (`pre-restore/...`, to go forward again) and pushes; Vercel deploys it (docs/RESTORE.md has the details, the older tags and the dashboard's own rollback). The tag of the state before the lock was added: `restore/2026-10-13-before-hardening`.
- **The lock** (shut out of the site): see docs/ACCESS.md. The code is in `.env.access.local`; `scripts/access-code.ts rotate` makes a new one.
- **A table or the whole hosted database**: `corepack pnpm exec tsx scripts/restore-hosted.ts --from ../backups/<folder>/hosted --target hosted --only my_trades --replace --yes` puts back one table (every row keeps its type; sequences are reset; every count is compared with the backup). A table that already has rows is left alone unless `--replace`. Practise first: `--target local:<name>` loads into an empty, migrated database on the laptop (`docker exec aureus_postgres psql -U aureus -d postgres -c "CREATE DATABASE <name>"`, then `DATABASE_URL=postgres://aureus:aureus@127.0.0.1:5432/<name> corepack pnpm db:migrate`). This was done on 2026-10-13: 100 tables and 64,229 rows came back with every count equal to the backup.
- **The laptop database**: `docker exec -i aureus_postgres pg_restore -U aureus -d <empty database> --no-owner < backups/<folder>/local-aureus.dump`.
- **The privileges of the hosted database** (the strangers' door, see below): `db/hosted/lockdown.sql` is safe to run again at any time.

## What can go wrong, and what to do

| you see | likely cause | do |
| --- | --- | --- |
| the site shows the login page and the code is refused | the code changed (a rotation) or it is typed wrong | read `.env.access.local`; if it is gone, `scripts/access-code.ts rotate` |
| every address answers "Not available" (503) | the lock's two variables are missing on the deployment | set `SITE_ACCESS_CODE` and `AUTH_SECRET` in Vercel (or `access-code.ts rotate`), redeploy. The clock still works meanwhile |
| pages are empty or 500 | the database connection (`DATABASE_URL` wrong or the password changed), Supabase paused or over its limit | `verify-system.ts`; Vercel logs; the Supabase dashboard; `scripts/limits-check.ts` |
| the Telegram alerts stopped | the clock's job, the bot token, or the site's exit check | the Telegram page shows "the site's check ran N min ago"; the watchdog messages by itself; `scripts/cron-setup.ts status`; docs/EXIT_ALERTS.md |
| Graduations is empty | the laptop's snapshot was unread and the chain feed has nothing, or the feed stopped | docs/GRADUATIONS_FEED.md; `scan_lease` row `grad-feed` |
| a deployment is broken | a bad commit | `scripts/restore-baseline.sh` to the last good tag |
| the laptop restarted | Docker and the worker are not running | `scripts/laptop-up.sh` (`--daemon` also starts the lab daemon) |
| the laptop's disk is full | 4 GB database, Docker images and caches | free space first, then `scripts/laptop-up.sh`; never delete the `aureus-intelligence_aureus_pgdata` volume |
| the GitHub repository is gone or locked | the account | clone from the laptop, or `git clone backups/<folder>/repo.bundle`; make a new private repository, push every branch and tag, re-link the Vercel project |
| the Vercel project is gone | the account | rebuild it (below); the site is stateless, everything is in the database |
| the Supabase project is gone (the free plan has no backups of its own) | the account, or a paused project that was deleted | rebuild it (below) and load the newest backup |
| the laptop is gone | | the site, the clock and the alerts do not need it. The research record is only in `local-aureus.dump` backups: that is why the folder must be copied off the laptop |

## Rebuilding from nothing, in order

1. **Code**: `git clone` the repository (or `git clone repo.bundle`), `corepack enable`, `corepack pnpm install`. `corepack pnpm test` (1,014 tests pass; two old suites cannot load, as before).
2. **Hosted database** (a new Supabase project, Free plan, region eu-west-2 to sit next to Vercel's London functions):
   1. In the dashboard make the project, note its reference, set a strong database password; put the *session pooler* connection string (port 5432, user `postgres.<ref>`, `?sslmode=no-verify`) in `.env.hosted.local` as `HOSTED_DATABASE_URL=`.
   2. Schema: `DATABASE_URL=<that string> corepack pnpm db:migrate` (38 migrations, creates tables, functions and the roles `aureus_app`, `aureus_outcome`, `aureus_readonly`).
   3. Close the doors, then give the site's role a real password: `corepack pnpm exec tsx scripts/hosted-sql.ts --write "$(cat db/hosted/lockdown.sql)"` (takes the strangers' privileges away and removes the placeholder logins of two roles), then `scripts/hosted-sql.ts --write "ALTER ROLE aureus_app WITH LOGIN PASSWORD '<long random>'"`. Never leave the migration's `change_me` passwords live.
   4. Data: `scripts/restore-hosted.ts --from ../backups/<newest>/hosted --target hosted --yes` (empty tables only; add `--only` to choose).
   5. Clock: `CRON_SECRET=<32+ plain characters> EXIT_ALERT_TOKEN=... EXIT_ALERT_CHAT_ID=... corepack pnpm exec tsx scripts/cron-setup.ts install` (installs pg_cron and pg_net, the vault entries and the six jobs; `SITE_URL=<address>` if the site's address changed).
3. **Site** (a new Vercel project): import the repository, Root Directory `apps/web` (the build command is in `apps/web/vercel.json`), Node 24.x. Environment variables (production): `DATABASE_URL` (the *transaction* pooler, port 6543, user `aureus_app.<ref>`, `?sslmode=no-verify`), `DEXSCREENER_BASE_URL`, `GECKOTERMINAL_BASE_URL`, `AUREUS_PUBLIC_URL`, `MAX_CANDIDATES_PER_CYCLE=30`, `RETENTION_DAYS=4`, `SCAN_STORAGE_LIMIT_MB=440`, `CRON_SECRET`, `EXIT_ALERT_TOKEN`, `EXIT_ALERT_CHAT_ID`. Link the folder (`vercel link`), then `scripts/access-code.ts rotate` sets the lock's two variables; deploy (`git push origin HEAD:main`).
4. **Check**: `scripts/access-code.ts check`, then `scripts/verify-system.ts`; wait one clock tick (2 minutes) and look for the exit check's heartbeat.
5. **Laptop**: Docker Desktop, `docker compose up -d postgres redis`, restore `local-aureus.dump` into the empty database, `scripts/laptop-up.sh`.

## What is protected, and what is not (2026-10-13)

- **Done**: every address of the site needs the access code (docs/ACCESS.md); the clock and my scripts use the service secret; the hosted database's REST data API is closed to its `anon` and `authenticated` roles (they could read, change and delete every table with the project's public key: `db/hosted/lockdown.sql`); the laptop's Postgres (password `aureus`) and Redis (no password) listen on 127.0.0.1 only, they were open to the whole Wi-Fi; the dev server, `next start` and PM2 do too; no real secret is in the repository's history (all 149 commits scanned: only the local development defaults); search engines are told to stay away; the site sends no referrer and cannot be framed.
- **Still the owner's to do**: the GitHub repository is public until it is switched to private (Settings, Danger Zone, Change visibility; `verify-system.ts` shows which it is); two-step verification on the accounts; a copy of the backups off the laptop; the access code in a password manager.
- **Known and accepted**: one shared access code, no accounts (docs/ACCESS.md says what that does and does not protect against); the history of the public repository stays public in copies someone may already hold (it holds code and docs, no secrets; the commit author's name and e-mail are in it); the Supabase project's own REST API still exists (with the privileges revoked it answers "permission denied"; it can be switched off in the dashboard: Project Settings, Data API); Supabase Free has no point-in-time recovery, so the scripts above are the backup; the laptop database has the password `aureus` (reachable from this laptop only).
