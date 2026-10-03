import { describe, it, expect } from "vitest";
import { evaluateVerificationGates } from "./revised-gates.js";

describe("Intelligence V2 Revised Gates - Semantic Correctness", () => {
  it("1. Missing freeze authority => INSUFFICIENT_DATA (not FATAL_REJECT)", () => {
    const verdict = evaluateVerificationGates({
      features: new Map(),
      mint: { freezeAuthority: undefined },
      deployer: { address: "0xABC" },
      topHolders: [{ wallet: "w1", pct: 0.3 }],
    });

    expect(verdict.status).toBe("INSUFFICIENT_DATA");
    expect(verdict.confidence).toBe(30);
  });

  it("2. Mutable freeze authority => FATAL_REJECT (danger evidence)", () => {
    const verdict = evaluateVerificationGates({
      features: new Map(),
      mint: { freezeAuthority: { address: "0xDEAD", isMutable: true } },
      deployer: { address: "0xABC" },
      topHolders: [{ wallet: "w1", pct: 0.3 }],
    });

    expect(verdict.status).toBe("FATAL_REJECT");
    expect(verdict.confidence).toBe(100);
  });

  it("3. Missing deployer => INSUFFICIENT_DATA", () => {
    const verdict = evaluateVerificationGates({
      features: new Map(),
      mint: { freezeAuthority: { address: "0xSAFE", isMutable: false } },
      deployer: undefined,
      topHolders: [{ wallet: "w1", pct: 0.3 }],
    });

    expect(verdict.status).toBe("INSUFFICIENT_DATA");
  });

  it("4. Missing topHolders => INSUFFICIENT_DATA", () => {
    const verdict = evaluateVerificationGates({
      features: new Map(),
      mint: { freezeAuthority: { address: "0xSAFE", isMutable: false } },
      deployer: { address: "0xABC" },
      topHolders: undefined,
    });

    expect(verdict.status).toBe("INSUFFICIENT_DATA");
  });

  it("5. Multiple missing gates => INSUFFICIENT_DATA", () => {
    const verdict = evaluateVerificationGates({
      features: new Map(),
      mint: {},
      deployer: undefined,
      topHolders: undefined,
    });

    expect(verdict.status).toBe("INSUFFICIENT_DATA");
    expect(verdict.confidence).toBe(30);
  });

  it("6. Fatal gate + missing gates => FATAL_REJECT (fatal priority)", () => {
    const verdict = evaluateVerificationGates({
      features: new Map(),
      mint: { freezeAuthority: { address: "0xDEAD", isMutable: true } },
      deployer: undefined,
      topHolders: undefined,
    });

    expect(verdict.status).toBe("FATAL_REJECT");
  });

  it("7. All gates pass => STRUCTURALLY_QUALIFIED", () => {
    const verdict = evaluateVerificationGates({
      features: new Map([
        ["deployerDirectHoldingPct", { status: "OK", value: "0.25" } as any],
      ]),
      mint: { freezeAuthority: { address: "0xSAFE", isMutable: false } },
      deployer: { address: "0xABC" },
      topHolders: [{ wallet: "w1", pct: 0.3 }],
      knownRugs: [],
    });

    expect(verdict.status).toBe("STRUCTURALLY_QUALIFIED");
  });
});
