/**
 * A person's key or a program's? Pure, no network.
 *
 * A Solana address that is a point on the ed25519 curve is the public half of a keypair: somebody can sign for it, so it is a wallet. A program-derived address (a PDA: a pool's authority, a pump.fun bonding curve,
 * a staking or escrow vault) is by construction NOT on the curve: only the program that derived it can move what it holds. "One wallet holds 25% of the coin" means nothing when that "wallet" is the coin's own
 * bonding curve (20 to 25% of the supply of many pump.fun graduates stays in it, unsellable: on 2026-10-16 the largest holder of 30 of the 35 coins on the tabs with a "one wallet holds 20% or more" flag
 * was such an account: 22 bonding curves, 4 PumpSwap pools, 4 other programs' accounts; only 5 were wallets), so the holder rules (lib/redFlags.ts) count only addresses on the curve.
 *
 * Checked against the chain on 2026-10-16: of 156 holder accounts of the live coins, 153 agreed with "owned by the System Program (or not existing) = on the curve", and the other three were program-derived
 * addresses that happened to be owned by the System Program or to have no account (a vault authority): the curve test was right and the ownership test was wrong. 0.3 ms an address.
 */

const P = (1n << 255n) - 19n;
const modpow = (base: bigint, exp: bigint, mod: bigint): bigint => {
  let r = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return r;
};
const inv = (a: bigint): bigint => modpow(a, P - 2n, P);
/** the curve constant d = -121665 / 121666 */
const D = ((P - 121665n) * inv(121666n)) % P;
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** The 32 bytes of a base58 address; null when it is not one. */
export function base58Address(s: string): Uint8Array | null {
  if (!s || s.length < 32 || s.length > 44) return null;
  let n = 0n;
  for (const ch of s) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 255n));
    n >>= 8n;
  }
  let zeros = 0;
  for (const ch of s) {
    if (ch === "1") zeros++;
    else break;
  }
  if (zeros + bytes.length !== 32) return null;
  const out = new Uint8Array(32);
  out.set(bytes, zeros);
  return out;
}

const memo = new Map<string, boolean | null>();

/** true: on the ed25519 curve (a keypair's address, a wallet); false: off the curve (program-derived: a pool, a bonding curve, a vault); null: not an address. */
export function isOnCurve(address: string): boolean | null {
  if (memo.has(address)) return memo.get(address)!;
  const bytes = base58Address(address);
  let out: boolean | null = null;
  if (bytes) {
    let y = 0n;
    for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(i === 31 ? bytes[i]! & 0x7f : bytes[i]!);
    if (y >= P) out = false;
    else {
      const y2 = (y * y) % P;
      const u = (y2 - 1n + P) % P;
      const v = (D * y2 + 1n) % P;
      // x^2 = u / v has a solution iff u / v is a square (or zero)
      const w = (u * inv(v)) % P;
      out = w === 0n || modpow(w, (P - 1n) / 2n, P) === 1n;
    }
  }
  if (memo.size > 5_000) memo.clear();
  memo.set(address, out);
  return out;
}

/** True only for an address that is provably program-derived; an address that cannot be read counts as a wallet (the rules should not drop a holder on a parsing doubt). */
export const isProgramAddress = (address: string): boolean => isOnCurve(address) === false;
