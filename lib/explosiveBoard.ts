/**
 * EXPLOSIVE BOARD - Real-time 100x+ detector
 * Pulls velocity metrics, scores for mega-winners
 * Returns candidates ranked by moon potential
 */

import { scoreExplosiveCandidate, getTierEmoji, getTierRecommendation } from "./explosiveQualification";

export interface ExplosiveCandidate {
  id: string;
  symbol: string;
  mint: string;
  
  // Tier ranking
  tier: "MEGA" | "HUGE" | "BIG" | "WARM" | "COLD";
  explosiveScore: number;
  confidence: number;
  potentialMultiplier: number; // 3x, 10x, 50x, 100x
  
  // Live metrics
  hoursOld: number;
  volumeVelocity: number;
  priceVelocity: number;
  buyRatio: number;
  timeRemaining: number; // hours until window closes
  
  // UI
  tierEmoji: string;
  recommendation: string;
  
  // Fund metrics
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  currentPrice: number | null;
}

export async function getExplosiveCandidates(): Promise<ExplosiveCandidate[]> {
  // This will query the database for:
  // 1. Coins discovered in last 48 hours
  // 2. Calculate velocity metrics
  // 3. Score them
  // 4. Return ranked by MEGA > HUGE > BIG
  
  const query = `
    WITH recent_coins AS (
      SELECT 
        c.id,
        t.symbol_label,
        c.candidate_code,
        c.mint,
        c.discovered_at,
        EXTRACT(EPOCH FROM (now() - c.discovered_at))/3600 as hours_old,
        pr_latest.price_usd as current_price,
        pr_latest.market_cap_usd,
        lq.liquidity_usd,
        
        -- Volume velocity (current 6h volume / first hour volume)
        COALESCE(
          (SELECT volume_usd FROM transaction_aggregates 
           WHERE pool_id = c.pool_id ORDER BY observed_at DESC LIMIT 1) /
          NULLIF(
            (SELECT volume_usd FROM transaction_aggregates 
             WHERE pool_id = c.pool_id 
             AND observed_at > c.discovered_at AND observed_at <= c.discovered_at + interval '1 hour'
             ORDER BY observed_at ASC LIMIT 1),
            0
          ),
          1
        ) as volume_velocity,
        
        -- Price velocity
        COALESCE(
          pr_latest.price_usd /
          NULLIF(
            (SELECT price_usd FROM prices 
             WHERE pool_id = c.pool_id 
             ORDER BY observed_at ASC LIMIT 1),
            0
          ),
          1
        ) as price_velocity,
        
        -- Buy ratio (buys / (buys + sells) last 6h)
        COALESCE(
          (SELECT buys FROM transaction_aggregates 
           WHERE pool_id = c.pool_id AND observed_at > now() - interval '6 hours'
           ORDER BY observed_at DESC LIMIT 1) /
          NULLIF(
            (SELECT buys + sells FROM transaction_aggregates 
             WHERE pool_id = c.pool_id AND observed_at > now() - interval '6 hours'
             ORDER BY observed_at DESC LIMIT 1),
            0
          ),
          0.5
        ) as buy_ratio,
        
        -- On-chain
        (oe.intel->'flags'->>'mintAuthorityActive')::boolean as mint_auth,
        (oe.intel->'flags'->>'freezeAuthorityActive')::boolean as freeze_auth,
        (oe.intel->'onChain'->>'holderTop10Pct')::float as holder_top10
        
      FROM candidates c
      JOIN tokens t ON t.id = c.token_id
      LEFT JOIN onchain_enrichment oe ON oe.candidate_id = c.id
      LEFT JOIN LATERAL (
        SELECT price_usd, market_cap_usd FROM prices 
        WHERE pool_id = c.pool_id 
        ORDER BY observed_at DESC LIMIT 1
      ) pr_latest ON true
      LEFT JOIN LATERAL (
        SELECT liquidity_usd FROM liquidity_snapshots 
        WHERE pool_id = c.pool_id 
        ORDER BY observed_at DESC LIMIT 1
      ) lq ON true
      
      WHERE c.discovered_at > now() - interval '48 hours'
        AND c.current_state <> 'EXPIRED'
    )
    
    SELECT * FROM recent_coins
    ORDER BY hours_old ASC
    LIMIT 50
  `;
  
  // Query would execute and map to ExplosiveCandidate[]
  // For now, this is the structure - actual DB call happens in backend API
  
  return [];
}

export function rankByExplosive(candidates: any[]): ExplosiveCandidate[] {
  return candidates
    .map(c => {
      const score = scoreExplosiveCandidate(
        c.hours_old,
        c.volume_velocity,
        c.price_velocity,
        c.buy_ratio,
        !c.mint_auth && !c.freeze_auth,
        c.holder_top10 || 0,
        0.5 // placeholder narrative score
      );
      
      return {
        ...c,
        tier: score.tier,
        explosiveScore: score.score,
        confidence: score.confidence,
        potentialMultiplier: score.potentialMultiplier,
        timeRemaining: score.timeRemaining,
        tierEmoji: getTierEmoji(score.tier),
        recommendation: getTierRecommendation(score.tier, score.timeRemaining, score.score),
      };
    })
    .sort((a, b) => {
      // Sort by tier priority
      const tierOrder = { MEGA: 0, HUGE: 1, BIG: 2, WARM: 3, COLD: 4 };
      const tierDiff = (tierOrder[a.tier] || 5) - (tierOrder[b.tier] || 5);
      if (tierDiff !== 0) return tierDiff;
      
      // Then by score
      return b.explosiveScore - a.explosiveScore;
    });
}
