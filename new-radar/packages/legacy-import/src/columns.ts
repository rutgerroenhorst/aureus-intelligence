/**
 * Fuzzy column resolution. Legacy spreadsheets use inconsistent headers; we map
 * them to canonical field names by normalized synonym matching. Unmapped columns
 * are preserved verbatim in raw_import_payload, never dropped.
 */

export function normHeader(h: string): string {
  return h
    .toLowerCase()
    .trim()
    .replace(/[\s_\-./]+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Canonical field -> list of accepted header synonyms (normalized on compare). */
export const COLUMN_SYNONYMS: Record<string, string[]> = {
  mint: ["mint", "mintaddress", "tokenmint", "tokenaddress", "ca", "contract", "contractaddress", "token"],
  poolAddress: ["pool", "pooladdress", "pair", "pairaddress", "lp", "lpaddress", "market", "marketaddress"],
  walletAddress: ["wallet", "walletaddress", "address", "account", "owner", "holder"],
  deployerAddress: ["deployer", "deployeraddress", "creator", "createdby", "dev", "devwallet"],
  funderAddress: ["funder", "funderaddress", "fundedby", "sourcewallet", "financedby"],
  discoveryAt: ["discovered", "discoveredat", "discoverytime", "discoverytimestamp", "firstseen", "firstseenat", "date", "timestamp", "time", "detectedat"],
  sourceRef: ["source", "sourceref", "reference", "ref", "link", "url", "txn", "tx", "signature", "evidence"],
  label: ["label", "name", "tag", "note", "notes", "comment", "description", "symbol", "ticker"],
  reputation: ["reputation", "rep", "score", "trust", "rating"],
  priorLaunches: ["priorlaunches", "launches", "deploys", "previouslaunches", "history"],
  isBlacklisted: ["blacklist", "blacklisted", "isblacklisted", "banned", "flagged"],
  bundled: ["bundle", "bundled", "isbundled", "bundler", "bundle_detected"],
  bundleWallets: ["bundlewallets", "wallets", "bundlerwallets"],
  supplyPct: ["supply", "supplypct", "percent", "pct", "percentage", "share", "holdingpct"],
  status: ["status", "state", "stage", "decision"],
  unresolvedReason: ["unresolved", "reason", "unresolvedreason", "issue", "blocker"],
  dataQualityKind: ["kind", "type", "issuetype", "qualitykind", "category"],
  severity: ["severity", "level", "priority"],
};

export type CanonicalField = keyof typeof COLUMN_SYNONYMS;

/**
 * Build a map from canonical field -> actual header present in the sheet.
 * First matching header wins. Returns only fields that were found.
 */
export function resolveColumns(headers: string[]): Partial<Record<CanonicalField, string>> {
  const normalizedToOriginal = new Map<string, string>();
  for (const h of headers) {
    const n = normHeader(h);
    if (!normalizedToOriginal.has(n)) normalizedToOriginal.set(n, h);
  }
  const out: Partial<Record<CanonicalField, string>> = {};
  for (const field of Object.keys(COLUMN_SYNONYMS) as CanonicalField[]) {
    for (const syn of COLUMN_SYNONYMS[field]!) {
      const original = normalizedToOriginal.get(syn);
      if (original !== undefined) {
        out[field] = original;
        break;
      }
    }
  }
  return out;
}

/** Read a resolved field from a row object keyed by original headers. */
export function readField(
  row: Record<string, unknown>,
  cols: Partial<Record<CanonicalField, string>>,
  field: CanonicalField,
): unknown {
  const header = cols[field];
  return header === undefined ? undefined : row[header];
}
