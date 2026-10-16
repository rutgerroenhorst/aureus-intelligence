import { describe, expect, it } from "vitest";
import { base58Address, isOnCurve, isProgramAddress } from "./solanaKeys";

// Real addresses from one live coin (2026-10-16): the accounts that held its supply, as RugCheck lists them, and what the chain says each one is.
const BONDING_CURVE = "5R5rRjwV4d3VB9xfSpNRvxxUeLMvcrAozGMAofQUuJKB"; // owned by the pump.fun program, 20.5% of the supply
const POOL = "EsPEqy84fzxYapAhwX476q1fsWUEsrUeEzSYckuuxon9"; // the PumpSwap pool, 17%
const WALLETS = ["DgyKfPKr9QW6crYy3MaKhVBLRom1eZPnpu3LZLUW1AuQ", "Akjewo4wZopMSQ3fKkGkvLiGpfkcunrWk4nDb9MabpXz", "3yrBgKw5tRAurhGfL9sA6ph5g6c6Z78ao7GxbxBEfLcS", "82orSJedizcnnnmrUD3psz8geSpb2GwgMqWBa6x7RrVB"];
/** the "creator" RugCheck names for that coin is not a wallet either: an account of pump.fun's fee program (creator-fee sharing) */
const CREATOR_FEE_ACCOUNT = "9YW2x6q9X3hYZQ5wKuccSf3GfQKXfPs6y3dwETozS6ve";
/** an account owned by the System Program that is nevertheless program-derived (a vault authority holding 27% of another coin): only the curve test gets it right */
const SYSTEM_OWNED_PDA = "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL";

describe("is this address a person's key or a program's?", () => {
  it("a pump.fun bonding curve and a pool are program-derived: off the curve", () => {
    expect(isOnCurve(BONDING_CURVE)).toBe(false);
    expect(isOnCurve(POOL)).toBe(false);
    expect(isProgramAddress(BONDING_CURVE)).toBe(true);
  });
  it("wallets are on the curve", () => {
    for (const w of WALLETS) {
      expect(isOnCurve(w)).toBe(true);
      expect(isProgramAddress(w)).toBe(false);
    }
  });
  it("a program-derived address that the System Program owns (a vault holding 1,274 SOL) is still program-derived; so is a creator-fee account", () => {
    expect(isOnCurve(SYSTEM_OWNED_PDA)).toBe(false);
    expect(isOnCurve(CREATOR_FEE_ACCOUNT)).toBe(false);
  });
  it("something that is not an address is not judged (and is not dropped as a holder)", () => {
    expect(isOnCurve("")).toBeNull();
    expect(isOnCurve("O1")).toBeNull();
    expect(isOnCurve("0OIl".padEnd(44, "x"))).toBeNull();
    expect(isProgramAddress("POOL")).toBe(false);
  });
  it("reads the 32 bytes of an address, with leading zeros for leading 1s", () => {
    expect(base58Address("11111111111111111111111111111111")).toEqual(new Uint8Array(32));
    expect(base58Address(WALLETS[0]!)).toHaveLength(32);
  });
  it("answers the same twice (kept)", () => {
    expect(isOnCurve(BONDING_CURVE)).toBe(isOnCurve(BONDING_CURVE));
  });
});
