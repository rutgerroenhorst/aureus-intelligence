import "server-only";
import pg from "pg";

const { Pool } = pg;

// Single pool per server process. Prefer the read-only role when provided.
const connectionString =
  process.env.DATABASE_URL_READONLY ??
  process.env.DATABASE_URL ??
  "postgres://aureus:aureus@localhost:5432/aureus";

declare global {
  // eslint-disable-next-line no-var
  var __aureusPool: pg.Pool | undefined;
}

export const pool: pg.Pool =
  global.__aureusPool ??
  new Pool({
    connectionString,
    max: 5,
    // Without these a stopped Postgres container makes every request HANG rather
    // than fail: the connect attempt never times out, so pages spin forever and the
    // health probe never resolves. Fail fast so the UI can say what is wrong.
    connectionTimeoutMillis: 3_000,
    query_timeout: 10_000,
    statement_timeout: 15_000,
  });
if (process.env.NODE_ENV !== "production") global.__aureusPool = pool;

// An idle client dropped by a restarting container emits an error on the pool. Left
// unhandled that takes the whole Node process down.
pool.on("error", (err) => {
  console.error("[db] idle client error:", err.message);
});

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

/**
 * A query allowed to take longer than the default 10s.
 *
 * For genuinely heavy ANALYTICAL work only — never for the board. /validation aggregates
 * forward outcomes across every candidate ever tracked and legitimately takes ~14s; it
 * was returning 500s not because anything was broken but because it shares a timeout
 * with queries that must stay sub-second.
 *
 * Paired with `export const revalidate` on the page, so the cost is paid about once a
 * minute rather than on every request. Raising the GLOBAL timeout instead would have
 * hidden real regressions on the pages where 10s means something is wrong.
 */
export async function pingDb(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
