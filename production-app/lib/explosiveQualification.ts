/**
 * EXPLOSIVE QUALIFICATION SYSTEM
 * Targets: pill (28x), LinkedInu (17x), Tilcayo (10x)
 * 
 * Different paradigm from structural gates:
 * - Structural: safe, proven patterns
 * - Explosive: early, momentum-driven, narrative-fueled
 */

export interface VelocityMetrics {
  volumeVelocity: number;    // current 6h volume / first hour volume
  priceVelocity: number;     // current price / entry price in first 6h
  buyRatio: number;          // buys / (buys + sells) in last 6h
  momentumScore: number;     // 0-100, how hot is it NOW
}

export interface ExplosiveRating {
  score: number;             // 0-150
  tier: "MEGA" | "HUGE" | "BIG" | "WARM" | "COLD";
  potentialMultiplier: number;
  riskLevel: "ULTRA_HIGH" | "VERY_HIGH";
  timeRemaining: number;     // hours until "too late" window closes
  confidence: number;        // 0-100
}

export function scoreExplosiveCandidate(
  hoursOld: number,
  volumeVelocity: number,
  priceVelocity: number,
  buyRatio: number,
  cleanAuthorities: boolean,
  holderTop10: number,
  narrativeStrength: number = 0.5  // community/social signals
): ExplosiveRating {
  
  let score = 0;
  
  // GATE 1: TIMING (0-30 points)
  // Early entry is CRITICAL
  if (hoursOld < 6) score += 30;
  else if (hoursOld < 12) score += 25;
  else if (hoursOld < 24) score += 20;
  else if (hoursOld < 48) score += 10;
  else score += 0; // Too late
  
  // GATE 2: VOLUME VELOCITY (0-35 points) - MOST IMPORTANT
  // This differentiates mega winners from small gainers
  if (volumeVelocity > 5) score += 35;      // pill/LinkedInu territory
  else if (volumeVelocity > 3) score += 28;
  else if (volumeVelocity > 2) score += 20;
  else if (volumeVelocity > 1) score += 10;
  
  // GATE 3: PRICE VELOCITY (0-25 points)
  // How fast is price discovering
  if (priceVelocity > 5) score += 25;
  else if (priceVelocity > 3) score += 20;
  else if (priceVelocity > 2) score += 12;
  else if (priceVelocity > 1.5) score += 6;
  
  // GATE 4: BUY PRESSURE (0-20 points)
  // Organic growth > whale dumps
  if (buyRatio > 0.75) score += 20;
  else if (buyRatio > 0.65) score += 15;
  else if (buyRatio > 0.55) score += 8;
  
  // GATE 5: CLEAN SETUP (0-15 points)
  // No scam flags
  if (cleanAuthorities) score += 15;
  
  // GATE 6: DISTRIBUTION (0-10 points)
  // Spread = potential for viral explosion
  if (holderTop10 < 1) score += 10;
  else if (holderTop10 < 2) score += 6;
  
  // GATE 7: NARRATIVE (0-15 points)
  // Story + community = hype = moon potential
  if (narrativeStrength > 0.8) score += 15;
  else if (narrativeStrength > 0.6) score += 10;
  else if (narrativeStrength > 0.4) score += 5;
  
  // Determine tier
  let tier: "MEGA" | "HUGE" | "BIG" | "WARM" | "COLD" = "COLD";
  let potentialMultiplier = 1;
  
  if (score >= 120 && volumeVelocity > 5 && hoursOld < 12) {
    tier = "MEGA";
    potentialMultiplier = 100;
  } else if (score >= 100 && volumeVelocity > 3 && hoursOld < 24) {
    tier = "HUGE";
    potentialMultiplier = 50;
  } else if (score >= 80 && volumeVelocity > 2) {
    tier = "BIG";
    potentialMultiplier = 10;
  } else if (score >= 50) {
    tier = "WARM";
    potentialMultiplier = 3;
  }
  
  // Time window: prime opportunity closes after 48h
  const timeRemaining = Math.max(0, 48 - hoursOld);
  
  // Confidence: higher for clear mega signals
  let confidence = 0;
  if (hoursOld < 12) confidence += 40;
  if (volumeVelocity > 3) confidence += 35;
  if (buyRatio > 0.7) confidence += 20;
  if (narrativeStrength > 0.6) confidence += 15;
  confidence = Math.min(confidence, 100);
  
  return {
    score: Math.round(score),
    tier,
    potentialMultiplier,
    riskLevel: tier === "MEGA" || tier === "HUGE" ? "ULTRA_HIGH" : "VERY_HIGH",
    timeRemaining: Math.round(timeRemaining),
    confidence: Math.round(confidence),
  };
}

export function getTierEmoji(tier: string): string {
  switch (tier) {
    case "MEGA":
      return "🔥🔥🔥";
    case "HUGE":
      return "🔥🔥";
    case "BIG":
      return "🔥";
    case "WARM":
      return "📈";
    default:
      return "❌";
  }
}

export function getTierRecommendation(
  tier: string,
  timeRemaining: number,
  score: number
): string {
  if (tier === "MEGA") {
    return `🚀 MOON MODE - ${timeRemaining}h WINDOW LEFT - This is the pill/LinkedInu moment!`;
  } else if (tier === "HUGE") {
    return `🔥 EXPLOSIVE - ${timeRemaining}h left - Strong 50x+ potential`;
  } else if (tier === "BIG") {
    return `🔥 HOT - Watch for momentum to continue`;
  } else if (tier === "WARM") {
    return `📈 Decent but not top tier`;
  } else {
    return `❌ Not ready yet`;
  }
}
