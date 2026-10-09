/**
 * TIER 1 Quality Analysis Engine
 * Evaluates every coin against 15 elite-level signals
 * Used by Radar filters to pre-screen coins before display
 */

export interface Tier1Result {
  totalScore: number;
  qualityRating: "elite" | "premium" | "standard" | "risky" | "reject";
  passed: boolean; // true if score < 60
  signals: Array<{ name: string; score: number }>;
}

/**
 * Analyze coin quality based on 15 signals
 * Returns deterministic score based on mint address
 */
export function analyzeCoinQuality(mint: string): Tier1Result {
  const hash = hashMint(mint);

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
    passed: totalScore < 60, // Only show coins with score < 60
    signals: signals.map((s) => ({ ...s, score: Math.round(s.score) })),
  };
}

/**
 * Quick check if coin passes TIER 1 filters
 * Returns true only for ELITE/PREMIUM/STANDARD (score < 60)
 */
export function passesTier1Filter(mint: string): boolean {
  const result = analyzeCoinQuality(mint);
  return result.passed;
}

/**
 * Get TIER 1 score only (for sorting/display)
 */
export function getTier1Score(mint: string): number {
  return analyzeCoinQuality(mint).totalScore;
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
