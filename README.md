# Auriga

*(formerly Aureus Intelligence. The name, mark and colours are described in [`docs/BRAND.md`](docs/BRAND.md); package names, the database and the environment variables keep the old name.)*

Private, read-only Solana early-coin intelligence platform. Ingests market,
on-chain, wallet, deployer, liquidity, and attention data and converts it into a
small number of **transparent, evidence-backed decision states**. No automated
trading; no ungrounded "BUY" calls.

**Status (2026-10-13): built and live.** The site runs on Vercel, the database and the clock (pg_cron) on Supabase, with a laptop worker as an optional extra;
every address of the site needs an access code ([`docs/ACCESS.md`](docs/ACCESS.md)). The Radar, the Check, the Learning Lab, the Telegram exit alerts, the journal and the
Kennis tab are all in use.

## Start here

1. [`docs/README.md`](docs/README.md): the index of every document, in reading order.
2. [`docs/DISASTER_RECOVERY.md`](docs/DISASTER_RECOVERY.md): how it is put together, where everything lives, backups, rollback, rebuilding.
3. [`docs/ACCESS.md`](docs/ACCESS.md): the lock on the site.
4. `corepack pnpm exec tsx scripts/verify-system.ts`: is everything as it should be (read-only).

The original design documents, still the model for the engines:

1. [`docs/PRODUCT_REQUIREMENTS.md`](docs/PRODUCT_REQUIREMENTS.md): what and why.
2. [`docs/SOURCE_CAPABILITY_AUDIT.md`](docs/SOURCE_CAPABILITY_AUDIT.md): what each data source actually provides (with corrections to common assumptions).
3. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): the seven-layer design.
4. [`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md) + [`db/migrations/0001_init.sql`](db/migrations/0001_init.sql).
5. [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md): phased build + file tree.

## Non-negotiables

- Address-first identity `(chain, mint, pool, candidate_id, discovered_at)` — never
  name/ticker.
- Deterministic engines decide states; the LLM only summarises existing evidence.
- The four questions (Safety / Demand / Capital / Entry) are separated; a strong
  token at a bad price is never `ENTRY_READY`.
- Every datum carries source, timestamps, evidence status, and a raw reference;
  the discovery snapshot is immutable.
- No profit guarantees; no probability/confidence labels until statistically
  validated.
