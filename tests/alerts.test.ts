import { randomUUID } from "node:crypto";
/**
 * DB-backed alert dispatch tests (dedup / cooldown / retry / restart-no-dup).
 * Skips if Postgres is unreachable. Uses the FakeChannel — never a real Telegram.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getPool, closePool } from "@aureus/db";
import { evaluatePolicies, DEFAULT_ALERT_CONFIG, type AlertContext } from "@aureus/alert-engine";
import { dispatchAlert, retryPendingDeliveries, FakeChannel, type MessageFacts } from "@aureus/notifications";

let dbUp = true;
const pool = getPool();
try { await pool.query("SELECT 1"); } catch { dbUp = false; }
const d = dbUp ? describe : describe.skip;

const NOW = 1_753_500_000_000;
let candidateId = "";

function entryReadyCtx(): AlertContext {
  return {
    candidateId, symbol: "TEST", mint: "MINT", pool: "POOL",
    stateFrom: "ENTRY_WATCH", stateTo: "ENTRY_READY",
    safety: "PASSED", quality: "CONFIRMED", entry: "READY",
    freshnessOk: true, openCriticalDataQuality: false, hasCriticalFail: false,
    overextended: false, invalidationAvailable: true,
    liquidityUsd: 80_000, volumeUsd: 100_000, fdvUsd: 600_000, pairAgeMs: 3.6e6, dataAgeMs: 20_000,
    heliusMode: "LIVE", positives: ["Structure confirmed"], missing: [], riskReasons: [], previouslyAlerted: true,
    config: DEFAULT_ALERT_CONFIG,
  };
}
const facts = (): MessageFacts => ({
  symbol: "TEST", liquidityUsd: 80_000, fdvUsd: 600_000, volumeUsd: 100_000, pairAgeLabel: "1h",
  dexUrl: "https://dexscreener.com/solana/POOL", aureusUrl: "http://x", invalidation: ["Below $1"], risks: [], heliusDegraded: false,
});
const opts = (channel: FakeChannel) => ({ channel, minLevel: "WATCH" as const, cooldownMinutes: 15 });

d("alert dispatch", () => {
  beforeAll(async () => {
// Fixture ids must be unique across PARALLEL vitest workers, not just within one.
// performance.now() counts from PROCESS start, so two workers starting together both
// produced e.g. "ENRICHMINT42" and one INSERT died on tokens_chain_mint_key. The suite
// then failed in a different file on almost every run, which is worse than a red test:
// it trained us to re-run until green.
    const tok = await pool.query<{ id: string }>(`INSERT INTO tokens (chain, mint) VALUES ('solana',$1) RETURNING id`, ["ALERTMINT" + randomUUID().slice(0, 12)]);
    const cand = await pool.query<{ id: string }>(
      `INSERT INTO candidates (candidate_code, token_id, discovered_at, discovery_source) VALUES ($1,$2,to_timestamp($3),'mock') RETURNING id`,
      [`AUR-ALERT-${randomUUID().slice(0, 8)}`, tok.rows[0]!.id, NOW / 1000],
    );
    candidateId = cand.rows[0]!.id;
  });
  afterAll(async () => { await closePool(); });

  it("sends an ENTRY_READY alert exactly once, then dedups identical re-polls", async () => {
    const ch = new FakeChannel();
    const p = evaluatePolicies(entryReadyCtx()).find((x) => x.policyId === "ENTRY_READY")!;
    const r1 = await dispatchAlert(pool, candidateId, p, facts(), opts(ch));
    expect(r1.outcome).toBe("sent");
    expect(ch.sent.length).toBe(1);

    // Identical re-poll (same evidence) → duplicate, no second send.
    const r2 = await dispatchAlert(pool, candidateId, p, facts(), opts(ch));
    expect(r2.outcome).toBe("duplicate");
    expect(ch.sent.length).toBe(1);

    // Simulated worker restart: fresh channel, same proposal → still duplicate.
    const ch2 = new FakeChannel();
    const r3 = await dispatchAlert(pool, candidateId, p, facts(), opts(ch2));
    expect(r3.outcome).toBe("duplicate");
    expect(ch2.sent.length).toBe(0);
  });

  it("respects cooldown for the same level with a new evidence hash", async () => {
    const ch = new FakeChannel();
    const base = entryReadyCtx();
    // A different-hash ENTRY_READY proposal within cooldown of the first test's ENTRY_READY.
    const p = evaluatePolicies({ ...base, invalidationAvailable: true, liquidityUsd: 81_000 }).find((x) => x.policyId === "ENTRY_READY")!;
    const r = await dispatchAlert(pool, candidateId, p, facts(), opts(ch));
    expect(r.outcome).toBe("cooldown");
    expect(ch.sent.length).toBe(0);
  });

  it("RISK bypasses cooldown", async () => {
    const ch = new FakeChannel();
    const riskCtx: AlertContext = { ...entryReadyCtx(), stateFrom: "ENTRY_READY", stateTo: "REJECTED", safety: "FAILED", riskReasons: ["SAFE-05 liquidity drain"] };
    const p = evaluatePolicies(riskCtx).find((x) => x.policyId === "RISK")!;
    const r = await dispatchAlert(pool, candidateId, p, facts(), opts(ch));
    expect(r.outcome).toBe("sent");
    expect(ch.sent.length).toBe(1);
  });

  it("retries a failed delivery and records it as SENT", async () => {
    const ch = new FakeChannel({ failFirst: 1 });
    const ctx2: AlertContext = { ...entryReadyCtx(), stateFrom: "QUALITY_CONFIRMED", stateTo: "ENTRY_WATCH", entry: "WAIT_FOR_LEVEL" };
    const p = evaluatePolicies(ctx2).find((x) => x.policyId === "HIGH_PRIORITY")!;
    const r = await dispatchAlert(pool, candidateId, p, facts(), opts(ch));
    expect(r.outcome).toBe("failed"); // first attempt failed
    const retried = await retryPendingDeliveries(pool, ch);
    expect(retried).toBe(1);
    const { rows } = await pool.query(`SELECT status FROM notification_deliveries WHERE alert_event_id=$1`, [r.alertEventId]);
    expect(rows[0].status).toBe("SENT");
  });
});
