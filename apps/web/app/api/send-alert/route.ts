import { NextResponse } from "next/server";
import { getPool } from "@aureus/db";

interface AlertRequest {
  mint: string;
  symbol: string;
  status: "READY" | "RISKY" | "EARLY";
  quality: number;
  velocity: number;
  danger: number;
  mcap: number;
  target2x: number;
  target5x: number;
  target10x: number;
  telegramBotToken?: string;
  discordWebhookUrl?: string;
  userId?: string;
}

async function sendTelegramAlert(
  token: string,
  chatId: string,
  message: string
): Promise<boolean> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML"
      })
    });
    return response.ok;
  } catch (err) {
    console.error("[Telegram] Send failed:", err);
    return false;
  }
}

async function sendDiscordAlert(
  webhookUrl: string,
  embed: any
): Promise<boolean> {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] })
    });
    return response.ok;
  } catch (err) {
    console.error("[Discord] Send failed:", err);
    return false;
  }
}

export async function POST(request: Request) {
  try {
    const body: AlertRequest = await request.json();
    const { mint, symbol, status, quality, velocity, danger, mcap, target2x, target5x, target10x, telegramBotToken, discordWebhookUrl, userId } = body;

    const statusEmoji = status === "READY" ? "🟢" : status === "RISKY" ? "🔴" : "⏳";
    const dexLink = `https://dexscreener.com/solana/${mint}`;

    let sent = false;

    // Telegram alert
    if (telegramBotToken) {
      const chatId = userId || "UNKNOWN";
      const telegramMessage = `
${statusEmoji} <b>${symbol}</b> - ${status}

Quality: ${quality}/150
Velocity: ${Math.round(velocity)}/155
Danger: ${Math.round(danger)}/100
Mcap: $${(mcap / 1000).toFixed(0)}k

Exit Targets:
2x: $${(target2x / 1000).toFixed(0)}k
5x: $${(target5x / 1000).toFixed(0)}k
10x: $${(target10x / 1000).toFixed(0)}k

<a href="${dexLink}">📊 View on DexScreener</a>
      `.trim();

      const result = await sendTelegramAlert(telegramBotToken, chatId, telegramMessage);
      sent = sent || result;
    }

    // Discord alert
    if (discordWebhookUrl) {
      const discordEmbed = {
        title: `${statusEmoji} ${symbol} - ${status}`,
        description: `A coin in your watchlist has reached ${statusEmoji} ${status} status!`,
        color: status === "READY" ? 0x34c759 : status === "RISKY" ? 0xff3b30 : 0x30b0c0,
        fields: [
          { name: "Quality", value: `${quality}/150`, inline: true },
          { name: "Velocity", value: `${Math.round(velocity)}/155`, inline: true },
          { name: "Danger", value: `${Math.round(danger)}/100`, inline: true },
          { name: "Mcap", value: `$${(mcap / 1000).toFixed(0)}k`, inline: true },
          { name: "2x Target", value: `$${(target2x / 1000).toFixed(0)}k`, inline: true },
          { name: "5x Target", value: `$${(target5x / 1000).toFixed(0)}k`, inline: true }
        ],
        url: dexLink,
        timestamp: new Date().toISOString()
      };

      const result = await sendDiscordAlert(discordWebhookUrl, discordEmbed);
      sent = sent || result;
    }

    return NextResponse.json({
      success: sent,
      message: sent ? "Alert sent successfully" : "No alert destination provided",
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[send-alert] Error:", msg);
    return NextResponse.json(
      { success: false, error: msg },
      { status: 200 }
    );
  }
}
