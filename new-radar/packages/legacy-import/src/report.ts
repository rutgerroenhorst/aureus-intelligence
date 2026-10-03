/** Build the import report (imported / skipped / unresolved / conflicting). */
import type { ParsedWorkbook, StagedRow, ImportStatus } from "./parse.js";

export interface ImportReport {
  sourceFile: string;
  sha256: string;
  committed: boolean;
  generatedAt: string;
  totals: Record<ImportStatus | "IMPORTED", number>;
  bySheet: Array<{
    sheet: string;
    entityKind: string;
    rowCount: number;
    counts: Record<string, number>;
    unmappedHeaders: string[];
    resolvedColumns: Record<string, string>;
  }>;
  rowReasons: Array<{
    sheet: string;
    rowIndex: number;
    status: string;
    identity: string;
    reasons: string[];
  }>;
}

function emptyTotals(): Record<string, number> {
  return { PENDING: 0, IMPORTED: 0, SKIPPED: 0, UNRESOLVED: 0, CONFLICTING: 0 };
}

function identityOf(r: StagedRow): string {
  if (r.mint || r.poolAddress) return `mint:${r.mint ?? "-"} pool:${r.poolAddress ?? "-"}`;
  if (r.walletAddress) return `wallet:${r.walletAddress}`;
  return "(no identity)";
}

export function buildReport(
  wb: ParsedWorkbook,
  committed: boolean,
  generatedAt: string,
): ImportReport {
  const totals = emptyTotals();
  const bySheet: ImportReport["bySheet"] = [];
  const rowReasons: ImportReport["rowReasons"] = [];

  for (const sheet of wb.sheets) {
    const counts = emptyTotals();
    for (const row of sheet.rows) {
      const status = committed && row.importStatus === "PENDING" ? "IMPORTED" : row.importStatus;
      counts[status] = (counts[status] ?? 0) + 1;
      totals[status] = (totals[status] ?? 0) + 1;
      if (row.reasons.length > 0 || status !== "IMPORTED") {
        rowReasons.push({
          sheet: sheet.name,
          rowIndex: row.rowIndex,
          status,
          identity: identityOf(row),
          reasons: row.reasons,
        });
      }
    }
    bySheet.push({
      sheet: sheet.name,
      entityKind: sheet.entityKind,
      rowCount: sheet.rows.length,
      counts,
      unmappedHeaders: sheet.unmappedHeaders,
      resolvedColumns: sheet.resolvedColumns as Record<string, string>,
    });
  }

  return {
    sourceFile: wb.sourceFile,
    sha256: wb.sha256,
    committed,
    generatedAt,
    totals: totals as ImportReport["totals"],
    bySheet,
    rowReasons,
  };
}

export function reportToMarkdown(r: ImportReport): string {
  const lines: string[] = [];
  lines.push(`# Legacy import report`);
  lines.push("");
  lines.push(`- Source file: \`${r.sourceFile}\``);
  lines.push(`- SHA-256: \`${r.sha256}\``);
  lines.push(`- Mode: **${r.committed ? "COMMIT (promoted)" : "DRY-RUN (staged only)"}**`);
  lines.push(`- Generated: ${r.generatedAt}`);
  lines.push("");
  lines.push(`## Totals`);
  lines.push("");
  lines.push(`| Status | Rows |`);
  lines.push(`|---|---|`);
  for (const k of ["IMPORTED", "PENDING", "SKIPPED", "UNRESOLVED", "CONFLICTING"] as const) {
    lines.push(`| ${k} | ${r.totals[k] ?? 0} |`);
  }
  lines.push("");
  lines.push(`## By sheet`);
  lines.push("");
  for (const s of r.bySheet) {
    lines.push(`### ${s.sheet}  →  \`${s.entityKind}\`  (${s.rowCount} rows)`);
    const c = s.counts;
    lines.push(
      `IMPORTED=${c.IMPORTED ?? 0} PENDING=${c.PENDING ?? 0} SKIPPED=${c.SKIPPED ?? 0} ` +
        `UNRESOLVED=${c.UNRESOLVED ?? 0} CONFLICTING=${c.CONFLICTING ?? 0}`,
    );
    const mapped = Object.entries(s.resolvedColumns)
      .map(([k, v]) => `${k}←"${v}"`)
      .join(", ");
    lines.push(`Resolved columns: ${mapped || "(none)"}`);
    if (s.unmappedHeaders.length) lines.push(`Unmapped (kept in raw_import_payload): ${s.unmappedHeaders.join(", ")}`);
    lines.push("");
  }
  if (r.rowReasons.length) {
    lines.push(`## Rows needing attention (skipped / unresolved / conflicting)`);
    lines.push("");
    lines.push(`| Sheet | Row | Status | Identity | Reason |`);
    lines.push(`|---|---|---|---|---|`);
    for (const rr of r.rowReasons.filter((x) => x.status !== "IMPORTED")) {
      lines.push(`| ${rr.sheet} | ${rr.rowIndex} | ${rr.status} | ${rr.identity} | ${rr.reasons.join("; ")} |`);
    }
  }
  return lines.join("\n");
}
