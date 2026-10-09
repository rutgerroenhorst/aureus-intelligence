import type { Pool } from "pg";
import type { Source } from "@aureus/contracts";

export type NotebookEntryType =
  | "discovery" | "wallet_event" | "funding" | "liquidity"
  | "rule_transition" | "alert" | "note" | "outcome" | "lesson";

export interface NotebookEntry {
  entryType: NotebookEntryType;
  atMs: number;
  source?: Source;
  detail?: Record<string, unknown>;
  note?: string;
}

/**
 * Append one entry to a candidate's research notebook. The per-candidate `seq` is
 * assigned monotonically inside a transaction so the timeline is total-ordered and
 * append-only (the table blocks UPDATE/DELETE).
 */
export async function appendNotebookEntry(pool: Pool, candidateId: string, entry: NotebookEntry): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize seq assignment per candidate with a transaction-scoped advisory
    // lock (FOR UPDATE cannot be combined with an aggregate).
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [candidateId]);
    const { rows } = await client.query<{ next: string }>(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM research_notebook_entries WHERE candidate_id = $1`,
      [candidateId],
    );
    const seq = Number(rows[0]!.next);
    await client.query(
      `INSERT INTO research_notebook_entries (candidate_id, seq, entry_type, at, source, detail, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        candidateId, seq, entry.entryType, new Date(entry.atMs).toISOString(),
        entry.source ?? null, JSON.stringify(entry.detail ?? {}), entry.note ?? null,
      ],
    );
    await client.query("COMMIT");
    return seq;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface NotebookRow {
  seq: number;
  entryType: string;
  at: string;
  source: string | null;
  detail: Record<string, unknown>;
  note: string | null;
}

export async function readNotebook(pool: Pool, candidateId: string): Promise<NotebookRow[]> {
  const { rows } = await pool.query(
    `SELECT seq, entry_type AS "entryType", at, source, detail, note
       FROM research_notebook_entries WHERE candidate_id = $1 ORDER BY seq`,
    [candidateId],
  );
  return rows as NotebookRow[];
}
