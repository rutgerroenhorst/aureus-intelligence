import { randomUUID } from "node:crypto";
/**
 * DB-backed enrichment tests. Uses a FAKE Helius (fixtures) — no real API, no key.
 * Skips if Postgres is unreachable.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getPool, closePool } from "@aureus/db";
import { runFeatureEngine, type FeatureInput } from "@aureus/feature-engine";
import { enrichCandidate, loadEnrichment } from "../apps/worker/src/enrichment.js";

let dbUp = true;
const pool = getPool();
try { await pool.query("SELECT 1"); } catch { dbUp = false; }
const d = dbUp ? describe : describe.skip;

// Minimal fakes with just the methods enrichCandidate calls (no network).
const fakeHelius = {
  tokenSupply: async () => ({ amount: "1000000", decimals: 6 }),
  tokenLargestAccounts: async () => [{ address: "h1", amount: "600000" }, { address: "h2", amount: "100000" }],
  mintAccount: async () => ({ mintAuthority: "AUTH", freezeAuthority: null, supply: "1000000", decimals: 6 }),
  accountOwners: async () => new Map([["h1", "OWNER_A"], ["h2", "OWNER_B"]]),
  oldestSignature: async () => ({ signature: "sig1", slot: 1, blockTime: 1 }),
  transactionSigner: async () => "CREATOR",
  ownerTokenBalance: async () => 50_000,
} as never;
const fakeJupiter = {
  sellQuotes: async () => [{ sizeUsd: 50, outUsd: 49, priceImpactPct: 1.2, routed: true }],
} as never;

let candidateId = "";

d("enrichment recompute flow", () => {
  beforeAll(async () => {
// Fixture ids must be unique across PARALLEL vitest workers, not just within one.
// performance.now() counts from PROCESS start, so two workers starting together both
// produced e.g. "ENRICHMINT42" and one INSERT died on tokens_chain_mint_key. The suite
// then failed in a different file on almost every run, which is worse than a red test:
// it trained us to re-run until green.
    const tok = await pool.query<{ id: string }>(`INSERT INTO tokens (chain, mint) VALUES ('solana',$1) RETURNING id`, ["ENRICHMINT" + randomUUID().slice(0, 12)]);
    const cand = await pool.query<{ id: string }>(
      `INSERT INTO candidates (candidate_code, token_id, discovered_at, discovery_source) VALUES ($1,$2,now(),'mock') RETURNING id`,
      [`AUR-ENR-${randomUUID().slice(0, 8)}`, tok.rows[0]!.id],
    );
    candidateId = cand.rows[0]!.id;
  });
  afterAll(async () => { await closePool(); });

  it("persists on-chain intel and flips holder concentration to available", async () => {
    const r = await enrichCandidate(pool, fakeHelius, fakeJupiter, candidateId, "MINT", Date.now());
    expect(r.status).toBe("PARTIAL"); // deployer/insider/bundle still incomplete
    const intel = await loadEnrichment(pool, candidateId);
    expect(intel?.onChain.available).toBe(true);
    expect(intel?.onChain.holderTop10Pct).toBeCloseTo(0.7, 6); // (600k+100k)/1M
    expect(intel?.flags.mintAuthorityActive).toBe(true);
    const status = await pool.query(`SELECT enrichment_status FROM candidates WHERE id=$1`, [candidateId]);
    expect(status.rows[0].enrichment_status).toBe("PARTIAL");
  });

  it("is idempotent — identical Helius response does not report a change", async () => {
    const r = await enrichCandidate(pool, fakeHelius, fakeJupiter, candidateId, "MINT", Date.now() + 1000);
    expect(r.changed).toBe(false);
    const cnt = await pool.query(`SELECT count(*) n FROM onchain_enrichment WHERE candidate_id=$1`, [candidateId]);
    expect(Number(cnt.rows[0].n)).toBe(1); // upsert, no duplicate row
  });

  it("recompute flips holder_concentration UNAVAILABLE → OK after enrichment", async () => {
    const now = Date.now();
    const base = (onChain: FeatureInput["onChain"]): FeatureInput => ({
      nowMs: now, discoveryAtMs: now - 60_000,
      prices: [{ observedAtMs: now, priceUsd: 1, marketCapUsd: 1000, source: "dexscreener" }],
      liquidity: [{ observedAtMs: now, liquidityUsd: 1000, source: "dexscreener" }],
      txAggregates: [], holders: [], social: [], onChain, sourcesPresent: ["dexscreener"],
    });
    // Before enrichment: no on-chain → UNAVAILABLE.
    const before = runFeatureEngine(base({ available: false })).find((f) => f.featureId === "holder_concentration")!;
    expect(before.status).toBe("UNAVAILABLE");
    // After enrichment: load intel → OK with the real value.
    const intel = (await loadEnrichment(pool, candidateId))!;
    const after = runFeatureEngine(base(intel.onChain)).find((f) => f.featureId === "holder_concentration")!;
    expect(after.status).toBe("OK");
    expect(after.value).toBeCloseTo(0.7, 6);
  });
});
