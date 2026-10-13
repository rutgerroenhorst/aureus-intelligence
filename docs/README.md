# The documents: where to find what

The system is a private Solana early-coin radar (brand: Auriga; the packages, the database and the environment variables keep the old name Aureus). It runs on Vercel (the site) and
Supabase (the database and the clock), with the laptop as an optional extra. **If you are Claude in a new session, read these first, in this order**: this index, `DISASTER_RECOVERY.md`,
`ACCESS.md`, `OPERATIONS.md`/`LIMITS.md`, then the file of the part you will touch. The private inventory of accounts and addresses is `../.private/INFRASTRUCTURE.md` (not in git).

## Safety, recovery and running it

| file | what it holds |
| --- | --- |
| [`DISASTER_RECOVERY.md`](DISASTER_RECOVERY.md) | the whole system on one page, where everything lives, the secrets (names and places), backups, rollback, what can go wrong, rebuilding from nothing, what is protected |
| [`ACCESS.md`](ACCESS.md) | the lock on the site: the access code, the cookie, the service secret, rotating, limits |
| [`RESTORE.md`](RESTORE.md) | going back to a tagged state of the code (`scripts/restore-baseline.sh`), the migrations since each restore point, the database clock |
| [`LIMITS.md`](LIMITS.md) | the free-plan limits, what is measured against them, what to do when a warning shows |
| [`OPERATIONS.md`](OPERATIONS.md) | running the worker and the web app on the laptop (PM2 or Docker Compose); older, the hosted side is in the files below |
| [`EXIT_ALERTS.md`](EXIT_ALERTS.md), [`TELEGRAM_SETUP.md`](TELEGRAM_SETUP.md) | the Telegram exit alerts (rebuilt 2026-10-13: first profit at 2x, quiet steps 3-100x, the line = the site's stop, the loss message, buttons incl. Open in FOMO), the bot, pairing, rotating the token |
| [`GRADUATIONS_FEED.md`](GRADUATIONS_FEED.md) | the Graduations tab without the laptop: the chain feed, the source priority |
| [`CLOUD_SCAN_AND_LEARNING.md`](CLOUD_SCAN_AND_LEARNING.md) | how the hosted site scans and learns by itself, the leases, the budgets |
| [`DATA_SOURCES.md`](DATA_SOURCES.md) | every free data source: what was tested, what is used, the traps |

## What the system does

| file | what it holds |
| --- | --- |
| [`COIN_CHECK.md`](COIN_CHECK.md) | the Check button and the paste-a-coin box: every line, its thresholds, how the answer is graded later |
| [`LEARNING_LAB.md`](LEARNING_LAB.md) | the lab that follows every coin for three days and grades the rules and the tabs |
| [`EXIT_STRATEGY.md`](EXIT_STRATEGY.md) | what the data says about exits (1,123 coins): half out plus a trailing stop (with an update of 2026-10-13) |
| [`ALERT_REDESIGN.md`](ALERT_REDESIGN.md) | research and proposal for the Telegram messages: which levels to alert at (and why not every x), what to suggest, how they should look and be shared, what the FOMO app can and cannot do (no stops) and what an order costs there; not built yet |
| [`EXIT_PRACTICE.md`](EXIT_PRACTICE.md) | the exit and entry rules used in practice for pump.fun / PumpSwap memecoins (guides, a vendor, two papers), graded and tested on the lab's coins: none beats the current advice; the entry moment matters as much; includes the correction of the "decided window" bias |
| [`HOT_NETWORKS.md`](HOT_NETWORKS.md) | the ranking of networks at the top of the Radar and the Hot tab |
| [`WALLET.md`](WALLET.md), [`WALLET_REVIEW.md`](WALLET_REVIEW.md), [`WALLET_REVIEW_2.md`](WALLET_REVIEW_2.md) | the followed wallet: the decoder, the journal merge, what it showed (second review: 200 coins since August, 78% never sold, the 88 payments the review cannot see) |
| [`GRADUATION_AUDIT.md`](GRADUATION_AUDIT.md) | why $VEIL never showed (DexScreener's batch endpoint hands back a dead bonding-curve pair), the fix, and whether the Graduations tab's default view hides the coins that run |
| [`KENNIS.md`](KENNIS.md) | the Kennis tab: the written knowledge base, how it searches, how to add to it |
| [`BRAND.md`](BRAND.md) | the Auriga name, mark, colours, icons |
| [`TAIL_RESEARCH.md`](TAIL_RESEARCH.md), [`RESEARCH_CHECKS.md`](RESEARCH_CHECKS.md), [`RESEARCH_COIN_STUDY.md`](RESEARCH_COIN_STUDY.md) | research: why the big winners are missed, outside claims that were checked, an outcome study |

## The original design (Phase 0 and the first build; still the model for the engines)

| file | what it holds |
| --- | --- |
| [`PRODUCT_REQUIREMENTS.md`](PRODUCT_REQUIREMENTS.md), [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md), [`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md) | what and why, the phased plan, what the first slice did not do |
| [`ARCHITECTURE.md`](ARCHITECTURE.md), [`CANONICAL_ARCHITECTURE.md`](CANONICAL_ARCHITECTURE.md) | the layered design and the decision architecture |
| [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md) | the schema (the migrations in `../db/migrations` are the truth) |
| [`RULE_CATALOG.md`](RULE_CATALOG.md), [`FEATURE_CATALOG.md`](FEATURE_CATALOG.md), [`TRANSITION_MATRIX.md`](TRANSITION_MATRIX.md), [`ALERT_POLICY_CATALOG.md`](ALERT_POLICY_CATALOG.md) | the rules, features, state transitions and alert policies of the engines |
| [`SNAPSHOT_AND_OUTCOME_SPEC.md`](SNAPSHOT_AND_OUTCOME_SPEC.md), [`ENRICHMENT.md`](ENRICHMENT.md), [`SOURCE_CAPABILITY_AUDIT.md`](SOURCE_CAPABILITY_AUDIT.md) | immutable snapshots and outcomes, on-chain enrichment, what each source really gives |
| [`RESEARCH_LAB.md`](RESEARCH_LAB.md), [`VALIDATION_CHECKLIST.md`](VALIDATION_CHECKLIST.md), [`VALIDATION_REPORT.md`](VALIDATION_REPORT.md), [`LOCAL_DEMO.md`](LOCAL_DEMO.md) | the validation lab and the first local runs |

## The scripts that matter (all in `../scripts/`, run with `corepack pnpm exec tsx scripts/<name>.ts`)

`verify-system` (is everything as it should be), `backup` and `restore-hosted` (data), `restore-baseline.sh` (code), `access-code` (the lock), `hosted-sql` (ask the hosted database a question),
`cron-setup` (the clock), `laptop-up.sh` (start the laptop side), `limits-check` (the free-plan numbers), `check-calibration` (the Check's verdicts over the live Radar).
