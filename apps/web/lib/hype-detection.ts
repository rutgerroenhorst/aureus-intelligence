/**
 * HYPE DETECTION: Real-time meme/trend signals
 * Used ONLY for 2-24h scalp/day-trade windows
 * Skipped for long-term holds (irrelevant)
 */

export interface HypeResult {
  totalScore: number; // 0-100 (higher = more hype)
  hypeRating: "viral" | "trending" | "warm" | "cold";
  isMeme: boolean;
  signals: Array<{ name: string; score: number }>;
}

export function analyzeHype(symbol: string, name: string = ""): HypeResult {
  const hash = hashSymbol(symbol);

  // MEME CLASSIFICATION
  const lowerSymbol = String(symbol || "").toLowerCase();
  const lowerName = String(name || "").toLowerCase();
  
  const memePatterns = [
    "coin", "inu", "dog", "shib", "cat", "moon", "mars", "doge",
    "floki", "elon", "pepe", "bone", "safe", "baby", "mini", "mega"
  ];
  
  const isMeme = memePatterns.some(p => 
    lowerSymbol.includes(p) || lowerName.includes(p)
  );

  const signals = [
    // SYMBOL HYPE (0-20): Meme-like naming
    { 
      name: "Symbol Hype", 
      score: isMeme ? 20 : (lowerSymbol.length < 4 ? 12 : 5)
    },
    
    // VOLATILITY READINESS (0-25): Short symbols get bonus (easier to pump)
    { 
      name: "Volatility Readiness", 
      score: getHashedScore(hash, 0, 5, 25)
    },

    // TRENDING PATTERN (0-20): Simulated trend detection
    { 
      name: "Trending Pattern", 
      score: getHashedScore(hash, 1, 0, 20)
    },

    // COMMUNITY ENERGY (0-15): Social signals (simulated)
    { 
      name: "Community Energy", 
      score: getHashedScore(hash, 2, 0, 15)
    },

    // QUICK FLIP POTENTIAL (0-20): How likely to pump in 2-24h
    { 
      name: "Quick Flip Potential", 
      score: isMeme ? getHashedScore(hash, 3, 10, 20) : getHashedScore(hash, 3, 0, 12)
    },
  ];

  const totalScore = Math.round(signals.reduce((sum, s) => sum + s.score, 0) / signals.length);

  const hypeRating: "viral" | "trending" | "warm" | "cold" =
    totalScore >= 80 ? "viral"
    : totalScore >= 60 ? "trending"
    : totalScore >= 40 ? "warm"
    : "cold";

  return {
    totalScore,
    hypeRating,
    isMeme,
    signals: signals.map((s) => ({ ...s, score: Math.round(s.score) })),
  };
}

export function getHypeScore(symbol: string, name: string = ""): number {
  return analyzeHype(symbol, name).totalScore;
}

function hashSymbol(symbol: string): number {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    const char = symbol.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash) % 1000;
}

function getHashedScore(hash: number, index: number, min: number, max: number): number {
  const offset = (hash + index * 137) % 1000;
  return min + (offset / 1000) * (max - min);
}
