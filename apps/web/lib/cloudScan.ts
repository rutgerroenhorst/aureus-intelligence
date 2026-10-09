import { getPool } from "@aureus/db";

/**
 * Keeps the data fresh without a machine of its own: the site scans the market itself, but only when
 * somebody has it open (the shell asks for a tick once the data is older than SCAN_EVERY_MINUTES).
 * Nothing runs while the site is closed, which is also what keeps it inside the free Vercel limits.
 *
 * Every job is guarded by a row in scan_lease, so two devices (phone + iPad) or two serverless instances
 * can never run the same job at once, and a job that dies frees itself when its lease expires.
 */

export const SCAN_EVERY_MIN = Number(process.env.SCAN_EVERY_MINUTES ?? 10);
export const LEARNING_EVERY_MIN = Number(process.env.LEARNING_EVERY_MINUTES ?? 5);
export const SUGGESTIONS_EVERY_MIN = 60;
/**
 * History older than this many days is removed from the big append-only tables (migration 0026, prune_history).
 * Unset (0) = never prune: the laptop database is the full research record and must not set it. The Vercel project
 * sets it, because the free database holds 500 MB and every coin evaluation writes about 8 KB.
 */
export const RETENTION_DAYS = Number(process.env.RETENTION_DAYS ?? 0);
const RETENTION_EVERY_MIN = 360;
/**
 * Last line of defence for the free database: past this size scanning pauses instead of filling the disk (a full
 * Supabase Free project turns read-only). Deleted rows are reused, not returned to the OS, so this is the size of the
 * files, which is what the quota counts too.
 */
const STORAGE_LIMIT_MB = Number(process.env.SCAN_STORAGE_LIMIT_MB ?? 440);
/** A job that never reports back (function killed) blocks the next one for at most this long. */
const LEASE_TTL_MIN = { scan: 6, learning: 4, suggestions: 3, retention: 5 } as const;
/** After a failed run, try again sooner than the normal interval. */
const RETRY_AFTER_FAILURE_MIN = 2;
/**
 * Vercel Hobby allows 4 CPU-hours a month and blocks the project for 30 days beyond that, so a screen left open
 * 24/7 must not be able to spend it. Scans count their own CPU per UTC day; past this many seconds the interval
 * stretches (x4) and catch-up rounds stop until the next day. The default leaves room for the pages' own requests.
 */
