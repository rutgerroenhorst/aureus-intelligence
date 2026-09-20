-- Extend wallet_entities with provenance tracking
-- Enables tracking wallet source, role, and evidence for audit trail

ALTER TABLE wallet_entities
ADD COLUMN IF NOT EXISTS role TEXT,
ADD COLUMN IF NOT EXISTS source_type TEXT,
ADD COLUMN IF NOT EXISTS source_id TEXT,
ADD COLUMN IF NOT EXISTS source_token_mint TEXT,
ADD COLUMN IF NOT EXISTS observed_at TIMESTAMP WITH TIME ZONE;

-- Index for efficient wallet lookup
CREATE INDEX IF NOT EXISTS ix_wallet_entities_source
  ON wallet_entities(source_type, source_id)
  WHERE source_type IS NOT NULL;

-- Comments for documentation
COMMENT ON COLUMN wallet_entities.role IS 'Wallet semantic role: CREATOR, BUYER, SELLER, HOLDER, FEE_PAYER, INITIAL_SIGNER, etc.';
COMMENT ON COLUMN wallet_entities.source_type IS 'Source of discovery: enrichment, transaction, holder, etc.';
COMMENT ON COLUMN wallet_entities.source_id IS 'Source identifier (tx signature, block, etc.)';
COMMENT ON COLUMN wallet_entities.source_token_mint IS 'Token mint for context (which token discovery led to this wallet)';
COMMENT ON COLUMN wallet_entities.observed_at IS 'When wallet was first discovered';
