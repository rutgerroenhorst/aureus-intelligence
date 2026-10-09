import { describe, it, expect } from "vitest";
import { deriveStatus, fundamentalWatch, type WatchInput } from "./index.js";

/** END-TO-END: the full boolean gate to ENTRY_READY must be satisfiable with
 *  ADVANCED ON-CHAIN INCOMPLETE. Regression guard for the two-layer contract. */
describe("ENTRY_READY end-to-end reachability", () => {
  const healthy: WatchInput = {
    nowMs: 1_800_000_000_000, coreSafety: "PASS", anySafetyFail: false, sellClass: "SELLABLE",
    holderTop10: 0.18, insiderPct: 0.12, deployerExposure: 0.05,
    mintAuthorityActive: false, freezeAuthorityActive: false,
    liquidityUsd: 45_000, liqTrend30m: 0.04, marketCapUsd: 250_000, volumeUsd: 150_000,
    buys: 700, sells: 400, pairAgeMs: 4 * 3600_000, freshnessMs: 20_000,
    advancedMissing: ["bundle_contamination", "deployer_sales", "wallet_clusters"], // ALL advanced unknown
  };

  it("fundamentals are WATCHABLE with every advanced dataset unknown", () => {
    const f = fundamentalWatch(healthy);
    expect(f.verdict).toBe("WATCHABLE");
    expect(f.unknownRisks.length).toBe(3); // surfaced, not hidden
  });

  it("CORE PASS + ADVANCED INCOMPLETE + ENTRY CONFIRMED + fresh + slippage OK → ENTRY_READY", () => {
    const status = deriveStatus({
      fund: fundamentalWatch(healthy).verdict,
      coreSafety: "PASS",
      prox: "ENTRY_CONFIRMED",
      entryConfirmedRule: true,
      fresh: true,
      acceptableSlippage: true,
    });
    expect(status).toBe("ENTRY_READY");
  });

  it("each single gate removal blocks ENTRY_READY (no accidental shortcut)", () => {
    const base = { fund: "WATCHABLE" as const, coreSafety: "PASS" as const, prox: "ENTRY_CONFIRMED" as const, entryConfirmedRule: true, fresh: true, acceptableSlippage: true };
    expect(deriveStatus({ ...base, coreSafety: "INCOMPLETE" })).not.toBe("ENTRY_READY");
    expect(deriveStatus({ ...base, entryConfirmedRule: false })).not.toBe("ENTRY_READY");
    expect(deriveStatus({ ...base, fresh: false })).not.toBe("ENTRY_READY");
    expect(deriveStatus({ ...base, acceptableSlippage: false })).not.toBe("ENTRY_READY");
    expect(deriveStatus({ ...base, prox: "BASE_FORMING" })).not.toBe("ENTRY_READY");
  });
});
