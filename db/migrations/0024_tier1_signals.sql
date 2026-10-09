-- TIER 1 SIGNALS: 15 New Analysis Dimensions
-- Purpose: Add 90%+ confidence signals discovered in crypto research

CREATE TABLE IF NOT EXISTS unlock_events (
  id BIGSERIAL PRIMARY KEY,
  mint TEXT NOT NULL UNIQUE,
  unlock_date TIMESTAMP NOT NULL,
  supply_unlocking DECIMAL(10, 2),
  severity_score INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_unlock_events_date ON unlock_events(unlock_date);

CREATE TABLE IF NOT EXISTS mev_analysis (
  id BIGSERIAL PRIMARY KEY,
  mint TEXT NOT NULL UNIQUE,
  slippage_pct_1 DECIMAL(8, 4),
  mev_vulnerability_score INT DEFAULT 0,
  sandwich_pattern_detected BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whale_coordination_clusters (
  id BIGSERIAL PRIMARY KEY,
  mint TEXT NOT NULL,
  coordination_score INT,
  wallet_count INT,
  risk_level TEXT
);

CREATE TABLE IF NOT EXISTS insider_activity (
  id BIGSERIAL PRIMARY KEY,
  mint TEXT NOT NULL,
  team_wallet_address TEXT,
  accumulation_detected BOOLEAN DEFAULT FALSE,
  risk_score INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS regulatory_risks (
  id BIGSERIAL PRIMARY KEY,
  mint TEXT NOT NULL,
  sec_action BOOLEAN DEFAULT FALSE,
  risk_severity TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rug_pull_assessment (
  id BIGSERIAL PRIMARY KEY,
  mint TEXT NOT NULL UNIQUE,
  risk_score INT DEFAULT 0,
  risk_level TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wash_trading_analysis (
  id BIGSERIAL PRIMARY KEY,
  mint TEXT NOT NULL UNIQUE,
  round_trip_percentage DECIMAL(8, 2),
  confidence_score INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bonding_curve_metrics (
  id BIGSERIAL PRIMARY KEY,
  mint TEXT NOT NULL,
  price_1min DECIMAL(20, 8),
  price_3min DECIMAL(20, 8),
  acceleration_ratio DECIMAL(8, 4),
  quality_score INT DEFAULT 0,
  measured_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS developer_activity (
  id BIGSERIAL PRIMARY KEY,
  mint TEXT NOT NULL UNIQUE,
  active_contributors INT,
  commits_last_30d INT,
  trend TEXT,
  leading_indicator_score INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exchange_listings (
  id BIGSERIAL PRIMARY KEY,
  mint TEXT NOT NULL,
  exchange_name TEXT,
  listing_date TIMESTAMP,
  risk_score INT DEFAULT 40,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cult_risk_analysis (
  id BIGSERIAL PRIMARY KEY,
  mint TEXT NOT NULL UNIQUE,
  cult_score INT DEFAULT 0,
  risk_level TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS liquidity_pool_quality (
  id BIGSERIAL PRIMARY KEY,
  mint TEXT NOT NULL UNIQUE,
  depth_ratio DECIMAL(8, 4),
  pool_health_score INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accumulation_phases (
  id BIGSERIAL PRIMARY KEY,
  mint TEXT NOT NULL,
  setup_phase_score INT DEFAULT 0,
  early_warning_activated BOOLEAN DEFAULT FALSE,
  measured_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS honeypot_analysis (
  id BIGSERIAL PRIMARY KEY,
  mint TEXT NOT NULL UNIQUE,
  honeypot_detected BOOLEAN DEFAULT FALSE,
  buy_test_successful BOOLEAN DEFAULT FALSE,
  sell_test_successful BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tier1_signal_summary (
  id BIGSERIAL PRIMARY KEY,
  mint TEXT NOT NULL UNIQUE,
  symbol TEXT,
  total_tier1_score INT DEFAULT 0,
  quality_rating TEXT CHECK (quality_rating IN ('elite', 'premium', 'standard', 'risky', 'reject')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_tier1_summary_mint ON tier1_signal_summary(mint);
CREATE INDEX idx_tier1_summary_rating ON tier1_signal_summary(quality_rating);