const CPU_BUDGET_S_PER_DAY = Number(process.env.SCAN_CPU_BUDGET_S_PER_DAY ?? 300);
const OVER_BUDGET_INTERVAL_FACTOR = 4;
const TODAY = `'usage:' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

export type Job = keyof typeof LEASE_TTL_MIN;
const LEASE_NAME: Record<Job, string> = { scan: "cloud-scan", learning: "learning", suggestions: "learning-suggestions", retention: "retention" };
const EVERY_MIN: Record<Job, number> = { scan: SCAN_EVERY_MIN, learning: LEARNING_EVERY_MIN, suggestions: SUGGESTIONS_EVERY_MIN, retention: RETENTION_EVERY_MIN };

export interface JobState {
  running: boolean;
  due: boolean;
  lastFinishedAt: string | null;
  lastResult: Record<string, unknown> | null;
}

export interface ScanState {
  /** newest cycle of ANY scanner (this site, the laptop worker, a scheduled job) */
  lastScanAt: string | null;
  everyMin: number;
  scan: JobState;
  learning: JobState;
  /** CPU the site's own scans used today (UTC) against the daily allowance */
  budget: { usedS: number; limitS: number; over: boolean };
  /** database size against the point where scanning pauses */
  storage: { usedMb: number; limitMb: number; full: boolean };
}

interface LeaseRow {
  name: string;
  running: boolean;
  since_finished_s: number | null;
  last_finished: Date | null;
  last_result: Record<string, unknown> | null;
}

const failed = (r: Record<string, unknown> | null) => r != null && r.ok === false;

/**
 * The lease queries are what decide whether a scan starts, and a serverless instance's first connection after
 * idling occasionally dies while connecting. One retry on a connection-level error is cheap; anything else is real.
 */
const transient = (e: unknown) => /connection terminated|timeout exceeded|econnreset|etimedout|terminating connection/i.test(String((e as Error)?.message ?? e));
async function query(text: string, params?: unknown[]) {
  try {
    return await getPool().query(text, params);
  } catch (err) {
    if (!transient(err)) throw err;
    await new Promise((r) => setTimeout(r, 400));
    return getPool().query(text, params);
  }
}

function dueFor(job: Job, row: LeaseRow | undefined, scannerAgeS: number | null, overBudget: boolean, storageFull: boolean): boolean {
  if (row?.running) return false;
  if (job === "scan" && storageFull) return false;
  const every = EVERY_MIN[job] * (job === "scan" && overBudget ? OVER_BUDGET_INTERVAL_FACTOR : 1);
  const wait = (failed(row?.last_result ?? null) ? RETRY_AFTER_FAILURE_MIN : every) * 60;
  if (row?.since_finished_s != null && row.since_finished_s < wait) return false;
  // Somebody else is already scanning (laptop worker, scheduled job): this site does not need to.
  if (job === "scan" && scannerAgeS != null && scannerAgeS < SCAN_EVERY_MIN * 60 * (overBudget ? OVER_BUDGET_INTERVAL_FACTOR : 1)) return false;
  return true;
}

/** Size of the database in MB. */
async function databaseMb(): Promise<number> {
  const { rows } = await query(`SELECT pg_database_size(current_database())::float / 1048576 AS mb`);
  return Number(rows[0]?.mb ?? 0);
}

/** CPU milliseconds the site's scans have used today (UTC). */
async function usedTodayMs(): Promise<number> {
  const { rows } = await query(`SELECT COALESCE((last_result->>'cpuMs')::bigint, 0) AS cpu_ms FROM scan_lease WHERE name = ${TODAY}`);
  return Number(rows[0]?.cpu_ms ?? 0);
}

async function addUsage(cpuMs: number): Promise<void> {
  try {
    await query(
      `INSERT INTO scan_lease (name, locked_until, last_result)
       VALUES (${TODAY}, 'epoch', jsonb_build_object('cpuMs', $1::bigint, 'runs', 1))
       ON CONFLICT (name) DO UPDATE SET last_result = jsonb_build_object(
         'cpuMs', COALESCE((scan_lease.last_result->>'cpuMs')::bigint, 0) + $1::bigint,
         'runs',  COALESCE((scan_lease.last_result->>'runs')::int, 0) + 1)`,
      [Math.max(0, Math.round(cpuMs))],
    );
  } catch (err) {
    console.error("[scan] could not record CPU usage", err);
  }
}

/** What the shell needs to know: when the data is from, and whether a tick should be requested. */
export async function getScanState(): Promise<ScanState> {
  const [{ rows: leases }, used, mb, { rows: hb }] = await Promise.all([
    query(
      `SELECT name, locked_until > now() AS running,
              EXTRACT(EPOCH FROM (now() - last_finished))::float AS since_finished_s,
              last_finished, last_result
         FROM scan_lease WHERE name NOT LIKE 'usage:%'`,
    ) as Promise<{ rows: LeaseRow[] }>,
    usedTodayMs(),
    databaseMb(),
    query(`SELECT MAX(last_cycle_at) AS at, EXTRACT(EPOCH FROM (now() - MAX(last_cycle_at)))::float AS age_s FROM worker_heartbeats`),
  ]);
  const scannerAgeS: number | null = hb[0]?.age_s ?? null;
  const overBudget = used / 1000 >= CPU_BUDGET_S_PER_DAY;
  const storageFull = mb >= STORAGE_LIMIT_MB;
  const row = (job: Job) => leases.find((l) => l.name === LEASE_NAME[job]);
  const state = (job: Job): JobState => {
    const r = row(job);
    return {
      running: Boolean(r?.running),
      due: dueFor(job, r, scannerAgeS, overBudget, storageFull),
      lastFinishedAt: r?.last_finished ? new Date(r.last_finished).toISOString() : null,
      lastResult: r?.last_result ?? null,
    };
  };
  return {
    lastScanAt: hb[0]?.at ? new Date(hb[0].at).toISOString() : null,
    everyMin: SCAN_EVERY_MIN,
    scan: state("scan"),
    learning: state("learning"),
    budget: { usedS: Math.round(used / 1000), limitS: CPU_BUDGET_S_PER_DAY, over: overBudget },
    storage: { usedMb: Math.round(mb), limitMb: STORAGE_LIMIT_MB, full: storageFull },
  };
}

/**
 * Take the lease for a job. Atomic: of several callers asking at once exactly one gets true. `force` skips only
 * the minimum-interval check (never a lease that is still held).
 */
export async function claim(job: Job, force = false): Promise<boolean> {
  if (job === "scan" && !force && (await databaseMb()) >= STORAGE_LIMIT_MB) return false;
  const every =
    EVERY_MIN[job] * (job === "scan" && !force && (await usedTodayMs()) / 1000 >= CPU_BUDGET_S_PER_DAY ? OVER_BUDGET_INTERVAL_FACTOR : 1);
  const { rows } = await query(
    `INSERT INTO scan_lease (name, locked_until, last_started)
     VALUES ($1, now() + make_interval(mins => $2::int), now())
     ON CONFLICT (name) DO UPDATE
        SET locked_until = EXCLUDED.locked_until, last_started = EXCLUDED.last_started
      WHERE scan_lease.locked_until < now()
        AND ($4::boolean
             OR scan_lease.last_finished IS NULL
             OR scan_lease.last_finished < now() - make_interval(mins =>
                  CASE WHEN scan_lease.last_result->>'ok' = 'false' THEN $5::int ELSE $3::int END))
     RETURNING name`,
    [LEASE_NAME[job], LEASE_TTL_MIN[job], every, force, RETRY_AFTER_FAILURE_MIN],
  );
  return rows.length > 0;
}

async function release(job: Job, result: Record<string, unknown>): Promise<void> {
  try {
    await query(
      `UPDATE scan_lease SET locked_until = now(), last_finished = now(), last_result = $2::jsonb WHERE name = $1`,
      [LEASE_NAME[job], JSON.stringify(result)],
    );
  } catch (err) {
    // Not fatal: the lease frees itself when its TTL passes.
    console.error("[scan] could not release lease", job, err);
  }
}

/** Run a job whose lease is already held, always reporting back so the lease is freed. */
async function guarded(job: Job, work: () => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
  const t0 = Date.now();
  const cpu0 = process.cpuUsage();
  let result: Record<string, unknown>;
  try {
    result = { ok: true, ...(await work()) };
  } catch (err) {
    result = { ok: false, error: String((err as Error)?.message ?? err).slice(0, 300) };
    console.error(`[scan] ${job} failed`, err);
  }
  const cpu = process.cpuUsage(cpu0);
  result.ms = Date.now() - t0;
  // Active CPU is what Vercel's free allowance is counted in, so it is measured on every run.
  result.cpuMs = Math.round((cpu.user + cpu.system) / 1000);
  result.at = new Date().toISOString();
  await release(job, result);
  // "suggestions" runs inside "learning", whose measurement already includes it.
  if (job !== "suggestions") await addUsage(Number(result.cpuMs));
  console.log(JSON.stringify({ msg: `scan job ${job}`, ...result }));
  return result;
}

/** After a long absence many coins are overdue; keep scanning back to back, but never longer than this. */
const CATCHUP_ROUNDS = Number(process.env.SCAN_CATCHUP_ROUNDS ?? 3);
const CATCHUP_BUDGET_MS = 120_000;

/**
 * One market scan (the worker's own cycle), exactly as the laptop worker does it. One cycle handles at most
 * MAX_CANDIDATES_PER_CYCLE coins, so when the site has been closed for hours and more are overdue than fit, it keeps
 * going for a few more rounds (each takes a few seconds) so the first screen you open is not hours behind.
 */
export function runScan(): Promise<Record<string, unknown>> {
  return guarded("scan", async () => {
    // These must be set BEFORE the worker module is first imported: it reads them at load time.
    process.env.AUREUS_EMBEDDED = "1";
    process.env.WORKER_ID ||= process.env.VERCEL ? "vercel-scan" : "web-scan";
    const { scanOnce } = await import("../../worker/src/run");
    const t0 = Date.now();
    const total = { rounds: 0, candidates: 0, fresh: 0, errors: 0, discovered: 0, due: 0 };
    const rounds = (await usedTodayMs()) / 1000 >= CPU_BUDGET_S_PER_DAY ? 1 : CATCHUP_ROUNDS;
    for (let round = 0; round < rounds; round++) {
      const scan = await scanOnce();
      if (!scan.ok) {
        if (round === 0) throw new Error(scan.reason ?? "scan failed");
        break;
      }
      const s = scan.stats!;
      total.rounds++;
      total.candidates += s.candidates;
      total.fresh += s.fresh;
      total.errors += s.errors;
      total.discovered += s.discovered;
      total.due = s.due;
      const moreWaiting = s.due >= s.cap;
      const failing = s.errors > 0 && s.errors >= s.candidates / 2;
      if (!moreWaiting || failing || Date.now() - t0 > CATCHUP_BUDGET_MS) break;
    }
    return total;
  });
}

/** Track new qualifiers, re-measure open coins, and (hourly) regenerate the filter suggestions. */
export function runLearning(): Promise<Record<string, unknown>> {
  return guarded("learning", async () => {
    const { trackQualified, updateOutcomes } = await import("./learning-engine");
    // Outcomes first: a failed tracking step must not stop open coins from being graded.
    const outcomes = await updateOutcomes().catch((e) => ({ error: String(e?.message ?? e) }));
    const tracked = await trackQualified().catch((e) => ({ error: String(e?.message ?? e) }));
    let suggestions: Record<string, unknown> | undefined;
    if (await claim("suggestions")) {
      suggestions = await guarded("suggestions", async () => {
        const { generateSuggestions } = await import("./learning-engine");
        return { ...(await generateSuggestions()) };
      });
    }
    if ("error" in outcomes && "error" in tracked) throw new Error(`${outcomes.error}; ${tracked.error}`);
    return { tracked, outcomes, suggestions };
  });
}

/**
 * Remove history older than RETENTION_DAYS (prune_history, migration 0026). A no-op unless RETENTION_DAYS is set.
 * One transaction with its own statement timeout: the function lifts the "immutable" guard on two tables for its
 * duration, so it must not be cut off half way by the pool's 5 s default (a cut-off rolls everything back, guard
 * included, but would never finish).
 */
export function runRetention(): Promise<Record<string, unknown>> {
  return guarded("retention", async () => {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '45s'");
      const { rows } = await client.query("SELECT prune_history($1::int) AS removed", [RETENTION_DAYS]);
      await client.query("COMMIT");
      return { removed: rows[0]?.removed ?? null, keepDays: RETENTION_DAYS };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });
}
