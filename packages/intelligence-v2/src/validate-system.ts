#!/usr/bin/env node

/**
 * AUREUS VALIDATION ENTRYPOINT
 *
 * Comprehensive system validation:
 * 1. ✅ TILCAYO should score 90+/120 (elite candidate)
 * 2. ✅ KEVIN should score <50/120 (reject)
 * 3. ✅ Hit rate calibration
 * 4. ✅ Gate threshold verification
 */

import { runFullValidationSuite } from "./backtest-runner.js";

async function main() {
  try {
    const results = runFullValidationSuite();

    // Exit code based on health
    process.exit(results.systemHealthy ? 0 : 1);
  } catch (error) {
    console.error("❌ VALIDATION FAILED:", error);
    process.exit(1);
  }
}

main();
