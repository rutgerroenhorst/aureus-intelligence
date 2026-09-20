/**
 * GATE-11: Real-Time Momentum Detection
 * Tilcayo early detection system
 */

export interface MomentumData {
  volumeUsd24h: number;
  volumeUsd7d: number;
  buyVolume: number;
  sellVolume: number;
  holderCount: number;
  holderGrowthRate: number;
  support1Price: number | null;
  support1Tests: number;
  currentPrice: number;
  highestPrice24h: number;
  lowestPrice24h: number;
  discordEngagementScore: number;
  twitterMentions24h: number;
  twitterBotScore: number;
  hoursActive: number;
}

export interface Gate11Verdict {
  status: "TILCAYO_CANDIDATE" | "STRONG_WATCH" | "MONITOR" | "NOT_READY";
  score: number;
  confidence: number;
  volumeScore: number;
  momentumScore: number;
  communityScore: number;
  signalsTriggered: string[];
  redFlags: string[];
  phase: string;
  recommendedAction: string;
}

export function evaluateMomentum(data: MomentumData): Gate11Verdict {
  const signalsTriggered: string[] = [];
  const redFlags: string[] = [];
  
  let volumeScore = 0;
  const volumeRatio = data.volumeUsd24h / Math.max(data.volumeUsd7d / 7, 1);
  
  if (volumeRatio >= 3.0) {
    volumeScore += 15;
    signalsTriggered.push(`Volume ${volumeRatio.toFixed(1)}x normal`);
  } else if (volumeRatio >= 1.5) {
    volumeScore += 5;
  } else {
    redFlags.push("Volume low");
  }
  
  const buyRatio = data.buyVolume / Math.max(data.sellVolume, 1);
  if (buyRatio >= 1.5) {
    volumeScore += 15;
    signalsTriggered.push(`Buy/sell ${buyRatio.toFixed(1)}:1`);
  } else {
    redFlags.push(`Buy/sell only ${buyRatio.toFixed(2)}:1`);
  }
  
  let momentumScore = 0;
  if (data.holderGrowthRate >= 15) {
    momentumScore += 15;
    signalsTriggered.push(`Holders +${data.holderGrowthRate.toFixed(0)}%/day`);
  } else {
    redFlags.push(`Holders +${data.holderGrowthRate.toFixed(0)}%/day (weak)`);
  }
  
  if (data.support1Tests >= 2) {
    momentumScore += 15;
    signalsTriggered.push(`Support tested ${data.support1Tests}x`);
  } else {
    redFlags.push("No support yet");
  }
  
  let communityScore = 0;
  if (data.discordEngagementScore >= 60) {
    communityScore += 15;
    signalsTriggered.push(`Discord ${data.discordEngagementScore}/100`);
  }
  
  if (data.twitterBotScore < 40 && data.twitterMentions24h >= 30) {
    communityScore += 15;
    signalsTriggered.push(`Twitter ${data.twitterMentions24h} organic mentions`);
  }
  
  const totalScore = volumeScore + momentumScore + communityScore;
  
  let status: "TILCAYO_CANDIDATE" | "STRONG_WATCH" | "MONITOR" | "NOT_READY" = "NOT_READY";
  let recommendedAction = "";
  
  if (totalScore >= 90 && redFlags.length === 0) {
    status = "TILCAYO_CANDIDATE";
    recommendedAction = "🎯 ENTRY SIGNAL - Phase 2/3 candidate";
  } else if (totalScore >= 70) {
    status = "STRONG_WATCH";
    recommendedAction = "⚠️ WATCH CLOSELY";
  } else if (totalScore >= 50) {
    status = "MONITOR";
    recommendedAction = "👁️ LOW CONVICTION";
  }
  
  return {
    status,
    score: totalScore,
    confidence: Math.min(100, (signalsTriggered.length / 10) * 100),
    volumeScore,
    momentumScore,
    communityScore,
    signalsTriggered,
    redFlags,
    phase: data.hoursActive < 24 && totalScore >= 70 ? "REALITY_CHECK (ENTRY)" : "OTHER",
    recommendedAction,
  };
}
