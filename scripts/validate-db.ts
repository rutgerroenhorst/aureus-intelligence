/**
 * pnpm db:validate — structural validation of the applied schema.
 * Asserts the presence of enums, key tables, the immutability triggers, indexes,
 * partitioned tables + their partitions, and core constraints. Also verifies
 * migration idempotency (a second runMigrations applies nothing). Prints a report
 * and exits non-zero on any failure, so it can gate CI.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getPool, runMigrations, closePool } from "@aureus/db";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "db", "migrations");

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}
const checks: Check[] = [];
const record = (name: string, ok: boolean, detail: string) =>
  checks.push({ name, ok, detail });

const pool = getPool();

async function scalar(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await pool.query(sql, params);
  return Number(rows[0]?.count ?? 0);
}

try {
  // Ensure migrations are applied before validating.
  await runMigrations(migrationsDir);

  // 1. Enums
  const enums = [
    "chain_t",
    "evidence_status_t",
    "candidate_state_t",
    "safety_status_t",
    "quality_level_t",
    "entry_status_t",
    "severity_t",
    "source_t",
    "alert_type_t",
  ];
  for (const e of enums) {
    const n = await scalar("SELECT count(*)::int AS count FROM pg_type WHERE typname = $1", [e]);
    record(`enum ${e}`, n === 1, n === 1 ? "present" : "MISSING");
  }

  // 2. Core tables
  const tables = [
    "raw_events", "dead_letter_events", "tokens", "pools", "candidates",
    "discovery_snapshots", "discovery_events", "observations", "prices",
    "liquidity_snapshots", "transaction_aggregates", "ohlcv", "wallet_entities",
    "wallet_performance", "deployers", "funding_wallets", "holder_snapshots",
    "clusters", "launch_bundles", "social_observations", "fomo_observations",
    "risk_findings", "confirmations", "decision_state_history", "watchlists",
    "watchlist_members", "alerts", "simulated_entries", "positions", "outcomes",
    "source_health", "data_quality_issues",
  ];
  for (const t of tables) {
    const n = await scalar(
      "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public' AND table_name=$1",
      [t],
    );
    record(`table ${t}`, n === 1, n === 1 ? "present" : "MISSING");
  }

  // 3. Immutability triggers
  for (const trg of ["discovery_snapshots_immutable", "dsh_immutable"]) {
    const n = await scalar("SELECT count(*)::int AS count FROM pg_trigger WHERE tgname=$1", [trg]);
    record(`trigger ${trg}`, n === 1, n === 1 ? "present" : "MISSING");
  }

  // 4. Partitioning: parents declared partitioned + at least one partition each
  const partParents = ["prices", "liquidity_snapshots", "transaction_aggregates"];
  for (const p of partParents) {
    const isPart = await scalar(
      "SELECT count(*)::int AS count FROM pg_partitioned_table pt JOIN pg_class c ON c.oid=pt.partrelid WHERE c.relname=$1",
      [p],
    );
    const partCount = await scalar(
      "SELECT count(*)::int AS count FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhparent WHERE c.relname=$1",
      [p],
    );
    record(`partitioned ${p}`, isPart === 1 && partCount >= 1, `partitioned=${isPart} partitions=${partCount}`);
  }

  // 5. A few representative indexes
  const indexes = ["candidates_state_idx", "prices_pool_time_idx", "alerts_cand_idx", "dqi_open_idx"];
  for (const idx of indexes) {
    const n = await scalar("SELECT count(*)::int AS count FROM pg_indexes WHERE indexname=$1", [idx]);
    record(`index ${idx}`, n === 1, n === 1 ? "present" : "MISSING");
  }

  // 6. Representative unique constraints (identity integrity)
  const uniques: Array<[string, string]> = [
    ["tokens", "tokens_chain_mint_key"],
    ["pools", "pools_chain_pool_address_key"],
    ["alerts", "alerts_dedup_key_key"],
    ["raw_events", "raw_events_idempotency_key_key"],
  ];
  for (const [tbl, con] of uniques) {
    const n = await scalar(
      "SELECT count(*)::int AS count FROM pg_constraint WHERE conname=$1 AND contype='u'",
      [con],
    );
    record(`unique ${tbl}.${con}`, n === 1, n === 1 ? "present" : "MISSING (name may differ)");
  }

  // 7. Immutability actually enforced: UPDATE on decision_state_history must throw
  //    (only meaningful if we have a row; insert a minimal candidate + history).
  try {
    await pool.query("BEGIN");
    const tok = await pool.query(
      "INSERT INTO tokens (chain, mint) VALUES ('solana','VALIDATE_MINT') ON CONFLICT DO NOTHING RETURNING id",
    );
    const tokenId =
      tok.rows[0]?.id ??
      (await pool.query("SELECT id FROM tokens WHERE mint='VALIDATE_MINT'")).rows[0].id;
    const cand = await pool.query(
      `INSERT INTO candidates (candidate_code, token_id, discovered_at, discovery_source)
       VALUES ('AUR-VALIDATE', $1, now(), 'mock') RETURNING id`,
      [tokenId],
    );
    await pool.query(
      `INSERT INTO decision_state_history (candidate_id, to_state, reason, spec_version, param_hash)
       VALUES ($1, 'RESEARCHING', 'validate', 'v0', 'h0')`,
      [cand.rows[0].id],
    );
    let threw = false;
    try {
      await pool.query(
        "UPDATE decision_state_history SET reason='x' WHERE candidate_id=$1",
        [cand.rows[0].id],
      );
    } catch {
      threw = true;
    }
    record("immutability enforced (dsh UPDATE rejected)", threw, threw ? "UPDATE correctly blocked" : "UPDATE NOT blocked");
    await pool.query("ROLLBACK");
  } catch (err) {
    await pool.query("ROLLBACK");
    record("immutability enforced (dsh UPDATE rejected)", false, `probe error: ${(err as Error).message}`);
  }

  // 8. Idempotency: a second migration run applies nothing new.
  const second = await runMigrations(migrationsDir);
  record("idempotent migrations", second.applied.length === 0, `2nd run applied=${second.applied.length}`);

  // Report
  const pass = checks.filter((c) => c.ok).length;
  const fail = checks.length - pass;
  console.log("\n=== DB VALIDATION REPORT ===");
  for (const c of checks) {
    console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}  — ${c.detail}`);
  }
  console.log(`\n${pass}/${checks.length} checks passed, ${fail} failed.`);
  if (fail > 0) process.exitCode = 1;
} catch (err) {
  console.error("VALIDATION ERROR:", (err as Error).message);
  process.exitCode = 1;
} finally {
  await closePool();
}
