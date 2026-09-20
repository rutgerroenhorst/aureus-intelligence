/**
 * Value guards for the legacy import.
 *
 * Binding rule: never import an empty or uncertain value as if it were confirmed.
 * These helpers return `undefined` (meaning "unknown, do not assert") rather than
 * coercing junk into a plausible-looking value.
 */

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/; // Solana base58 alphabet (no 0 O I l)

/** True for a plausibly-valid Solana address (base58, 32–44 chars). */
export function isSolanaAddress(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  return s.length >= 32 && s.length <= 44 && BASE58.test(s);
}

/** Return a trimmed non-empty string, or undefined. Treats common null-ish text as empty. */
export function cleanString(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  if (s === "") return undefined;
  const lowered = s.toLowerCase();
  if (["n/a", "na", "-", "--", "none", "null", "undefined", "tbd", "?"].includes(lowered)) {
    return undefined;
  }
  return s;
}

/** Only returns an address if it validates; otherwise undefined (never a guess). */
export function cleanAddress(v: unknown): string | undefined {
  const s = cleanString(v);
  if (s === undefined) return undefined;
  return isSolanaAddress(s) ? s : undefined;
}

/**
 * Parse a boolean from spreadsheet cells. Returns undefined when genuinely
 * unknown (blank), so "unknown" is never coerced to false.
 */
export function cleanBool(v: unknown): boolean | undefined {
  const s = cleanString(v);
  if (s === undefined) return undefined;
  const l = s.toLowerCase();
  if (["true", "yes", "y", "1", "x", "✓", "ja"].includes(l)) return true;
  if (["false", "no", "n", "0", "nee"].includes(l)) return false;
  return undefined;
}

/** Parse a finite number, else undefined. Strips $, %, commas, spaces. */
export function cleanNumber(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  const s = cleanString(v);
  if (s === undefined) return undefined;
  const stripped = s.replace(/[$,%\s]/g, "").replace(/,/g, "");
  const n = Number(stripped);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parse a timestamp, preserving the ORIGINAL discovery moment. Accepts ISO
 * strings, common date formats, and Excel serial date numbers. Returns undefined
 * on failure — a discovery timestamp is never fabricated.
 */
export function cleanTimestamp(v: unknown): Date | undefined {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v;
  if (typeof v === "number" && Number.isFinite(v)) {
    // Excel serial date (days since 1899-12-30), if in a plausible range.
    if (v > 20000 && v < 80000) {
      const ms = Math.round((v - 25569) * 86400 * 1000);
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? undefined : d;
    }
    return undefined;
  }
  const s = cleanString(v);
  if (s === undefined) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
