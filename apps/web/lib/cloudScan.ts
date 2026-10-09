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
/** A job that never reports back (function killed) blocks the next one for at most this long. */
const LEASE_TTL_MIN = { scan: 6, learning: 4, suggestions: 3 } as const;
/** After a failed run, try again sooner than the normal interval. */
const RETRY_AFTER_FAILURE_MIN = 2;

export type Job = keyof typeof LEASE_TTL_MIN;
const LEASE_NAME: Record<Job, string> = { scan: "cloud-scan", learning: "learning", suggestions: "learning-suggestions" };
const EVERY_MIN: Record<Job, number> = { scan: SCAN_EVERY_MIN, learning: LEARNING_EVERY_MIN, suggestions: SUGGESTIONS_EVERY_MIN };

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

function dueFor(job: Job, row: LeaseRow | undefined, scannerAgeS: number | null): boolean {
  if (row?.running) return false;
  const wait = (failed(row?.last_result ?? null) ? RETRY_AFTER_FAILURE_MIN : EVERY_MIN[job]) * 60;
  if (row?.since_finished_s != null && row.since_finished_s < wait) return false;
  // Somebody else is already scanning (laptop worker, scheduled job): this site does not need to.
  if (job === "scan" && scannerAgeS != null && scannerAgeS < SCAN_EVERY_MIN * 60) return false;
  return true;
}

/** What the shell needs to know: when the data is from, and whether a tick should be requested. */
export async function getScanState(): Promise<ScanState> {
  const [{ rows: leases }, { rows: hb }] = await Promise.all([
    query(
      `SELECT name, locked_until > now() AS running,
              EXTRACT(EPOCH FROM (now() - last_finished))::float AS since_finished_s,
              last_finished, last_result
         FROM scan_lease`,
    ) as Promise<{ rows: LeaseRow[] }>,
    query(`SELECT MAX(last_cycle_at) AS at, EXTRACT(EPOCH FROM (now() - MAX(last_cycle_at)))::float AS age_s FROM worker_heartbeats`),
  ]);
  const scannerAgeS: number | null = hb[0]?.age_s ?? null;
  const row = (job: Job) => leases.find((l) => l.name === LEASE_NAME[job]);
  const state = (job: Job): JobState => {
    const r = row(job);
    return {
      running: Boolean(r?.running),
      due: dueFor(job, r, scannerAgeS),
      lastFinishedAt: r?.last_finished ? new Date(r.last_finished).toISOString() : null,
      lastResult: r?.last_result ?? null,
    };
  };
  return {
    lastScanAt: hb[0]?.at ? new Date(hb[0].at).toISOString() : null,
    everyMin: SCAN_EVERY_MIN,
    scan: state("scan"),
    learning: state("learning"),
  };
}

/**
 * Take the lease for a job. Atomic: of several callers asking at once exactly one gets true. `force` skips only
 * the minimum-interval check (never a lease that is still held).
 */
export async function claim(job: Job, force = false): Promise<boolean> {
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
    [LEASE_NAME[job], LEASE_TTL_MIN[job], EVERY_MIN[job], force, RETRY_AFTER_FAILURE_MIN],
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
  console.log(JSON.stringify({ msg: `scan job ${job}`, ...result }));
  return result;
}

/** One market scan (the worker's own cycle), exactly as the laptop worker does it. */
export function runScan(): Promise<Record<string, unknown>> {
  return guarded("scan", async () => {
    // These must be set BEFORE the worker module is first imported: it reads them at load time.
    process.env.AUREUS_EMBEDDED = "1";
    process.env.WORKER_ID ||= process.env.VERCEL ? "vercel-scan" : "web-scan";
    const { scanOnce } = await import("../../worker/src/run");
    const scan = await scanOnce();
    if (!scan.ok) throw new Error(scan.reason ?? "scan failed");
    return { ...scan.stats };
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
