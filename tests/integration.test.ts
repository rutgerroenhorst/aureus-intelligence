import { randomUUID } from "node:crypto";
/**
 * Engine integration tests against live Postgres. Skips automatically if the DB
 * is unreachable (so the unit suite still runs without Docker). Covers:
 *  - snapshots are immutable
 *  - rule history survives a state transition
 *  - feature versioning (append-only, multiple versions retained)
 *  - outcome persistence is immutable + duplicate horizons are idempotent
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getPool, closePool } from "@aureus/db";
import { runFeatureEngine, type FeatureInput } from "@aureus/feature-engine";
import { evaluateRules, reduceState, DEFAULT_RULE_CONFIG } from "@aureus/rule-engine";
import { buildSnapshot, persistSnapshot, appendNotebookEntry, readNotebook } from "@aureus/snapshot-engine";
import { measureOutcome, persistMeasurement, persistSchedules } from "@aureus/outcome-engine";

let dbUp = true;
const pool = getPool();
try {
  await pool.query("SELECT 1");
} catch {
  dbUp = false;
}

const d = dbUp ? describe : describe.skip;
const NOW = 1_753_000_000_000;
let candidateId = "";

async function makeCandidate(): Promise<string> {
  // Unique across parallel workers, not merely within one — see enrichment.test.ts.
  const mint = "MINT" + randomUUID().slice(0, 12);
  const tok = await pool.query<{ id: string }>(
    `INSERT INTO tokens (chain, mint) VALUES ('solana', $1) RETURNING id`,
    [mint],
  );
  const cand = await pool.query<{ id: string }>(
    `INSERT INTO candidates (candidate_code, token_id, discovered_at, discovery_source)
     VALUES ($1, $2, to_timestamp($3), 'mock') RETURNING id`,
    [`AUR-IT-${mint.slice(-8)}`, tok.rows[0]!.id, NOW / 1000],
  );
  return cand.rows[0]!.id;
}

d("engine integration", () => {
  beforeAll(async () => {
    // Seed the two definitions used by FK-bearing inserts.
    await pool.query(
      `INSERT INTO feature_definitions (feature_id, version, unit, observation_window, description)
       VALUES ('data_freshness','0.1.0','score01','instant','freshness')
       ON CONFLICT (feature_id) DO NOTHING`,
    );
    await pool.query(
      `INSERT INTO rule_definitions (rule_id, rule_version, family, severity, description)
       VALUES ('DQ-01-FRESHNESS','re-0.1.0','DATA_QUALITY','HIGH','freshness')
       ON CONFLICT (rule_id) DO NOTHING`,
    );
    candidateId = await makeCandidate();
  });

  afterAll(async () => {
    await closePool();
  });

  function synthInput(): FeatureInput {
    return {
      nowMs: NOW,
      discoveryAtMs: NOW - 60_000,
      liquidity: [
        { observedAtMs: NOW - 60 * 60_000, liquidityUsd: 100_000, source: "dexscreener" },
        { observedAtMs: NOW, liquidityUsd: 95_000, source: "dexscreener" },
      ],
      prices: [{ observedAtMs: NOW, priceUsd: 1, marketCapUsd: 500_000, source: "dexscreener" }],
      txAggregates: [],
      holders: [],
      social: [],
      onChain: { available: false },
      sourcesPresent: ["dexscreener"],
    };
  }

  it("persists an immutable snapshot with features + rules", async () => {
    const features = runFeatureEngine(synthInput());
    const rules = evaluateRules({ nowMs: NOW, features: Object.fromEntries(features.map((f) => [f.featureId, f])), flags: { onChainAvailable: false }, config: DEFAULT_RULE_CONFIG, hasOpenPosition: false });
    const decision = reduceState(rules, { hasOpenPosition: false, discoveryAtMs: NOW - 60_000, nowMs: NOW });
    const snap = buildSnapshot({
      candidateId, kind: "discovery", discoveryAtMs: NOW - 60_000, takenAtMs: NOW,
      decisionState: decision.state, engineVersions: { feature: "fe-0.1.0", rule: "re-0.1.0", snapshot: "se-0.1.0" },
      market: { priceUsd: 1 }, liquidity: { liquidityUsd: 95_000 }, holders: null, walletFlows: null,
      features, rules,
    });
    const snapId = await persistSnapshot(pool, snap);
    const fc = await pool.query(`SELECT count(*)::int c FROM snapshot_features WHERE snapshot_id=$1`, [snapId]);
    const rc = await pool.query(`SELECT count(*)::int c FROM snapshot_rules WHERE snapshot_id=$1`, [snapId]);
    expect(fc.rows[0].c).toBe(features.length);
    expect(rc.rows[0].c).toBe(rules.length);

    // Immutable: UPDATE must be rejected.
    await expect(
      pool.query(`UPDATE candidate_snapshots SET decision_state='REJECTED' WHERE id=$1`, [snapId]),
    ).rejects.toThrow(/immutable/);
  });

  it("keeps rule history across a state transition", async () => {
    await pool.query(
      `INSERT INTO rule_evaluations (candidate_id, rule_id, rule_version, family, result, severity, evidence, explanation, invalidation, evaluated_at, engine_version)
       VALUES ($1,'DQ-01-FRESHNESS','re-0.1.0','DATA_QUALITY','PASS','HIGH','{}','ok','x', now(), 're-0.1.0')`,
      [candidateId],
    );
    const before = await pool.query(`SELECT count(*)::int c FROM rule_evaluations WHERE candidate_id=$1`, [candidateId]);
    // Two state transitions.
    for (const [from, to] of [["RESEARCHING", "STRUCTURE_WATCH"], ["STRUCTURE_WATCH", "QUALITY_CONFIRMED"]]) {
      await pool.query(
        `INSERT INTO decision_state_history (candidate_id, from_state, to_state, reason, spec_version, param_hash)
         VALUES ($1,$2,$3,'t','v0','h0')`,
        [candidateId, from, to],
      );
    }
    const after = await pool.query(`SELECT count(*)::int c FROM rule_evaluations WHERE candidate_id=$1`, [candidateId]);
    expect(after.rows[0].c).toBe(before.rows[0].c); // history preserved, not overwritten
  });

  it("supports feature versioning (append-only, versions retained)", async () => {
    for (const version of ["0.1.0", "0.2.0"]) {
      await pool.query(
        `INSERT INTO feature_values (candidate_id, feature_id, version, status, value, unit, observation_window, explanation, calculated_at, engine_version)
         VALUES ($1,'data_freshness',$2,'OK',0.9,'score01','instant','v', now(), 'fe-'||$2)`,
        [candidateId, version],
      );
    }
    const { rows } = await pool.query(
      `SELECT count(DISTINCT version)::int c FROM feature_values WHERE candidate_id=$1 AND feature_id='data_freshness'`,
      [candidateId],
    );
    expect(rows[0].c).toBe(2);
  });

  it("persists outcomes immutably and idempotently per horizon", async () => {
    await persistSchedules(pool, candidateId, "discovery", NOW);
    const series = [
      { atMs: NOW, priceUsd: 1, liquidityUsd: 100_000 },
      { atMs: NOW + 10 * 60_000, priceUsd: 1.4, liquidityUsd: 100_000 },
    ];
    const m = measureOutcome({ anchorAtMs: NOW, horizon: "m15", nowMs: NOW + 20 * 60_000, series });
    const id = await persistMeasurement(pool, candidateId, "discovery", NOW, "m15", NOW + 20 * 60_000, m);
    expect(id).toBeTruthy();

    // Duplicate horizon → unique violation (idempotent, not double-counted).
    await expect(
      persistMeasurement(pool, candidateId, "discovery", NOW, "m15", NOW + 20 * 60_000, m),
    ).rejects.toThrow();

    // Immutable.
    await expect(
      pool.query(`UPDATE outcome_measurements SET ret=9 WHERE id=$1`, [id]),
    ).rejects.toThrow(/immutable/);
  });

  it("notebook is append-only and monotonically ordered", async () => {
    const s1 = await appendNotebookEntry(pool, candidateId, { entryType: "discovery", atMs: NOW, note: "found" });
    const s2 = await appendNotebookEntry(pool, candidateId, { entryType: "note", atMs: NOW + 1000, note: "second" });
    expect(s2).toBe(s1 + 1);
    const rows = await readNotebook(pool, candidateId);
    expect(rows.map((r) => r.seq)).toEqual([...rows.map((r) => r.seq)].sort((a, b) => a - b));
    await expect(
      pool.query(`UPDATE research_notebook_entries SET note='x' WHERE candidate_id=$1`, [candidateId]),
    ).rejects.toThrow(/immutable/);
  });
});
