import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

export const dynamic = "force-dynamic";

// Extract Discord invite from token metadata
async function parseDiscordInvite(tokenUrl: string | undefined): Promise<string | null> {
  if (!tokenUrl) return null;

  const discordMatch = tokenUrl.match(/discord\.gg\/([a-zA-Z0-9]+)/);
  return discordMatch ? discordMatch[1] : null;
}

// Fetch Discord server member count (via public widget)
async function getDiscordMemberCount(serverId: string): Promise<number | null> {
  try {
    // Discord widget endpoint - NO AUTH REQUIRED
    // Returns public info about the server
    const response = await fetch(
      `https://discordapp.com/api/servers/${serverId}/widget.json`,
      { method: "GET" }
    );

    if (!response.ok) return null;
    const data = await response.json();
    return data.presence_count || null; // Online members count
  } catch (err) {
    return null;
  }
}

// Telegram public link parsing
async function getTelegramMemberCount(telegramUrl: string | undefined): Promise<number | null> {
  if (!telegramUrl) return null;

  try {
    // Extract username from Telegram link
    const match = telegramUrl.match(/(?:t\.me|telegram\.me)\/([a-zA-Z0-9_]+)/);
    if (!match) return null;

    const username = match[1];

    // Use Telegram Bot API (if webhook setup) or public scraping
    // For now, return a placeholder - in production would use Apify or similar
    return null;
  } catch (err) {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mint = searchParams.get("mint");
    const discordUrl = searchParams.get("discord");
    const telegramUrl = searchParams.get("telegram");

    if (!mint && !discordUrl && !telegramUrl) {
      return NextResponse.json({
        error: "mint, discord, or telegram parameter required"
      }, { status: 400 });
    }

    // If mint provided, fetch social links from database
    let socialLinks = { discord: null, telegram: null };
    if (mint) {
      const pool = getPool();
      const result = await pool.query(`
        SELECT
          t.metadata,
          c.discovered_at
        FROM candidates c
        JOIN tokens t ON t.id = c.token_id
        WHERE c.pool_id = $1
        LIMIT 1
      `, [mint]);

      if (result.rows[0]) {
        const metadata = result.rows[0].metadata || {};
        socialLinks = {
          discord: metadata.discord || metadata.social?.discord || null,
          telegram: metadata.telegram || metadata.social?.telegram || null
        };
      }
    } else {
      socialLinks = { discord: discordUrl, telegram: telegramUrl };
    }

    // Fetch member counts
    let discordMembers = null;
    let telegramMembers = null;

    if (socialLinks.discord) {
      const inviteId = await parseDiscordInvite(socialLinks.discord);
      if (inviteId) {
        discordMembers = await getDiscordMemberCount(inviteId);
      }
    }

    if (socialLinks.telegram) {
      telegramMembers = await getTelegramMemberCount(socialLinks.telegram);
    }

    // Score social signals
    let socialScore = 0;
    let signals = [];

    if (discordMembers) {
      if (discordMembers > 1000) { socialScore += 25; signals.push("✅ Large Discord (>1k)"); }
      else if (discordMembers > 500) { socialScore += 15; signals.push("✅ Good Discord (500-1k)"); }
      else if (discordMembers > 100) { socialScore += 8; signals.push("⚠️ Small Discord (100-500)"); }
      else { socialScore += 3; signals.push("❌ Tiny Discord (<100)"); }
    } else {
      signals.push("❌ No Discord detected");
    }

    if (telegramMembers) {
      if (telegramMembers > 5000) { socialScore += 20; signals.push("✅ Large Telegram (>5k)"); }
      else if (telegramMembers > 1000) { socialScore += 12; signals.push("✅ Good Telegram (1-5k)"); }
      else { socialScore += 5; signals.push("⚠️ Small Telegram (<1k)"); }
    } else {
      signals.push("⚠️ Telegram not found");
    }

    return NextResponse.json({
      mint,
      social: {
        discord: {
          url: socialLinks.discord,
          members: discordMembers,
          signal: discordMembers ? (discordMembers > 500 ? "✅ Active" : "⚠️ Small") : "❌ None"
        },
        telegram: {
          url: socialLinks.telegram,
          members: telegramMembers,
          signal: telegramMembers ? (telegramMembers > 1000 ? "✅ Active" : "⚠️ Small") : "❌ None"
        }
      },
      socialScore, // 0-100
      signals,
      verdict: socialScore > 40 ? "✅ GOOD COMMUNITY" :
               socialScore > 20 ? "⚠️ DEVELOPING" :
               "❌ WEAK COMMUNITY",
      timestamp: new Date().toISOString()
    }, {
      headers: { "Cache-Control": "max-age=3600" }
    });
  } catch (err) {
    console.error("Social signals error:", err);
    return NextResponse.json({
      error: "Failed to fetch social signals",
      timestamp: new Date().toISOString()
    }, { status: 200 });
  }
}
