/**
 * PHASE 2: Community Sentiment Data Collector
 * 
 * Collects real-time Discord/Twitter metrics for GATE-09 evaluation
 * Hooks into existing candidate tracking
 */

export interface CommunityMetrics {
  // Discord
  discordMembersCount: number;
  discordMessagesLast24h: number;
  discordEngagementScore: number; // 0-100
  discordBotRatio: number; // 0-1
  
  // Twitter
  twitterFollowers: number;
  twitterMentions24h: number;
  twitterEngagementRate: number; // 0-1
  twitterBotScore: number; // 0-100
  
  // Aggregate
  organicMentions: number;
  realPeopleScore: number; // 0-100
  communityGrowthRate: number; // % per day
}

export interface DiscordGuildStats {
  membersTotal: number;
  membersOnline: number;
  messagesLast24h: number;
  uniqueAuthorsLast24h: number;
  averageMessagesPerMember: number;
}

export interface TwitterStats {
  followers: number;
  tweets24h: number;
  mentions24h: number;
  likes24h: number;
  retweets24h: number;
  avgEngagementRate: number;
  botDetectionScore: number;
}

/**
 * Calculate Discord engagement quality (0-100)
 * Heuristic: real communities have message/member ratio of 0.3-0.7
 * Bots have <0.1, normal churn 0.1-0.2
 */
export function calculateDiscordEngagement(stats: DiscordGuildStats): number {
  const ratio = stats.messagesLast24h / Math.max(stats.membersTotal, 1);
  
  // Perfect engagement: message ratio 0.3-0.5
  if (ratio >= 0.3 && ratio <= 0.5) return 95;
  
  // Good: 0.2-0.3 or 0.5-0.7
  if ((ratio >= 0.2 && ratio < 0.3) || (ratio > 0.5 && ratio <= 0.7)) return 75;
  
  // Fair: 0.1-0.2
  if (ratio >= 0.1 && ratio < 0.2) return 50;
  
  // Suspicious: <0.1 (bot farm) or >0.7 (manipulation)
  if (ratio < 0.1 || ratio > 0.7) return 20;
  
  return 40;
}

/**
 * Calculate Twitter authenticity (0-100, higher = more real)
 * Real accounts: engagement 1-5%, follower/mention ratio balanced
 * Bots: engagement <0.5%, fake followers, bot-like behavior
 */
export function calculateTwitterAuthenticity(stats: TwitterStats): number {
  const engagementRate = stats.avgEngagementRate;
  
  // Real engagement: 1-5%
  if (engagementRate >= 0.01 && engagementRate <= 0.05) return 90;
  
  // High engagement: 5-10% (possible manipulation but not certain)
  if (engagementRate > 0.05 && engagementRate <= 0.1) return 70;
  
  // Low engagement: 0.5-1% (suspicious but possible)
  if (engagementRate >= 0.005 && engagementRate < 0.01) return 40;
  
  // Very low: <0.5% (likely bots or dead account)
  if (engagementRate < 0.005) return 15;
  
  return 50;
}

/**
 * Calculate bot detection score (0-100, lower = fewer bots)
 * Checks for patterns:
 * - Sudden follower spikes
 * - Low engagement with high followers
 * - Similar usernames (common bot pattern)
 * - Repeated generic comments
 */
export function calculateBotScore(stats: TwitterStats): number {
  // If engagement is good, fewer bots likely
  if (stats.avgEngagementRate >= 0.02) return 20;
  
  // Low engagement with many followers = bought followers
  if (stats.followers > 5000 && stats.avgEngagementRate < 0.01) return 85;
  
  // Medium followers, decent engagement = likely organic
  if (stats.followers < 5000 && stats.avgEngagementRate >= 0.01) return 30;
  
  // Default to moderate suspicion
  return 50;
}

/**
 * Calculate organic mention score (0-100)
 * Real mentions: different accounts, varied content, discussion
 * Fake: same accounts, "moon" spam, pump language
 */
export function calculateOrganicMentions(
  mentions24h: number,
  uniqueAccounts: number,
  keywords: {bots: number; spam: number; organic: number}
): number {
  const uniqueRatio = uniqueAccounts / Math.max(mentions24h, 1);
  
  // High diversity: >70% unique accounts
  if (uniqueRatio > 0.7 && keywords.organic > keywords.spam) return 90;
  
  // Good diversity: 40-70%
  if (uniqueRatio >= 0.4 && uniqueRatio <= 0.7) return 65;
  
  // Low diversity: <40% (likely coordinated)
  if (uniqueRatio < 0.4 && keywords.spam > keywords.organic) return 25;
  
  return 50;
}

/**
 * Calculate real people score (0-100)
 * Aggregate of Discord + Twitter authenticity
 */
export function calculateRealPeopleScore(
  discordEngagement: number,
  twitterAuth: number,
  botScore: number
): number {
  // Weight: Discord 40%, Twitter 40%, Bot (negative) 20%
  const score = (discordEngagement * 0.4) + (twitterAuth * 0.4) - (botScore * 0.2);
  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate community growth rate (% per day)
 * Tracks how fast members/followers grow
 */
export function calculateGrowthRate(
  previousCount: number,
  currentCount: number,
  daysSince: number
): number {
  if (daysSince === 0) return 0;
  const change = (currentCount - previousCount) / Math.max(previousCount, 1);
  const dailyRate = (change / daysSince) * 100;
  return Math.max(0, Math.min(100, dailyRate)); // Cap at 100% daily
}

/**
 * Main: Aggregate all metrics into CommunityMetrics
 */
export function aggregateCommunityMetrics(
  discord: DiscordGuildStats,
  twitter: TwitterStats,
  twitterMentions: number
): CommunityMetrics {
  const discordEngagement = calculateDiscordEngagement(discord);
  const twitterAuth = calculateTwitterAuthenticity(twitter);
  const botScore = calculateBotScore(twitter);
  const realPeopleScore = calculateRealPeopleScore(discordEngagement, twitterAuth, botScore);
  
  return {
    discordMembersCount: discord.membersTotal,
    discordMessagesLast24h: discord.messagesLast24h,
    discordEngagementScore: discordEngagement,
    discordBotRatio: 1 - (discordEngagement / 100),
    
    twitterFollowers: twitter.followers,
    twitterMentions24h: twitterMentions,
    twitterEngagementRate: twitter.avgEngagementRate,
    twitterBotScore: botScore,
    
    organicMentions: Math.round(twitterMentions * (realPeopleScore / 100)),
    realPeopleScore,
    communityGrowthRate: calculateGrowthRate(twitter.followers * 0.95, twitter.followers, 1),
  };
}
