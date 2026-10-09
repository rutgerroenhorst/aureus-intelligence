export type ChannelMode = "LIVE" | "DEGRADED" | "DISABLED";

export interface OutboundMessage {
  text: string;
  parseMode?: "HTML" | "MarkdownV2";
}

export interface SendResult {
  ok: boolean;
  messageId?: number;
  error?: string;
}

export interface NotificationChannel {
  readonly name: string;
  readonly mode: ChannelMode;
  send(msg: OutboundMessage): Promise<SendResult>;
}
