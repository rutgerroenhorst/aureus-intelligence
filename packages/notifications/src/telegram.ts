import type { ChannelMode, NotificationChannel, OutboundMessage, SendResult } from "./channel.js";

export interface TelegramOptions {
  token: string;
  chatId: string;
  enabled: boolean;
  apiBase?: string; // override for tests
  timeoutMs?: number;
}

/** Escape user/dynamic content for Telegram HTML parse mode. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Real Telegram channel. The bot token is used only to build the request URL and
 * is NEVER logged or returned in errors (errors are sanitized to strip it).
 */
export class TelegramChannel implements NotificationChannel {
  readonly name = "telegram";
  readonly mode: ChannelMode;
  private readonly token: string;
  private readonly chatId: string;
  private readonly apiBase: string;
  private readonly timeoutMs: number;

  constructor(opts: TelegramOptions) {
    this.token = opts.token;
    this.chatId = opts.chatId;
    this.apiBase = opts.apiBase ?? "https://api.telegram.org";
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.mode = opts.enabled && opts.token && opts.chatId ? "LIVE" : "DEGRADED";
  }

  private sanitize(s: string): string {
    // Defensive: never allow the token to appear in any surfaced string.
    return this.token ? s.split(this.token).join("***") : s;
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    if (this.mode !== "LIVE") return { ok: false, error: "telegram not configured (DEGRADED)" };
    const url = `${this.apiBase}/bot${this.token}/sendMessage`;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: this.chatId, text: msg.text, parse_mode: msg.parseMode ?? "HTML", disable_web_page_preview: true }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: { message_id?: number }; description?: string };
      if (res.ok && body.ok) return { ok: true, messageId: body.result?.message_id };
      return { ok: false, error: this.sanitize(`telegram ${res.status}: ${body.description ?? "unknown"}`) };
    } catch (err) {
      return { ok: false, error: this.sanitize(`telegram request failed: ${(err as Error).message}`) };
    }
  }

  /** Simple connectivity test used by `pnpm telegram:test`. */
  testConnection(): Promise<SendResult> {
    return this.send({ text: "Aureus Intelligence Telegram connection successful.", parseMode: "HTML" });
  }
}

/** In-memory channel for tests: records messages, optional scripted failures. */
export class FakeChannel implements NotificationChannel {
  readonly name = "fake";
  readonly mode: ChannelMode = "LIVE";
  sent: OutboundMessage[] = [];
  private failuresRemaining: number;
  private nextId = 1000;
  constructor(opts: { failFirst?: number } = {}) {
    this.failuresRemaining = opts.failFirst ?? 0;
  }
  async send(msg: OutboundMessage): Promise<SendResult> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining--;
      return { ok: false, error: "scripted failure" };
    }
    this.sent.push(msg);
    return { ok: true, messageId: this.nextId++ };
  }
}
