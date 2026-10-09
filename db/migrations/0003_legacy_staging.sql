-- 0003_legacy_staging.sql — controlled staging layer for the legacy spreadsheet.
-- Nothing from the spreadsheet touches canonical tables directly. Everything lands
-- here first, keeps its original row bytes in raw_import_payload, and is promoted
-- only on an explicit --commit. Unresolved stays unresolved; uncertain/empty
-- values are never promoted as confirmed.

BEGIN;

CREATE SCHEMA IF NOT EXISTS legacy;

CREATE TYPE legacy.import_status_t AS ENUM (
  'PENDING',      -- parsed, awaiting decision
  'IMPORTED',     -- promoted to canonical
  'SKIPPED',      -- empty/irrelevant/no identity
  'UNRESOLVED',   -- kept as unresolved by design
  'CONFLICTING'   -- disagrees with existing canonical data or another staged row
);

CREATE TYPE legacy.entity_kind_t AS ENUM (
  'wallet',
  'deployer_funding',
  'blacklist',
  'bundler',
  'candidate',
  'observation',
  'unresolved',
  'data_quality',
  'unknown'
);

CREATE TABLE legacy.import_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file    TEXT NOT NULL,
  file_sha256    TEXT NOT NULL,
  committed      BOOLEAN NOT NULL DEFAULT FALSE,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ,
  summary        JSONB
);

CREATE TABLE legacy.staged_rows (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id             UUID NOT NULL REFERENCES legacy.import_runs(id),
  sheet_name         TEXT NOT NULL,
  row_index          INT NOT NULL,               -- 1-based data row within the sheet
  entity_kind        legacy.entity_kind_t NOT NULL,
  -- address-first identity extracted from the row (labels are NOT identity)
  mint               TEXT,
  pool_address       TEXT,
  wallet_address     TEXT,
  -- preserved provenance from the legacy row
  discovery_at       TIMESTAMPTZ,                -- ORIGINAL discovery timestamp preserved
  source_ref         TEXT,                       -- original source reference preserved
  -- structured, mapped fields (typed conversion of free text where responsible)
  mapped             JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- the ORIGINAL row, verbatim, always retained alongside
  raw_import_payload JSONB NOT NULL,
  import_status      legacy.import_status_t NOT NULL DEFAULT 'PENDING',
  reasons            JSONB NOT NULL DEFAULT '[]'::jsonb,  -- why skipped/unresolved/conflicting
  promoted_ref       JSONB,                      -- {table, id} once promoted
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, sheet_name, row_index)
);
CREATE INDEX staged_rows_run_idx    ON legacy.staged_rows (run_id, entity_kind, import_status);
CREATE INDEX staged_rows_mint_idx   ON legacy.staged_rows (mint);
CREATE INDEX staged_rows_wallet_idx ON legacy.staged_rows (wallet_address);

COMMIT;
