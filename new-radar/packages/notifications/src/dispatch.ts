import type { Pool } from "pg";
import { LEVEL_RANK, type AlertLevel, type AlertProposal } from "@aureus/alert-engine";
import type { NotificationChannel } from "./channel.js";
import { renderMessage, type MessageFacts } from "./format.js";

export interface DispatchOptions {
  channel: NotificationChannel;
  minLevel: AlertLevel;
  cooldownMinutes: number;
  maxAttempts?: number;
  engineVersions?: Record<string, string>;
}

export type DispatchOutcome =
  | "sent" | "duplicate" | "cooldown" | "skipped_level" | "degraded" | "failed" | "queued";

export interface DispatchResult {
  outcome: DispatchOutcome;
  alertEventId?: string;
  messageId?: number;
}

function dedupKey(p: AlertProposal, candidateId: string): string {
  return `${candidateId}:${p.policyId}:${p.policyVersion}:${p.stateTo}:${p.evidenceHash}`;
}

/**
 * Exact-once intent + retry-safe delivery.
 *  - dedup via UNIQUE(dedup_key): identical conditions never alert twice, even
 *    after a worker restart or an identical poll.
 *  - cooldown per (candidate, level); RISK bypasses cooldown (can override HIGH).
 *  - a genuinely new state transition yields a new dedup_key → a new alert.
 */
export async function dispatchAlert(
  pool: Pool,
  candidateId: string,
  proposal: AlertProposal,
  facts: MessageFacts,
  opts: DispatchOptions,
): Promise<DispatchResult> {
  const key = dedupKey(proposal, candidateId);
  const message = renderMessage(proposal, facts);

  // Exact-once insert FIRST — identical evidence is a duplicate regardless of cooldown.
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO alert_events
       (candidate_id, policy_id, policy_version, level, severity, state_from, state_to,
        evidence_hash, evidence, engine_versions, message, dedup_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (dedup_key) DO NOTHING
     RETURNING id`,
    [
      candidateId, proposal.policyId, proposal.policyVersion, proposal.level, proposal.severity,
      proposal.stateFrom, proposal.stateTo, proposal.evidenceHash, JSON.stringify(proposal.evidence),
      JSON.stringify(opts.engineVersions ?? {}), message, key,
    ],
  );
  if (inserted.rowCount === 0) return { outcome: "duplicate" };
  const alertEventId = inserted.rows[0]!.id;

  // Cooldown: a genuinely NEW-hash alert of the same level within the window is
  // suppressed (RISK bypasses). The event is recorded; delivery is skipped.
  if (proposal.level !== "RISK" && opts.cooldownMinutes > 0) {
    const { rows } = await pool.query(
      `SELECT 1 FROM alert_events WHERE candidate_id=$1 AND level=$2 AND id <> $3
         AND created_at > now() - ($4 || ' minutes')::interval LIMIT 1`,
      [candidateId, proposal.level, alertEventId, opts.cooldownMinutes],
    );
    if (rows.length > 0) {
      await pool.query(
        `INSERT INTO notification_deliveries (alert_event_id, channel, status) VALUES ($1,$2,'SKIPPED')
         ON CONFLICT (alert_event_id, channel) DO NOTHING`,
        [alertEventId, opts.channel.name],
      );
      return { outcome: "cooldown", alertEventId };
    }
  }

  // Below the channel's min level → record intent but do not send.
  if (LEVEL_RANK[proposal.level] < LEVEL_RANK[opts.minLevel]) {
    await pool.query(
      `INSERT INTO notification_deliveries (alert_event_id, channel, status) VALUES ($1,$2,'SKIPPED')
       ON CONFLICT (alert_event_id, channel) DO NOTHING`,
      [alertEventId, opts.channel.name],
    );
    return { outcome: "skipped_level", alertEventId };
  }

  await pool.query(
    `INSERT INTO notification_deliveries (alert_event_id, channel, status) VALUES ($1,$2,'PENDING')
     ON CONFLICT (alert_event_id, channel) DO NOTHING`,
    [alertEventId, opts.channel.name],
  );

  if (opts.channel.mode !== "LIVE") {
    return { outcome: "degraded", alertEventId };
  }

  const res = await attemptDelivery(pool, alertEventId, opts.channel, message);
  return { outcome: res.ok ? "sent" : "failed", alertEventId, messageId: res.messageId };
}

async function attemptDelivery(
  pool: Pool,
  alertEventId: string,
  channel: NotificationChannel,
  message: string,
): Promise<{ ok: boolean; messageId?: number }> {
  const r = await channel.send({ text: message, parseMode: "HTML" });
  if (r.ok) {
    await pool.query(
      `UPDATE notification_deliveries
         SET status='SENT', attempts=attempts+1, telegram_message_id=$2, delivered_at=now(), updated_at=now(), last_error=NULL
       WHERE alert_event_id=$1 AND channel=$3`,
      [alertEventId, r.messageId ?? null, channel.name],
    );
  } else {
    await pool.query(
      `UPDATE notification_deliveries SET status='FAILED', attempts=attempts+1, last_error=$2, updated_at=now()
       WHERE alert_event_id=$1 AND channel=$3`,
      [alertEventId, r.error ?? "unknown", channel.name],
    );
    await pool.query(
      `INSERT INTO notification_failures (alert_event_id, channel, error) VALUES ($1,$2,$3)`,
      [alertEventId, channel.name, r.error ?? "unknown"],
    );
  }
  return { ok: r.ok, messageId: r.messageId };
}

/** Retry FAILED deliveries below the attempt budget. Called each worker cycle. */
export async function retryPendingDeliveries(pool: Pool, channel: NotificationChannel, maxAttempts = 5): Promise<number> {
  if (channel.mode !== "LIVE") return 0;
  const { rows } = await pool.query<{ alert_event_id: string; message: string }>(
    `SELECT d.alert_event_id, e.message
       FROM notification_deliveries d JOIN alert_events e ON e.id = d.alert_event_id
      WHERE d.channel=$1 AND d.status IN ('FAILED','PENDING') AND d.attempts < $2
      ORDER BY d.updated_at LIMIT 20`,
    [channel.name, maxAttempts],
  );
  let retried = 0;
  for (const row of rows) {
    const r = await attemptDelivery(pool, row.alert_event_id, channel, row.message);
    if (r.ok) retried++;
  }
  return retried;
}
