-- Coin Learning System: Track outcomes per tab for self-optimization
-- This enables per-tab, age-aware learning about what filters actually predict winners

-- Track when coins qualified for each tab
CREATE TABLE IF NOT EXISTS coin_qualifications (
  id BIGSERIAL PRIMARY KEY,
  mint VARCHAR(44) NOT NULL,
  symbol VARCHAR(100),

  -- Which tab qualified for
  tab_name VARCHAR(50) NOT NULL, -- 'quick_flip', 'stealth_moon', 'elite', 'early'

  -- Qualification metrics (snapshot at time of qualification)
  qualified_at TIMESTAMP NOT NULL DEFAULT now(),
  age_minutes_at_qualification INT NOT NULL,
  age_days_at_qualification DECIMAL(10, 2),

  -- Metrics at qualification time
  score_at_qualification DECIMAL(10, 2),
  buy_ratio_at_qualification DECIMAL(5, 2),
  holder_top10_at_qualification DECIMAL(5, 2),
  volume_velocity_at_qualification DECIMAL(10, 4),
  price_velocity_at_qualification DECIMAL(10, 4),
  mcap_usd_at_qualification DECIMAL(20, 2),
  liquidity_usd_at_qualification DECIMAL(20, 2),
  danger_score_at_qualification DECIMAL(5, 2),

  -- Outcome tracking
  current_price_usd DECIMAL(20, 8),
  peak_price_usd DECIMAL(20, 8),
  peak_mcap_usd DECIMAL(20, 2),

  -- Outcome labels
  outcome_status VARCHAR(50), -- 'pending', 'winner', 'loser', 'rugpull', 'dead'
  return_multiplier DECIMAL(10, 4), -- price_now / price_at_qualification
  peak_return_multiplier DECIMAL(10, 4), -- peak_price / price_at_qualification

  -- Timeline data
  last_updated_at TIMESTAMP DEFAULT now(),
  confirmed_winner_at TIMESTAMP, -- timestamp when it hit 3x+ or stayed strong
  failed_at TIMESTAMP, -- timestamp when it rugpulled or died

  UNIQUE(mint, tab_name, qualified_at)
);

CREATE INDEX idx_coin_qualifications_tab_age ON coin_qualifications(tab_name, age_days_at_qualification);
CREATE INDEX idx_coin_qualifications_outcome ON coin_qualifications(tab_name, outcome_status);
CREATE INDEX idx_coin_qualifications_mint ON coin_qualifications(mint);

-- Per-tab filter suggestions based on learning
CREATE TABLE IF NOT EXISTS filter_suggestions (
  id BIGSERIAL PRIMARY KEY,

  tab_name VARCHAR(50) NOT NULL,

  -- Age bucket this suggestion applies to (e.g., "0-1 days", "3-8 days")
  age_bucket_min DECIMAL(10, 2),
  age_bucket_max DECIMAL(10, 2),

  -- The suggestion
  metric_name VARCHAR(100), -- 'buy_ratio', 'holder_top10', 'danger_score', etc
  current_threshold DECIMAL(10, 4),
  suggested_threshold DECIMAL(10, 4),
  suggested_direction VARCHAR(20), -- 'increase', 'decrease', 'new'

  -- Confidence in this suggestion
  confidence_score DECIMAL(5, 2), -- 0-100
  win_rate_with_suggestion DECIMAL(5, 2),
  win_rate_without_suggestion DECIMAL(5, 2),
  sample_size INT,

  -- Timing
  created_at TIMESTAMP DEFAULT now(),
  last_updated_at TIMESTAMP DEFAULT now(),
  status VARCHAR(50), -- 'pending_review', 'applied', 'rejected', 'testing'

  UNIQUE(tab_name, age_bucket_min, age_bucket_max, metric_name, suggested_threshold)
);

CREATE INDEX idx_filter_suggestions_tab_age ON filter_suggestions(tab_name, age_bucket_min, age_bucket_max);
CREATE INDEX idx_filter_suggestions_status ON filter_suggestions(tab_name, status);

-- Learning progress tracking
CREATE TABLE IF NOT EXISTS learning_progress (
  id BIGSERIAL PRIMARY KEY,

  tab_name VARCHAR(50) NOT NULL,
  age_bucket_min DECIMAL(10, 2),
  age_bucket_max DECIMAL(10, 2),

  -- Stats
  total_coins_qualified INT DEFAULT 0,
  winners INT DEFAULT 0, -- coins that hit 2x+
  mega_winners INT DEFAULT 0, -- coins that hit 5x+
  rugpulls INT DEFAULT 0,
  dead_coins INT DEFAULT 0,
  still_pending INT DEFAULT 0,

  current_win_rate DECIMAL(5, 2), -- winners / (winners + losers)
  avg_return_multiple DECIMAL(10, 4),

  -- Learning state
  last_analysis_at TIMESTAMP,
  learning_active BOOLEAN DEFAULT true,

  created_at TIMESTAMP DEFAULT now(),
  last_updated_at TIMESTAMP DEFAULT now(),

  UNIQUE(tab_name, age_bucket_min, age_bucket_max)
);

CREATE INDEX idx_learning_progress_tab_age ON learning_progress(tab_name, age_bucket_min, age_bucket_max);

-- A/B testing framework for filter changes
CREATE TABLE IF NOT EXISTS ab_tests (
  id BIGSERIAL PRIMARY KEY,

  tab_name VARCHAR(50) NOT NULL,

  -- Test setup
  test_name VARCHAR(200),
  description TEXT,

  -- Control vs treatment
  control_filters JSONB, -- original filter config
  treatment_filters JSONB, -- new filter config

  -- Metrics
  control_coins INT DEFAULT 0,
  control_winners INT DEFAULT 0,
  treatment_coins INT DEFAULT 0,
  treatment_winners INT DEFAULT 0,

  -- Stats
  control_win_rate DECIMAL(5, 2),
  treatment_win_rate DECIMAL(5, 2),
  improvement_percentage DECIMAL(10, 2),

  -- Status
  status VARCHAR(50), -- 'running', 'completed', 'rolled_back'
  started_at TIMESTAMP DEFAULT now(),
  ended_at TIMESTAMP,

  UNIQUE(tab_name, test_name)
);

-- Backup: track what filters were active when coins were qualified
CREATE TABLE IF NOT EXISTS active_filters_snapshot (
  id BIGSERIAL PRIMARY KEY,

  tab_name VARCHAR(50) NOT NULL,

  filters_config JSONB, -- Full filter config at this point in time

  snapshot_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_active_filters_snapshot_tab_time ON active_filters_snapshot(tab_name, snapshot_at DESC);
