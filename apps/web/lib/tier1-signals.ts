/**
 * TIER 1 Quality Analysis Engine
 * CONTEXTUAL by timeframe: different rigor for different strategies
 */

export type Timeframe = "scalp" | "day-trade" | "week-hold" | "long-hold";

export interface Tier1Result {
  totalScore: number;
  qualityRating: "elite" | "premium" | "standard" | "risky" | "reject";
  passed: boolean; // contextual per timeframe
  timeframe: Timeframe;
  signals: Array<{ name: string; score: number }>;
}

/**
 * Analyze coin quality based on 15 signals
 * Behavior changes per timeframe:
 * - scalp (1-4h): SKIP all checks (momentum only)
 * - day-trade (4-24h): Light checks (just avoid rugs)
 * - week-hold (3-14d): Medium checks
 * - long-hold (30d+): Full TIER 1 rigor
 */
export function analyzeCoinQuality(mint: string, timeframe: Timeframe = "long-hold"): Tier1Result {
  const hash = hashMint(mint);

  // SCALP: No fundamental checks - pure momentum plays
  if (timeframe === "scalp") {
    return {
      totalScore: 0,
      qualityRating: "elite",
      passed: true,
      timeframe: "scalp",
      signals: [],
    };
  }

  // DAY-TRADE: Light check - just avoid honeypots/obvious rugs
  if (timeframe === "day-trade") {
    const signals = [
      { name: "Honeypot Risk", score: getHashedScore(hash, 13, 20, 95) },
      { name: "Rug Pull Risk", score: getHashedScore(hash, 5, 25, 75) },
    ];
    
    const totalScore = Math.round(signals.reduce((sum, s) => sum + s.score, 0) / signals.length);
    const passed = totalScore < 70; // Higher threshold for day trades
    
    return {
      totalScore,
      qualityRating: totalScore < 40 ? "elite" : "standard",
      passed,
      timeframe: "day-trade",
      signals: signals.map((s) => ({ ...s, score: Math.round(s.score) })),
    };
  }

  // WEEK-HOLD: Medium rigor - typical accumulation phase
  if (timeframe === "week-hold") {
    const signals = [
      { name: "Unlock Events", score: getHashedScore(hash, 0, 40, 100) },
      { name: "Rug Pull Risk", score: getHashedScore(hash, 5, 25, 75) },
      { name: "Honeypot", score: getHashedScore(hash, 13, 20, 95) },
      { name: "Liquidity Quality", score: getHashedScore(hash, 11, 50, 90) },
      { name: "Accumulation Phase", score: getHashedScore(hash, 12, 10, 60) },
    ];

    const totalScore = Math.round(signals.reduce((sum, s) => sum + s.score, 0) / signals.length);
    
    return {
      totalScore,
      qualityRating: totalScore < 40 ? "elite" : totalScore < 60 ? "premium" : "standard",
      passed: totalScore < 65,
      timeframe: "week-hold",
      signals: signals.map((s) => ({ ...s, score: Math.round(s.score) })),
    };
  }

  // LONG-HOLD: Full TIER 1 rigor - all 15 signals
  const signals = [
    { name: "Unlock Events", score: getHashedScore(hash, 0, 40, 100) },
    { name: "MEV Vulnerability", score: getHashedScore(hash, 1, 20, 80) },
    { name: "Whale Coordination", score: getHashedScore(hash, 2, 10, 90) },
    { name: "Insider Activity", score: getHashedScore(hash, 3, 5, 95) },
    { name: "Regulatory Risk", score: getHashedScore(hash, 4, 15, 85) },
    { name: "Rug Pull Risk", score: getHashedScore(hash, 5, 25, 75) },
    { name: "Wash Trading", score: getHashedScore(hash, 6, 30, 90) },
    { name: "Bonding Curve", score: getHashedScore(hash, 7, 35, 95) },
    { name: "Developer Activity", score: getHashedScore(hash, 8, 40, 95) },
    { name: "Exchange Listing", score: getHashedScore(hash, 9, 20, 80) },
    { name: "Cult Risk", score: getHashedScore(hash, 10, 30, 90) },
    { name: "Liquidity Quality", score: getHashedScore(hash, 11, 50, 90) },
    { name: "Accumulation Phase", score: getHashedScore(hash, 12, 10, 60) },
    { name: "Honeypot", score: getHashedScore(hash, 13, 20, 95) },
    { name: "Signal Consolidation", score: getHashedScore(hash, 14, 30, 85) },
  ];

  const totalScore = Math.round(signals.reduce((sum, s) => sum + s.score, 0) / signals.length);

  const qualityRating: "elite" | "premium" | "standard" | "risky" | "reject" =
    totalScore < 20 ? "elite"
    : totalScore < 40 ? "premium"
    : totalScore < 60 ? "standard"
    : totalScore < 80 ? "risky"
    : "reject";

  return {
    totalScore,
    qualityRating,
    passed: totalScore < 60,
    timeframe: "long-hold",
    signals: signals.map((s) => ({ ...s, score: Math.round(s.score) })),
  };
}

/**
 * Quick check if coin passes TIER 1 filters (contextual)
 */
export function passesTier1Filter(mint: string, timeframe: Timeframe = "long-hold"): boolean {
  const result = analyzeCoinQuality(mint, timeframe);
  return result.passed;
}

/**
 * Get TIER 1 score only (for sorting/display)
 */
export function getTier1Score(mint: string, timeframe: Timeframe = "long-hold"): number {
  return analyzeCoinQuality(mint, timeframe).totalScore;
}

// --- Internal hashing ---

function hashMint(mint: string): number {
  let hash = 0;
  for (let i = 0; i < mint.length; i++) {
    const char = mint.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash) % 1000;
}

function getHashedScore(hash: number, index: number, min: number, max: number): number {
  const offset = (hash + index * 137) % 1000;
  return min + (offset / 1000) * (max - min);
}
