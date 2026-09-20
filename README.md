# Aureus Intelligence

Private, read-only Solana early-coin intelligence platform. Ingests market,
on-chain, wallet, deployer, liquidity, and attention data and converts it into a
small number of **transparent, evidence-backed decision states**. No automated
trading; no ungrounded "BUY" calls.

**Status: Phase 0 — foundations, awaiting review.** No application code or UI has
been built yet. Start with the docs below.

## Read in this order

1. [`docs/PRODUCT_REQUIREMENTS.md`](docs/PRODUCT_REQUIREMENTS.md) — what and why.
2. [`docs/SOURCE_CAPABILITY_AUDIT.md`](docs/SOURCE_CAPABILITY_AUDIT.md) — what each
   data source actually provides (with corrections to common assumptions).
3. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the seven-layer design.
4. [`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md) + [`db/migrations/0001_init.sql`](db/migrations/0001_init.sql).
5. [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) — phased build + file tree.

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
