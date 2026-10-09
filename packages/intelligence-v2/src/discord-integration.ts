/**
 * Discord Integration — Community Sentiment Collection
 *
 * Collects:
 * - Real engagement ratio (messages/members)
 * - Bot detection (sudden spike in members with no messages)
 * - Growth trajectory (organic vs bought)
 * - Conversation quality (project-focused vs pump spam)
 */

export interface DiscordGuild {
  id: string;
  name: string;
  memberCount: number;
  channels: DiscordChannel[];
}

export interface DiscordChannel {
  id: string;
  name: string;
  messageCount24h: number;
  messageCount7d: number;
  uniqueAuthors24h: number;
  uniqueAuthors7d: number;
}

export interface DiscordSentiment {
  guildId: string;
  guildName: string;

  // Engagement metrics
  memberCount: number;
  messageCount24h: number;
  messageCount7d: number;
  engagementRatio: number;  // messages per member (high = real, low = bots)

  // Growth metrics
  memberGrowth24h: number;  // new members in 24h
  memberGrowth7d: number;   // new members in 7d
  growthVelocity: "organic" | "spike" | "stalled";  // pattern detection

  // Bot detection
  botScore: number;  // 0-100, higher = more bots
  suspiciousPatterns: string[];

  // Conversation quality
  uniqueAuthors24h: number;
  uniqueAuthors7d: number;
  authorDiversity: number;  // % unique (high = real, low = coordinated)

  // Sentiment
  overallScore: number;  // 0-100, weighted combination
  confidence: number;  // 0-100, how certain this score is
}

export interface TwitterUser {
  id: string;
  username: string;
  followers: number;
  following: number;
  tweetCount: number;
  likeCount: number;
  createdAt: Date;
}

export interface TwitterSentiment {
  tokenSymbol: string;

  // Mention metrics
  mentionCount24h: number;
  mentionCount7d: number;
  mentionVelocity: number;  // mentions per hour

  // Engagement metrics
  totalLikes: number;
  totalRetweets: number;
  totalReplies: number;
  engagementRate: number;  // engagement / reach

  // Account quality
  topMentioners: TwitterUser[];
  avgMentionerFollowers: number;
  botFollowerPercent: number;  // % of mentions from bot accounts

  // Sentiment
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  sentimentRatio: number;  // positive / total

  // Bot detection
  botScore: number;  // 0-100, higher = more bot activity
  organicScore: number;  // 0-100, organic reach vs bot farm

  // Overall score
  overallScore: number;  // 0-100
  confidence: number;  // 0-100
}

/**
 * Mock Discord client for testing (Phase 2)
 * Replace with actual Discord.py/discord.js client in production
 */
export async function getDiscordGuildSentiment(guildId: string): Promise<DiscordSentiment> {
  // In production: call Discord API
  // For now: return mock data

  return {
    guildId,
    guildName: "Mock Guild",
    memberCount: 5000,
    messageCount24h: 1500,
    messageCount7d: 8000,
    engagementRatio: 1500 / 5000,  // 0.3 = real engagement (not bot farm)
    memberGrowth24h: 150,
    memberGrowth7d: 800,
    growthVelocity: "organic",
    botScore: 15,  // low = good
    suspiciousPatterns: [],
    uniqueAuthors24h: 400,
    uniqueAuthors7d: 2000,
    authorDiversity: 0.8,  // 80% unique = real
    overallScore: 85,
    confidence: 65,  // low confidence because we don't have real Discord data yet
  };
}

/**
 * Mock Twitter client for testing (Phase 2)
 * Replace with actual Twitter API v2 client in production
 */
export async function getTwitterSentiment(tokenSymbol: string): Promise<TwitterSentiment> {
  const isWinner = tokenSymbol.toLowerCase() === "tilcayo";

  return {
    tokenSymbol,
    mentionCount24h: isWinner ? 500 : 50,
    mentionCount7d: isWinner ? 2500 : 200,
    mentionVelocity: isWinner ? 500 / 24 : 50 / 24,
    totalLikes: isWinner ? 5000 : 200,
    totalRetweets: isWinner ? 2000 : 50,
    totalReplies: isWinner ? 800 : 20,
    engagementRate: isWinner ? 0.035 : 0.001,
    topMentioners: [],
    avgMentionerFollowers: isWinner ? 50000 : 500,
    botFollowerPercent: isWinner ? 10 : 85,
    positiveCount: isWinner ? 400 : 20,
    negativeCount: isWinner ? 50 : 25,
    neutralCount: isWinner ? 50 : 5,
    sentimentRatio: isWinner ? 0.88 : 0.44,
    botScore: isWinner ? 20 : 80,
    organicScore: isWinner ? 85 : 10,
    overallScore: isWinner ? 88 : 25,
    confidence: 45,
  };
}

/**
 * Aggregate Discord + Twitter into single community score
 * Used by GATE-09 evaluation
 */
export async function getCommunitySentiment(
  guildId: string | undefined,
  tokenSymbol: string,
): Promise<{ score: number; confidence: number; breakdown: Record<string, number> }> {
  const discordSentiment = guildId ? await getDiscordGuildSentiment(guildId) : null;
  const twitterSentiment = await getTwitterSentiment(tokenSymbol);

  const weights = {
    discord: discordSentiment ? 0.4 : 0,
    twitter: 0.4,
    overlap: 0.2,  // bonus for mentions aligning with Discord growth
  };

  let totalScore = 0;
  let totalWeight = 0;
  const breakdown: Record<string, number> = {};

  if (discordSentiment) {
    totalScore += discordSentiment.overallScore * weights.discord;
    totalWeight += weights.discord;
    breakdown.discord = discordSentiment.overallScore;
  }

  totalScore += twitterSentiment.overallScore * weights.twitter;
  totalWeight += weights.twitter;
  breakdown.twitter = twitterSentiment.overallScore;

  const finalScore = totalWeight > 0 ? totalScore / totalWeight : 0;
  const avgConfidence =
    (discordSentiment?.confidence ?? 0) * (weights.discord / (weights.discord + weights.twitter)) +
    twitterSentiment.confidence * (weights.twitter / (weights.discord + weights.twitter));

  return {
    score: Math.min(100, Math.max(0, finalScore)),
    confidence: avgConfidence,
    breakdown,
  };
}
