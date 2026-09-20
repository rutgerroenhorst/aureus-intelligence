import { describe, it, expect } from "vitest";
import { isSolanaAddress, cleanAddress, cleanBool, cleanNumber, cleanTimestamp, cleanString } from "./values.js";
import { normHeader, resolveColumns } from "./columns.js";
import { detectEntityKind } from "./detect.js";

// A real-length valid base58 Solana address (USDC mint).
const VALID = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

describe("value guards", () => {
  it("validates Solana addresses by base58 + length", () => {
    expect(isSolanaAddress(VALID)).toBe(true);
    expect(isSolanaAddress("too-short")).toBe(false);
    expect(isSolanaAddress("0OIl" + VALID)).toBe(false); // illegal base58 chars + too long
    expect(isSolanaAddress(12345)).toBe(false);
  });

  it("never coerces uncertain values", () => {
    expect(cleanString("  ")).toBeUndefined();
    expect(cleanString("N/A")).toBeUndefined();
    expect(cleanAddress("not-an-address")).toBeUndefined();
    expect(cleanBool("")).toBeUndefined(); // unknown stays unknown, not false
    expect(cleanNumber("n/a")).toBeUndefined();
  });

  it("parses known booleans and numbers", () => {
    expect(cleanBool("yes")).toBe(true);
    expect(cleanBool("nee")).toBe(false);
    expect(cleanNumber("$1,234.50")).toBe(1234.5);
    expect(cleanNumber("42%")).toBe(42);
  });

  it("parses ISO and Excel-serial timestamps, rejects junk", () => {
    expect(cleanTimestamp("2026-01-15T10:00:00Z")?.toISOString()).toBe("2026-01-15T10:00:00.000Z");
    expect(cleanTimestamp(45000)).toBeInstanceOf(Date); // excel serial in range
    expect(cleanTimestamp("not a date")).toBeUndefined();
  });
});

describe("column resolution", () => {
  it("normalizes headers", () => {
    expect(normHeader("Mint Address")).toBe("mintaddress");
    expect(normHeader("Pool_Address")).toBe("pooladdress");
  });

  it("maps synonyms to canonical fields", () => {
    const cols = resolveColumns(["Token Mint", "LP Address", "Discovered At", "Notes"]);
    expect(cols.mint).toBe("Token Mint");
    expect(cols.poolAddress).toBe("LP Address");
    expect(cols.discoveryAt).toBe("Discovered At");
  });
});

describe("entity detection", () => {
  it("detects by sheet name", () => {
    expect(detectEntityKind("Blacklist", ["Wallet", "Reason"])).toBe("blacklist");
    expect(detectEntityKind("Deployer-Funding DB", ["Deployer", "Funder"])).toBe("deployer_funding");
    expect(detectEntityKind("Unresolved", ["Reason"])).toBe("unresolved");
    expect(detectEntityKind("Candidate Pipeline", ["Mint", "Status"])).toBe("candidate");
  });

  it("falls back to unknown when nothing matches", () => {
    expect(detectEntityKind("Sheet1", ["foo", "bar"])).toBe("unknown");
  });
});
