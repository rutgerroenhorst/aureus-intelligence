/**
 * Legacy import orchestration.
 *
 * Flow: parseWorkbook (pure) → stageWorkbook (writes legacy.import_runs +
 * legacy.staged_rows) → optionally promoteRun (PENDING → canonical tables).
 * Dry-run stages + reports only; --commit also promotes. Unresolved rows are
 * never promoted; they remain visible as unresolved by design.
 */
import type { Pool } from "pg";
import { parseWorkbook, type ParsedWorkbook, type StagedRow } from "./parse.js";
import { buildReport, reportToMarkdown, type ImportReport } from "./report.js";

export * from "./parse.js";
export * from "./report.js";
export * from "./values.js";
export * from "./columns.js";
export * from "./detect.js";

export async function stageWorkbook(
  pool: Pool,
  wb: ParsedWorkbook,
  committed: boolean,
): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const run = await client.query<{ id: string }>(
      `INSERT INTO legacy.import_runs (source_file, file_sha256, committed)
       VALUES ($1, $2, $3) RETURNING id`,
      [wb.sourceFile, wb.sha256, committed],
    );
    const runId = run.rows[0]!.id;

    for (const sheet of wb.sheets) {
      for (const row of sheet.rows) {
        await client.query(
          `INSERT INTO legacy.staged_rows
            (run_id, sheet_name, row_index, entity_kind, mint, pool_address,
             wallet_address, discovery_at, source_ref, mapped, raw_import_payload,
             import_status, reasons)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            runId,
            row.sheetName,
            row.rowIndex,
            row.entityKind,
            row.mint ?? null,
            row.poolAddress ?? null,
            row.walletAddress ?? null,
            row.discoveryAt ?? null,
            row.sourceRef ?? null,
            JSON.stringify(row.mapped),
            JSON.stringify(row.rawImportPayload),
            row.importStatus,
            JSON.stringify(row.reasons),
          ],
        );
      }
    }
    await client.query("COMMIT");
    return runId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Promote all PENDING staged rows of a run into canonical tables. */
export async function promoteRun(pool: Pool, runId: string): Promise<void> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<StagedRow & { id: string }>(
      `SELECT id, sheet_name AS "sheetName", row_index AS "rowIndex",
              entity_kind AS "entityKind", mint, pool_address AS "poolAddress",
              wallet_address AS "walletAddress", discovery_at AS "discoveryAt",
              source_ref AS "sourceRef", mapped
         FROM legacy.staged_rows
        WHERE run_id = $1 AND import_status = 'PENDING'`,
      [runId],
    );

    for (const row of rows) {
      await client.query("BEGIN");
      try {
        const promoted = await promoteOne(client, row);
        await client.query(
          `UPDATE legacy.staged_rows SET import_status='IMPORTED', promoted_ref=$2 WHERE id=$1`,
          [row.id, JSON.stringify(promoted)],
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        await client.query(
          `UPDATE legacy.staged_rows
             SET import_status='CONFLICTING', reasons = reasons || $2::jsonb
           WHERE id=$1`,
          [row.id, JSON.stringify([`promotion failed: ${(err as Error).message}`])],
        );
      }
    }
    await client.query(
      `UPDATE legacy.import_runs SET committed=true, finished_at=now() WHERE id=$1`,
      [runId],
    );
  } finally {
    client.release();
  }
}

async function promoteOne(
  client: import("pg").PoolClient,
  row: StagedRow & { id: string },
): Promise<Record<string, unknown>> {
  const mapped = (row.mapped ?? {}) as Record<string, unknown>;

  const upsertWallet = async (address: string): Promise<string> => {
    const res = await client.query<{ id: string }>(
      `INSERT INTO wallet_entities (chain, address, label)
         VALUES ('solana', $1, $2)
       ON CONFLICT (chain, address) DO UPDATE SET label = COALESCE(wallet_entities.label, EXCLUDED.label)
       RETURNING id`,
      [address, (mapped.label as string) ?? null],
    );
    return res.rows[0]!.id;
  };
  const upsertToken = async (mint: string): Promise<string> => {
    const res = await client.query<{ id: string }>(
      `INSERT INTO tokens (chain, mint, symbol_label)
         VALUES ('solana', $1, $2)
       ON CONFLICT (chain, mint) DO UPDATE SET symbol_label = COALESCE(tokens.symbol_label, EXCLUDED.symbol_label)
       RETURNING id`,
      [mint, (mapped.label as string) ?? null],
    );
    return res.rows[0]!.id;
  };

  switch (row.entityKind) {
    case "wallet": {
      const id = await upsertWallet(row.walletAddress!);
      return { table: "wallet_entities", id };
    }
    case "blacklist": {
      const id = await upsertWallet(row.walletAddress!);
      await client.query(`UPDATE wallet_entities SET is_blacklisted=true WHERE id=$1`, [id]);
      return { table: "wallet_entities", id, blacklisted: true };
    }
    case "deployer_funding": {
      const walletId = await upsertWallet(row.walletAddress!);
      if (row.mint) {
        const tokenId = await upsertToken(row.mint);
        const dep = await client.query<{ id: string }>(
          `INSERT INTO deployers (wallet_id, token_id, source, evidence_status, raw_source_ref)
             VALUES ($1,$2,'manual','MANUAL',$3)
           ON CONFLICT (token_id, wallet_id) DO NOTHING RETURNING id`,
          [walletId, tokenId, row.sourceRef ?? null],
        );
        return { table: "deployers", id: dep.rows[0]?.id ?? null, walletId, tokenId };
      }
      return { table: "wallet_entities", id: walletId };
    }
    case "bundler": {
      if (!row.mint) throw new Error("bundler row without mint");
      const tokenId = await upsertToken(row.mint);
      const b = await client.query<{ id: string }>(
        `INSERT INTO launch_bundles (token_id, wallets, source, evidence_status, raw_source_ref)
           VALUES ($1, $2, 'manual', 'MANUAL', $3) RETURNING id`,
        [tokenId, JSON.stringify(mapped.bundleWallets ?? []), row.sourceRef ?? null],
      );
      return { table: "launch_bundles", id: b.rows[0]!.id, tokenId };
    }
    case "candidate": {
      const tokenId = await upsertToken(row.mint!);
      let poolId: string | null = null;
      if (row.poolAddress) {
        const p = await client.query<{ id: string }>(
          `INSERT INTO pools (chain, pool_address, token_id)
             VALUES ('solana', $1, $2)
           ON CONFLICT (chain, pool_address) DO UPDATE SET token_id = EXCLUDED.token_id
           RETURNING id`,
          [row.poolAddress, tokenId],
        );
        poolId = p.rows[0]!.id;
      }
      const code = `AUR-LEGACY-${row.mint!.slice(0, 8)}`;
      const cand = await client.query<{ id: string }>(
        `INSERT INTO candidates (candidate_code, token_id, pool_id, discovered_at, discovery_source, current_state)
           VALUES ($1,$2,$3,$4,'manual','UNRESOLVED')
         ON CONFLICT (candidate_code) DO NOTHING RETURNING id`,
        // preserve ORIGINAL discovery timestamp; fall back to now() only if absent
        [code, tokenId, poolId, row.discoveryAt ?? new Date().toISOString()],
      );
      const candId = cand.rows[0]?.id;
      if (candId) {
        // immutable discovery snapshot from the legacy row
        await client.query(
          `INSERT INTO discovery_snapshots (candidate_id, snapshot, source, observed_at)
             VALUES ($1, $2, 'manual', $3)
           ON CONFLICT (candidate_id) DO NOTHING`,
          [candId, JSON.stringify(mapped), row.discoveryAt ?? null],
        );
      }
      return { table: "candidates", id: candId ?? null, tokenId, poolId };
    }
    case "observation": {
      // observation needs a candidate; link by mint if one exists, else stage-only
      const cand = await client.query<{ id: string }>(
        `SELECT c.id FROM candidates c JOIN tokens t ON t.id=c.token_id
          WHERE t.mint=$1 ORDER BY c.discovered_at LIMIT 1`,
        [row.mint],
      );
      if (!cand.rows[0]) throw new Error("observation has no matching candidate (import candidate sheet first)");
      const o = await client.query<{ id: string }>(
        `INSERT INTO observations (candidate_id, kind, value, source, observed_at, evidence_status, raw_source_ref)
           VALUES ($1,'legacy_observation',$2,'manual',$3,'MANUAL',$4) RETURNING id`,
        [cand.rows[0].id, JSON.stringify(mapped), row.discoveryAt ?? null, row.sourceRef ?? null],
      );
      return { table: "observations", id: o.rows[0]!.id };
    }
    case "data_quality": {
      const d = await client.query<{ id: string }>(
        `INSERT INTO data_quality_issues (scope, kind, severity, detail, is_open)
           VALUES ($1,$2,$3,$4,true) RETURNING id`,
        [
          (mapped.dataQualityKind as string) ?? "legacy",
          (mapped.status as string) ?? "legacy",
          (mapped.severity as string)?.toUpperCase?.() && ["INFO","LOW","MEDIUM","HIGH","CRITICAL"].includes((mapped.severity as string).toUpperCase())
            ? (mapped.severity as string).toUpperCase()
            : "MEDIUM",
          JSON.stringify(mapped),
        ],
      );
      return { table: "data_quality_issues", id: d.rows[0]!.id };
    }
    default:
      throw new Error(`no promotion path for entity kind '${row.entityKind}'`);
  }
}

export interface RunImportResult {
  report: ImportReport;
  markdown: string;
  runId: string | null;
  parsed: ParsedWorkbook;
}

/** Parse + build report. Persist + promote when a pool is provided. */
export async function runImport(opts: {
  file: string;
  commit: boolean;
  generatedAt: string;
  pool?: Pool;
}): Promise<RunImportResult> {
  const parsed = parseWorkbook(opts.file);
  let runId: string | null = null;
  if (opts.pool) {
    runId = await stageWorkbook(opts.pool, parsed, opts.commit);
    if (opts.commit) await promoteRun(opts.pool, runId);
  }
  const report = buildReport(parsed, opts.commit, opts.generatedAt);
  return { report, markdown: reportToMarkdown(report), runId, parsed };
}
