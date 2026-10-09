// Integration helpers to automatically track coins as they qualify for tabs

export async function trackCoinQualification(coin: any, tab_name: string) {
  try {
    await fetch("/api/learning-track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mint: coin.mint,
        symbol: coin.symbol,
        tab_name,
        age_minutes_at_qualification: coin.minutesOld,
        score_at_qualification: coin.score,
        buy_ratio_at_qualification: coin.buyRatio,
        holder_top10_at_qualification: coin.holderTop10,
        volume_velocity_at_qualification: coin.volumeVelocity,
        price_velocity_at_qualification: coin.priceVelocity,
        mcap_usd_at_qualification: coin.mcap,
        liquidity_usd_at_qualification: coin.liq,
        danger_score_at_qualification: coin.dangerScore,
      })
    });
  } catch (err) {
    console.error(`[learning] Failed to track ${coin.symbol} for ${tab_name}:`, err);
  }
}

// Track coins in tabs from command-center-tabs
export function trackTabQualifications(
  coins: any[],
  tab_id: string,
  tabConfig: any
) {
  coins.forEach((coin) => {
    if (tabConfig.filter(coin)) {
      trackCoinQualification(coin, tab_id);
    }
  });
}

// Tab mappings for different qualifying conditions
export const TAB_TRACK_CONFIGS = {
  quick_flip: {
    id: "quick_flip",
    description: "Ultra-early (<1 min old) with strong signals",
  },
  stealth_moon: {
    id: "stealth_moon",
    description: "3-8 days old with quiet accumulation patterns",
  },
  elite: {
    id: "elite",
    description: "High quality score + strong fundamentals",
  },
  early: {
    id: "early",
    description: "Early entry coins (minutes to hours old)",
  },
};
