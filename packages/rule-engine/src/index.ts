import { RULES } from "./rules.js";
import { RULE_ENGINE_VERSION } from "./types.js";

export * from "./types.js";
export * from "./engine.js";
export * from "./transition.js";
export { RULES } from "./rules.js";

/** Static rule catalog (for seeding rule_definitions). */
export const RULE_CATALOG = RULES.map((r) => ({
  ruleId: r.ruleId,
  ruleVersion: r.ruleVersion,
  family: r.family,
  severity: r.severity,
  requiredFeatures: r.requiredFeatures,
  description: r.description,
}));

export { RULE_ENGINE_VERSION as ENGINE_VERSION };
