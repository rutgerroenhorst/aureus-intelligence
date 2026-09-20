import type { Pool } from "pg";
import { evaluatePolicies, DEFAULT_ALERT_CONFIG, type AlertContext, type AlertLevel } from "@aureus/alert-engine";
import { dispatchAlert, retryPendingDeliveries, TelegramChannel, type NotificationChannel, type MessageFacts } from "@aureus/notifications";
import { FEATURE_ENGINE_VERSION } from "@aureus/feature-engine";
import { RULE_ENGINE_VERSION } from "@aureus/rule-engine";
import { workerConfig } from "./wconfig.js";
import type { ProcessSummary } from "./pipeline.js";

const AUREUS_BASE = process.env.AUREUS_PUBLIC_URL ?? "http://localhost:3000";

export function buildChannel(): NotificationChannel {
  return new TelegramChannel({
    token: process.env.TELEGRAM_BOT_TOKEN ?? "",
    chatId: process.env.TELEGRAM_CHAT_ID ?? "",
    enabled: (process.env.TELEGRAM_ENABLED ?? "false") === "true",
  });
}

function ageLabel(ms: number | null): string {
  if (ms == null) return "—";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

/** Alert on a state transition only. Mock/manual candidates never alert. */
export async function dispatchForResult(
  pool: Pool,
  channel: NotificationChannel,
  r: ProcessSummary,
  heliusMode: "LIVE" | "DEGRADED" | "MOCK",
): Promise<string[]> {
  if (!r.changed) return [];

  const prior = await pool.query(`SELECT 1 FROM alert_events WHERE candidate_id=$1 LIMIT 1`, [r.candidateId]);
  const previouslyAlerted = (prior.rowCount ?? 0) > 0;

  const ctx: AlertContext = {
    candidateId: r.candidateId, symbol: r.facts.symbol, mint: r.mint, pool: r.facts.pool,
    stateFrom: r.fromState, stateTo: r.state,
    safety: r.agg.safety, quality: r.agg.quality, entry: r.agg.entry,
    freshnessOk: r.agg.freshnessOk, openCriticalDataQuality: r.agg.openCriticalDataQuality,
    hasCriticalFail: r.hasCriticalFail, overextended: r.overextended, invalidationAvailable: r.invalidationAvailable,
    liquidityUsd: r.facts.liquidityUsd, volumeUsd: r.facts.volumeUsd, fdvUsd: r.facts.fdvUsd,
    pairAgeMs: r.facts.pairAgeMs, dataAgeMs: 0, heliusMode,
    positives: r.positives, missing: r.missing, riskReasons: r.riskReasons, previouslyAlerted,
    config: { ...DEFAULT_ALERT_CONFIG, cooldownMinutes: workerConfig.cooldownMinutes },
  };

  const proposals = evaluatePolicies(ctx);
  const outcomes: string[] = [];
  const minLevel = (process.env.TELEGRAM_MIN_ALERT_LEVEL ?? "WATCH") as AlertLevel;
  const facts: MessageFacts = {
    symbol: r.facts.symbol, liquidityUsd: r.facts.liquidityUsd, fdvUsd: r.facts.fdvUsd, volumeUsd: r.facts.volumeUsd,
    pairAgeLabel: ageLabel(r.facts.pairAgeMs),
    dexUrl: `https://dexscreener.com/solana/${r.facts.pool ?? r.mint}`,
    aureusUrl: `${AUREUS_BASE}/candidate/${r.candidateId}`,
    invalidation: r.state === "ENTRY_READY" ? ["See candidate invalidation"] : [],
    risks: r.riskReasons, heliusDegraded: heliusMode !== "LIVE",
  };

  for (const p of proposals) {
    const res = await dispatchAlert(pool, r.candidateId, p, facts, {
      channel, minLevel, cooldownMinutes: workerConfig.cooldownMinutes,
      engineVersions: { feature: FEATURE_ENGINE_VERSION, rule: RULE_ENGINE_VERSION },
    });
    outcomes.push(`${p.level}:${res.outcome}`);
  }
  await retryPendingDeliveries(pool, channel);
  return outcomes;
}
