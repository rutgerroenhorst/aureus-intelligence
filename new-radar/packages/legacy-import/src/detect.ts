/**
 * Detect which legacy entity a sheet holds, from its name and header signature.
 * Sheet names in the source workbook are not guaranteed, so we combine a
 * name-based hint with a header-based signature and take the strongest match.
 */
import { normHeader } from "./columns.js";

export type EntityKind =
  | "wallet"
  | "deployer_funding"
  | "blacklist"
  | "bundler"
  | "candidate"
  | "observation"
  | "unresolved"
  | "data_quality"
  | "unknown";

interface Rule {
  kind: EntityKind;
  nameHints: string[]; // normalized substrings of the sheet name
  headerHints: string[]; // normalized headers that strongly indicate this kind
}

const RULES: Rule[] = [
  {
    kind: "blacklist",
    nameHints: ["blacklist", "banned", "flagged"],
    headerHints: ["blacklisted", "banned", "reason"],
  },
  {
    kind: "deployer_funding",
    nameHints: ["deployer", "funding", "funder", "deployerfunding"],
    headerHints: ["deployer", "funder", "fundedby", "creator"],
  },
  {
    kind: "bundler",
    nameHints: ["bundler", "bundle", "bundlerdetection"],
    headerHints: ["bundle", "bundled", "bundlewallets"],
  },
  {
    kind: "candidate",
    nameHints: ["candidate", "pipeline", "kandidaten", "kandidatenpipeline"],
    headerHints: ["mint", "pool", "status", "stage"],
  },
  {
    kind: "observation",
    nameHints: ["observation", "observationlog", "log"],
    headerHints: ["observation", "note", "timestamp"],
  },
  {
    kind: "unresolved",
    nameHints: ["unresolved"],
    headerHints: ["unresolved", "reason", "blocker"],
  },
  {
    kind: "data_quality",
    nameHints: ["dataquality", "quality", "dq"],
    headerHints: ["kind", "severity", "issue"],
  },
  {
    kind: "wallet",
    nameHints: ["wallet", "walletdb", "wallets"],
    headerHints: ["wallet", "address", "reputation"],
  },
];

export function detectEntityKind(sheetName: string, headers: string[]): EntityKind {
  const name = normHeader(sheetName);
  const normHeaders = new Set(headers.map(normHeader));

  let best: { kind: EntityKind; score: number } = { kind: "unknown", score: 0 };
  for (const rule of RULES) {
    let score = 0;
    for (const h of rule.nameHints) if (name.includes(h)) score += 3;
    for (const h of rule.headerHints) if (normHeaders.has(h)) score += 1;
    if (score > best.score) best = { kind: rule.kind, score };
  }
  return best.score > 0 ? best.kind : "unknown";
}
