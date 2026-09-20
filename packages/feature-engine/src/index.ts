import type { FeatureValue } from "@aureus/contracts";
import { FEATURE_DEFS } from "./features.js";
import { FEATURE_ENGINE_VERSION, FEATURE_VERSION } from "./helpers.js";
import type { FeatureInput } from "./input.js";

export * from "./input.js";
export { FEATURE_ENGINE_VERSION, FEATURE_VERSION } from "./helpers.js";
export { FEATURE_DEFS } from "./features.js";

/** Static feature catalog (for seeding feature_definitions). */
export const FEATURE_CATALOG = FEATURE_DEFS.map((d) => ({
  featureId: d.id,
  version: FEATURE_VERSION,
  unit: d.unit,
  observationWindow: d.window,
  description: d.description,
  requiredInputs: d.requiredInputs,
}));

/**
 * Run all features deterministically. Order is fixed (registry order), and every
 * output is a function of `input` only (calculatedAt derives from input.nowMs),
 * so identical input + identical engine version yields identical output.
 */
export function runFeatureEngine(input: FeatureInput): FeatureValue[] {
  return FEATURE_DEFS.map((d) => d.calc(input));
}

export { FEATURE_ENGINE_VERSION as ENGINE_VERSION };
