-- ELITE SYSTEM UPGRADES
-- Whale tracking, contract forensics, risk scoring, temporal analysis

-- ============================================================================
-- PART 1: WHALE TRACKING REGISTRY
-- ============================================================================

CREATE TABLE IF NOT EXISTS whale_wallets (
  id BIGSERIAL PRIMARY KEY,
  wallet_address VARCHAR(44) NOT NULL UNIQUE,
  
  label VARCHAR(200),
  discovered_at TIMESTAMP DEFAULT now(),
  
  total_transactions INT DEFAULT 0,
  winning_transactions INT DEFAULT 0,
  losing_transactions INT DEFAULT 0,
  
  average_roi DECIMAL(10, 4),
  max_win_multiple DECIMAL(10, 4),
  max_loss_multiple DECIMAL(10, 4),
  win_rate DECIMAL(5, 2),
  
  typical_position_size_usd DECIMAL(20, 2),
  typical_hold_time_hours INT,
  
  last_buy_at TIMESTAMP,
  last_buy_coin VARCHAR(44),
  current_holding_count INT,
  
  is_proven_winner BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  
  last_updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_whale_wallets_proven ON whale_wallets(is_proven_winner);
CREATE INDEX idx_whale_wallets_win_rate ON whale_wallets(win_rate DESC);

CREATE TABLE IF NOT EXISTS whale_positions (
  id BIGSERIAL PRIMARY KEY,
  whale_wallet_id BIGINT REFERENCES whale_wallets(id),
  
  mint VARCHAR(44) NOT NULL,
  symbol VARCHAR(100),
  
  entry_price_usd DECIMAL(20, 8),
  entry_time TIMESTAMP NOT NULL,
  position_size_usd DECIMAL(20, 2),
  
  current_price_usd DECIMAL(20, 8),
  current_value_usd DECIMAL(20, 2),
  
  exit_price_usd DECIMAL(20, 8),
  exit_time TIMESTAMP,
  exit_reason VARCHAR(100),
  
  roi_multiple DECIMAL(10, 4),
  outcome VARCHAR(50),
  
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_whale_positions_outcome ON whale_positions(outcome);
CREATE INDEX idx_whale_positions_mint ON whale_positions(mint);

-- ============================================================================
-- PART 2: CONTRACT FORENSICS
-- ============================================================================

CREATE TABLE IF NOT EXISTS contract_forensics (
  id BIGSERIAL PRIMARY KEY,
  mint VARCHAR(44) NOT NULL UNIQUE,
  symbol VARCHAR(100),
  
  contract_address VARCHAR(44),
  contract_age_hours INT,
  contract_deployed_at TIMESTAMP,
  
  developer_wallet VARCHAR(44),
  dev_previous_projects INT,
  dev_rug_count INT,
  dev_is_known BOOLEAN,
  
  mint_authority_active BOOLEAN,
  freeze_authority_active BOOLEAN,
  
  buy_tax_percent DECIMAL(5, 2),
  sell_tax_percent DECIMAL(5, 2),
  is_honeypot BOOLEAN,
  honeypot_detection_method VARCHAR(200),
  
  lp_locked BOOLEAN,
  lp_lock_expiration TIMESTAMP,
  lp_burn_detected BOOLEAN,
  
  token_supply INT,
  supply_capped BOOLEAN,
  mint_limit INT,
  
  contract_paused BOOLEAN,
  emergency_withdraw_exists BOOLEAN,
  
  legitimacy_score DECIMAL(5, 2),
  risk_level VARCHAR(50),
  risk_factors TEXT[],
  
  security_risk_score DECIMAL(5, 2),
  developer_risk_score DECIMAL(5, 2),
  mechanics_risk_score DECIMAL(5, 2),
  
  analyzed_at TIMESTAMP DEFAULT now(),
  last_updated_at TIMESTAMP DEFAULT now(),
  
  analysis_confidence DECIMAL(5, 2)
);

CREATE INDEX idx_contract_forensics_legitimacy ON contract_forensics(legitimacy_score DESC);
CREATE INDEX idx_contract_forensics_risk ON contract_forensics(risk_level);
CREATE INDEX idx_contract_forensics_honeypot ON contract_forensics(is_honeypot);

-- ============================================================================
-- PART 3: RISK SCORING
-- ============================================================================

CREATE TABLE IF NOT EXISTS coin_risk_analysis (
  id BIGSERIAL PRIMARY KEY,
  mint VARCHAR(44) NOT NULL,
  
  security_risk DECIMAL(5, 2),
  market_risk DECIMAL(5, 2),
  fundamental_risk DECIMAL(5, 2),
  social_risk DECIMAL(5, 2),
  timing_risk DECIMAL(5, 2),
  
  overall_risk_score DECIMAL(5, 2),
  risk_rating VARCHAR(50),
  
  tradeable BOOLEAN,
  max_position_size_percent DECIMAL(5, 2),
  
  critical_risk_factors TEXT[],
  manageable_risks TEXT[],
  
  analyzed_at TIMESTAMP DEFAULT now(),
  last_updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_coin_risk_analysis_score ON coin_risk_analysis(overall_risk_score);
CREATE INDEX idx_coin_risk_analysis_tradeable ON coin_risk_analysis(tradeable);

-- ============================================================================
-- PART 4: TEMPORAL CURVE ANALYSIS
-- ============================================================================

CREATE TABLE IF NOT EXISTS metric_timeseries (
  id BIGSERIAL PRIMARY KEY,
  mint VARCHAR(44) NOT NULL,
  
  measured_at TIMESTAMP NOT NULL,
  
  price_usd DECIMAL(20, 8),
  buy_ratio DECIMAL(5, 2),
  holder_count INT,
  holder_top10_pct DECIMAL(5, 2),
  volume_velocity DECIMAL(10, 4),
  price_velocity DECIMAL(10, 4),
  mcap_usd DECIMAL(20, 2),
  liquidity_usd DECIMAL(20, 2),
  
  buy_ratio_velocity DECIMAL(8, 6),
  holder_count_velocity DECIMAL(10, 4),
  price_velocity_velocity DECIMAL(10, 6),
  
  curve_position VARCHAR(50),
  
  is_anomalous BOOLEAN,
  anomaly_type VARCHAR(50),
  anomaly_score DECIMAL(5, 2),
  
  UNIQUE(mint, measured_at)
);

CREATE INDEX idx_metric_timeseries_mint_time ON metric_timeseries(mint, measured_at DESC);
CREATE INDEX idx_metric_timeseries_curve ON metric_timeseries(mint, curve_position);
CREATE INDEX idx_metric_timeseries_anomaly ON metric_timeseries(is_anomalous, anomaly_type);

-- ============================================================================
-- PART 5: EARLY WARNING SIGNALS
-- ============================================================================

CREATE TABLE IF NOT EXISTS early_warning_signals (
  id BIGSERIAL PRIMARY KEY,
  mint VARCHAR(44) NOT NULL,
  symbol VARCHAR(100),
  
  signal_type VARCHAR(100),
  confidence DECIMAL(5, 2),
  
  pump_probability_2h DECIMAL(5, 2),
  pump_probability_24h DECIMAL(5, 2),
  predicted_outcome VARCHAR(100),
  
  estimated_time_to_event_hours DECIMAL(10, 2),
  
  signal_details JSONB,
  
  is_active BOOLEAN DEFAULT true,
  triggered_at TIMESTAMP,
  actual_outcome VARCHAR(100),
  prediction_accuracy BOOLEAN,
  
  detected_at TIMESTAMP DEFAULT now(),
  expires_at TIMESTAMP,
  
  last_updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_early_warning_active ON early_warning_signals(is_active, pump_probability_2h DESC);
CREATE INDEX idx_early_warning_accuracy ON early_warning_signals(prediction_accuracy);

-- ============================================================================
-- PART 6: MULTI-SIGNAL CONSENSUS
-- ============================================================================

CREATE TABLE IF NOT EXISTS signal_consensus (
  id BIGSERIAL PRIMARY KEY,
  mint VARCHAR(44) NOT NULL,
  
  on_chain_signal VARCHAR(50),
  on_chain_confidence DECIMAL(5, 2),
  
  community_signal VARCHAR(50),
  community_confidence DECIMAL(5, 2),
  
  technical_signal VARCHAR(50),
  technical_confidence DECIMAL(5, 2),
  
  whale_signal VARCHAR(50),
  whale_confidence DECIMAL(5, 2),
  
  structural_signal VARCHAR(50),
  structural_confidence DECIMAL(5, 2),
  
  signals_in_agreement INT,
  consensus_verdict VARCHAR(50),
  consensus_confidence DECIMAL(5, 2),
  
  recommendation VARCHAR(50),
  
  alignment_note TEXT,
  
  analyzed_at TIMESTAMP DEFAULT now(),
  last_updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_signal_consensus_verdict ON signal_consensus(consensus_verdict);
CREATE INDEX idx_signal_consensus_recommendation ON signal_consensus(recommendation);

-- ============================================================================
-- PART 7: AUTONOMOUS MONITORING
-- ============================================================================

CREATE TABLE IF NOT EXISTS autonomous_analysis_jobs (
  id BIGSERIAL PRIMARY KEY,
  
  job_type VARCHAR(100),
  
  last_run_at TIMESTAMP,
  next_scheduled_run TIMESTAMP,
  
  coins_analyzed INT,
  signals_found INT,
  alerts_generated INT,
  
  status VARCHAR(50),
  error_message TEXT,
  
  execution_time_seconds INT,
  
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_autonomous_jobs_next_run ON autonomous_analysis_jobs(next_scheduled_run);
CREATE INDEX idx_autonomous_jobs_status ON autonomous_analysis_jobs(status);

-- ============================================================================
-- PART 8: PREDICTION HISTORY & ACCURACY
-- ============================================================================

CREATE TABLE IF NOT EXISTS signal_prediction_history (
  id BIGSERIAL PRIMARY KEY,
  
  mint VARCHAR(44) NOT NULL,
  symbol VARCHAR(100),
  
  predicted_at TIMESTAMP,
  prediction_type VARCHAR(100),
  predicted_outcome VARCHAR(100),
  confidence DECIMAL(5, 2),
  
  actual_outcome VARCHAR(100),
  outcome_time TIMESTAMP,
  outcome_return_multiple DECIMAL(10, 4),
  
  was_correct BOOLEAN,
  accuracy_margin_percent DECIMAL(10, 2),
  
  error_analysis TEXT,
  
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_prediction_history_accuracy ON signal_prediction_history(was_correct);
CREATE INDEX idx_prediction_history_type ON signal_prediction_history(prediction_type, was_correct);
