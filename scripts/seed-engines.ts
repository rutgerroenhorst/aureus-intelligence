/** pnpm db:seed — populate feature_definitions + rule_definitions + engine_versions. */
import { getPool, closePool } from "@aureus/db";
import { FEATURE_CATALOG, FEATURE_ENGINE_VERSION } from "@aureus/feature-engine";
import { RULE_CATALOG, RULE_ENGINE_VERSION, DEFAULT_RULE_CONFIG, paramHash } from "@aureus/rule-engine";
import { SNAPSHOT_ENGINE_VERSION } from "@aureus/snapshot-engine";
import { OUTCOME_ENGINE_VERSION } from "@aureus/outcome-engine";
import { ALERT_POLICY_CATALOG } from "@aureus/alert-engine";

const pool = getPool();
try {
  for (const f of FEATURE_CATALOG) {
    await pool.query(
      `INSERT INTO feature_definitions (feature_id, version, unit, observation_window, description, required_inputs)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (feature_id) DO UPDATE SET version=EXCLUDED.version, unit=EXCLUDED.unit,
         observation_window=EXCLUDED.observation_window, description=EXCLUDED.description, required_inputs=EXCLUDED.required_inputs`,
      [f.featureId, f.version, f.unit, f.observationWindow, f.description, JSON.stringify(f.requiredInputs)],
    );
  }
  for (const r of RULE_CATALOG) {
    await pool.query(
      `INSERT INTO rule_definitions (rule_id, rule_version, family, required_features, config, severity, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (rule_id) DO UPDATE SET rule_version=EXCLUDED.rule_version, family=EXCLUDED.family,
         required_features=EXCLUDED.required_features, severity=EXCLUDED.severity, description=EXCLUDED.description`,
      [r.ruleId, r.ruleVersion, r.family, JSON.stringify(r.requiredFeatures), JSON.stringify(DEFAULT_RULE_CONFIG), r.severity, r.description],
    );
  }
  const ph = paramHash(DEFAULT_RULE_CONFIG);
  const engines: Array<[string, string, string]> = [
    ["feature", FEATURE_ENGINE_VERSION, "fe-default"],
    ["rule", RULE_ENGINE_VERSION, ph],
    ["snapshot", SNAPSHOT_ENGINE_VERSION, "se-default"],
    ["outcome", OUTCOME_ENGINE_VERSION, "oe-default"],
  ];
  for (const [engine, version, hash] of engines) {
    await pool.query(
      `INSERT INTO engine_versions (engine, version, param_hash, spec_ref)
       VALUES ($1,$2,$3,$4) ON CONFLICT (engine, version, param_hash) DO NOTHING`,
      [engine, version, hash, "docs/"],
    );
  }
  for (const p of ALERT_POLICY_CATALOG) {
    await pool.query(
      `INSERT INTO alert_policies (policy_id, version, level, severity, description)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (policy_id) DO UPDATE SET version=EXCLUDED.version, level=EXCLUDED.level, severity=EXCLUDED.severity, description=EXCLUDED.description`,
      [p.policyId, p.version, p.level, p.severity, p.description],
    );
  }
  // Register the telegram channel row (config only; NO secrets stored here).
  const telegramEnabled = (process.env.TELEGRAM_ENABLED ?? "false") === "true";
  await pool.query(
    `INSERT INTO notification_channels (kind, enabled, mode, min_level)
     VALUES ('telegram', $1, $2, $3)
     ON CONFLICT (kind) DO UPDATE SET enabled=EXCLUDED.enabled, mode=EXCLUDED.mode, updated_at=now()`,
    [telegramEnabled, telegramEnabled ? "LIVE" : "DEGRADED", (process.env.TELEGRAM_MIN_ALERT_LEVEL ?? "WATCH")],
  );
  console.log(`Seeded ${FEATURE_CATALOG.length} features, ${RULE_CATALOG.length} rules, ${ALERT_POLICY_CATALOG.length} alert policies, ${engines.length} engine versions.`);
} catch (err) {
  console.error("SEED ERROR:", (err as Error).message);
  process.exitCode = 1;
} finally {
  await closePool();
}
