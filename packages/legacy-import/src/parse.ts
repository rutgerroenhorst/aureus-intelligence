/**
 * Parse a legacy workbook into staged rows — pure transformation, no DB.
 * Preserves the original row verbatim (rawImportPayload), extracts address-first
 * identity, preserves original discovery timestamps + source refs, and classifies
 * each row (PENDING / SKIPPED / UNRESOLVED / CONFLICTING) without ever promoting
 * an empty or uncertain value as confirmed.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { detectEntityKind, type EntityKind } from "./detect.js";
import { resolveColumns, readField, type CanonicalField } from "./columns.js";
import { cleanAddress, cleanString, cleanTimestamp } from "./values.js";

export type ImportStatus = "PENDING" | "SKIPPED" | "UNRESOLVED" | "CONFLICTING";

export interface StagedRow {
  sheetName: string;
  rowIndex: number;
  entityKind: EntityKind;
  mint?: string;
  poolAddress?: string;
  walletAddress?: string;
  discoveryAt?: string; // ISO, preserved from source
  sourceRef?: string;
  mapped: Record<string, unknown>;
  rawImportPayload: Record<string, unknown>;
  importStatus: ImportStatus;
  reasons: string[];
}

export interface ParsedSheet {
  name: string;
  entityKind: EntityKind;
  headers: string[];
  resolvedColumns: Partial<Record<CanonicalField, string>>;
  unmappedHeaders: string[];
  rows: StagedRow[];
}

export interface ParsedWorkbook {
  sourceFile: string;
  sha256: string;
  sheets: ParsedSheet[];
}

function findHeaderRow(aoa: unknown[][]): number {
  for (let i = 0; i < Math.min(aoa.length, 20); i++) {
    const row = aoa[i] ?? [];
    const nonEmpty = row.filter((c) => c !== null && String(c).trim() !== "");
    if (nonEmpty.length >= 2) return i;
  }
  return 0;
}

/** Which identity a given entity kind needs to be promotable. */
function classify(row: StagedRow): void {
  if (row.entityKind === "unresolved") {
    row.importStatus = "UNRESOLVED";
    row.reasons.push("legacy unresolved record preserved as unresolved by design");
    return;
  }

  const needsWallet =
    row.entityKind === "wallet" ||
    row.entityKind === "blacklist" ||
    row.entityKind === "bundler" ||
    row.entityKind === "deployer_funding";
  const needsMint = row.entityKind === "candidate" || row.entityKind === "observation";

  const hasWallet = !!row.walletAddress;
  const hasMint = !!row.mint;

  // Completely empty row → skip.
  const anyContent =
    Object.values(row.mapped).some((v) => v !== undefined && v !== null && v !== "") ||
    hasWallet ||
    hasMint;
  if (!anyContent) {
    row.importStatus = "SKIPPED";
    row.reasons.push("empty row");
    return;
  }

  if (needsWallet && !hasWallet) {
    row.importStatus = "UNRESOLVED";
    row.reasons.push("row has content but no valid Solana wallet address (identity uncertain)");
    return;
  }
  if (needsMint && !hasMint) {
    row.importStatus = "UNRESOLVED";
    row.reasons.push("row has content but no valid Solana mint address (identity uncertain)");
    return;
  }
  if (row.entityKind === "data_quality") {
    row.importStatus = "PENDING";
    return;
  }
  row.importStatus = "PENDING";
}

export function parseWorkbook(path: string): ParsedWorkbook {
  const buf = readFileSync(path);
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const wb = XLSX.read(buf, { cellDates: true });

  const sheets: ParsedSheet[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      blankrows: false,
      defval: null,
    });
    if (aoa.length === 0) {
      sheets.push({ name: sheetName, entityKind: "unknown", headers: [], resolvedColumns: {}, unmappedHeaders: [], rows: [] });
      continue;
    }

    const headerRowIdx = findHeaderRow(aoa);
    const rawHeaders = (aoa[headerRowIdx] ?? []).map((h, i) =>
      h === null || String(h).trim() === "" ? `col_${i}` : String(h).trim(),
    );
    const entityKind = detectEntityKind(sheetName, rawHeaders);
    const cols = resolveColumns(rawHeaders);
    const mappedHeaderSet = new Set(Object.values(cols));
    const unmappedHeaders = rawHeaders.filter((h) => !mappedHeaderSet.has(h) && !h.startsWith("col_"));

    const rows: StagedRow[] = [];
    const seenIdentity = new Map<string, number>(); // identity -> first row_index (intra-file dup)

    for (let r = headerRowIdx + 1; r < aoa.length; r++) {
      const arr = aoa[r] ?? [];
      const rowObj: Record<string, unknown> = {};
      rawHeaders.forEach((h, i) => {
        rowObj[h] = arr[i] ?? null;
      });

      const mint = cleanAddress(readField(rowObj, cols, "mint"));
      const poolAddress = cleanAddress(readField(rowObj, cols, "poolAddress"));
      const walletAddress =
        cleanAddress(readField(rowObj, cols, "walletAddress")) ??
        cleanAddress(readField(rowObj, cols, "deployerAddress")) ??
        cleanAddress(readField(rowObj, cols, "funderAddress"));
      const discovery = cleanTimestamp(readField(rowObj, cols, "discoveryAt"));
      const sourceRef = cleanString(readField(rowObj, cols, "sourceRef"));

      const mapped: Record<string, unknown> = {};
      for (const field of Object.keys(cols) as CanonicalField[]) {
        const val = cleanString(readField(rowObj, cols, field));
        if (val !== undefined) mapped[field] = val;
      }

      const staged: StagedRow = {
        sheetName,
        rowIndex: r - headerRowIdx, // 1-based data row
        entityKind,
        mint,
        poolAddress,
        walletAddress,
        discoveryAt: discovery?.toISOString(),
        sourceRef,
        mapped,
        rawImportPayload: rowObj,
        importStatus: "PENDING",
        reasons: [],
      };

      classify(staged);

      // Intra-file duplicate identity detection → CONFLICTING (only for otherwise-promotable rows).
      if (staged.importStatus === "PENDING") {
        const identity =
          staged.entityKind === "candidate" || staged.entityKind === "observation"
            ? `${staged.mint ?? ""}|${staged.poolAddress ?? ""}`
            : staged.walletAddress ?? "";
        if (identity && seenIdentity.has(identity)) {
          staged.importStatus = "CONFLICTING";
          staged.reasons.push(
            `duplicate identity within file (first at data row ${seenIdentity.get(identity)})`,
          );
        } else if (identity) {
          seenIdentity.set(identity, staged.rowIndex);
        }
      }

      rows.push(staged);
    }

    sheets.push({ name: sheetName, entityKind, headers: rawHeaders, resolvedColumns: cols, unmappedHeaders, rows });
  }

  return { sourceFile: path, sha256, sheets };
}
