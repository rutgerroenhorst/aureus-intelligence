import { describe, it, expect } from "vitest";
import { evaluateVerificationGates } from "@aureus/intelligence-v2";

describe("Phase 1 Danger Validation", () => {
  it("extremely high holder concentration (99%) → FATAL_REJECT", () => {
    const verdict = evaluateVerificationGates({
      features: new Map([["deployerDirectHoldingPct", { status: "OK", value: "0.1" }]]),
      mint: { freezeAuthority: { address: "0xSAFE", isMutable: false } },
      deployer: { address: "0xABC" },
      topHolders: [{ wallet: "w1", pct: 0.99 }], // 99% held by single wallet
      knownRugs: [],
    });

    expect(verdict.status).toBe("FATAL_REJECT");
    expect(verdict.failedGates.some(g => g.gateId === "GATE-04-HOLDER-CONCENTRATION")).toBe(true);
  });

  it("mutable freeze authority → FATAL_REJECT", () => {
    const verdict = evaluateVerificationGates({
      features: new Map([["deployerDirectHoldingPct", { status: "OK", value: "0.1" }]]),
      mint: { freezeAuthority: { address: "0xDEAD", isMutable: true } },
      deployer: { address: "0xABC" },
      topHolders: [{ wallet: "w1", pct: 0.3 }],
      knownRugs: [],
    });

    expect(verdict.status).toBe("FATAL_REJECT");
    expect(verdict.failedGates.some(g => g.gateId === "GATE-01-FREEZE-AUTHORITY")).toBe(true);
  });

  it("high deployer concentration (75%) → FATAL_REJECT", () => {
    const verdict = evaluateVerificationGates({
      features: new Map([["deployerDirectHoldingPct", { status: "OK", value: "0.75" }]]),
      mint: { freezeAuthority: { address: "0xSAFE", isMutable: false } },
      deployer: { address: "0xABC" },
      topHolders: [{ wallet: "w1", pct: 0.1 }],
      knownRugs: [],
    });

    expect(verdict.status).toBe("FATAL_REJECT");
    expect(verdict.failedGates.some(g => g.gateId === "GATE-03-DEPLOYER-CONCENTRATION")).toBe(true);
  });
});
