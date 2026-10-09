/**
 * Asynchronous enrichment queue. Decouples slow/failing Helius work from the
 * discovery + market pipeline.
 *
 * FAIRNESS FIX: each job type has its OWN Redis ZSET, so REEVALUATE jobs can never
 * be starved by a backlog of HELIUS_ENRICHMENT jobs (the old single-ZSET design
 * sorted "HELIUS…" before "REEVALUATE…" lexicographically and never surfaced
 * reevaluations under LIMIT). The drain claims each type separately.
 *
 * Guarantees: idempotent enqueue (one in-flight job per type+candidate), a
 * per-(type, candidate) lock so a job never runs twice concurrently AND an
 * enrichment job never blocks the reevaluation of the same candidate, delayed
 * retries with exponential backoff + jitter, and dead-lettering past the budget.
 */
import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";

export const JOB_TYPES = ["DISCOVERY_SCAN", "MARKET_REFRESH", "HELIUS_ENRICHMENT", "REEVALUATE_CANDIDATE"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export interface Job {
  id: string;
  type: JobType;
  candidateId: string;
  attempts: number;
}

export const MAX_ATTEMPTS = Number(process.env.ENRICHMENT_MAX_ATTEMPTS ?? 5);

export interface QueueStats {
  enqueued: number;
  duplicateEnqueue: number;
  claimed: number;
  completed: number;
  retried: number;
  deadLettered: number;
}
const zeroStats = (): QueueStats => ({ enqueued: 0, duplicateEnqueue: 0, claimed: 0, completed: 0, retried: 0, deadLettered: 0 });

export function backoffMs(attempts: number, base = 2000, max = 120_000, jitterSeed = 0): number {
  const raw = Math.min(max, base * 2 ** attempts);
  const jitter = raw * 0.25 * ((jitterSeed % 1000) / 1000);
  return Math.round(raw + jitter);
}

export interface EnrichmentQueue {
  /** `priority` becomes the queue score: LOWER is claimed first. Both queues order by
   *  score, so passing a pair's age in hours makes fresh coins jump the backlog — which
   *  is the whole point of a strategy built on being early. Defaults to 0 (FIFO). */
  enqueue(type: JobType, candidateId: string, priority?: number): Promise<boolean>;
  claimDue(type: JobType, nowMs: number, max: number): Promise<Job[]>;
  ack(job: Job): Promise<void>;
  retry(job: Job, nowMs: number): Promise<"retried" | "deadlettered">;
  depth(): Promise<number>;
  depthByType(): Promise<Record<string, number>>;
  oldestPendingAgeMs(nowMs: number): Promise<number | null>;
  stats(): QueueStats;
  uniqueQueued(): Promise<number>;
}

const dedupKey = (t: JobType, c: string) => `${t}:${c}`;

// ── In-memory (tests) ────────────────────────────────────────────────────────
export class InMemoryQueue implements EnrichmentQueue {
  private z = new Map<JobType, Map<string, { job: Job; availableAt: number }>>();
  private dedup = new Set<string>();
  private locks = new Set<string>(); // `${type}:${candidateId}`
  private counters = zeroStats();
  public deadLettered: Job[] = [];

  private zt(t: JobType) { let m = this.z.get(t); if (!m) { m = new Map(); this.z.set(t, m); } return m; }

  async enqueue(type: JobType, candidateId: string, priority = 0): Promise<boolean> {
    const k = dedupKey(type, candidateId);
    if (this.dedup.has(k)) { this.counters.duplicateEnqueue++; return false; }
    this.dedup.add(k);
    this.zt(type).set(candidateId, { job: { id: randomUUID(), type, candidateId, attempts: 0 }, availableAt: priority });
    this.counters.enqueued++;
    return true;
  }
  async claimDue(type: JobType, nowMs: number, max: number): Promise<Job[]> {
    const out: Job[] = [];
    for (const [cid, e] of [...this.zt(type).entries()].sort((a, b) => a[1].availableAt - b[1].availableAt)) {
      if (out.length >= max) break;
      if (e.availableAt > nowMs) continue;
      const lk = dedupKey(type, cid);
      if (this.locks.has(lk)) continue;
      this.locks.add(lk);
      this.zt(type).delete(cid);
      out.push(e.job);
      this.counters.claimed++;
    }
    return out;
  }
  async ack(job: Job): Promise<void> {
    this.dedup.delete(dedupKey(job.type, job.candidateId));
    this.locks.delete(dedupKey(job.type, job.candidateId));
    this.counters.completed++;
  }
  async retry(job: Job, nowMs: number): Promise<"retried" | "deadlettered"> {
    this.locks.delete(dedupKey(job.type, job.candidateId));
    const attempts = job.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      this.dedup.delete(dedupKey(job.type, job.candidateId));
      this.deadLettered.push({ ...job, attempts });
      this.counters.deadLettered++;
      return "deadlettered";
    }
    this.zt(job.type).set(job.candidateId, { job: { ...job, attempts }, availableAt: nowMs + backoffMs(attempts) });
    this.counters.retried++;
    return "retried";
  }
  async depth(): Promise<number> { let n = 0; for (const m of this.z.values()) n += m.size; return n; }
  async depthByType(): Promise<Record<string, number>> { const o: Record<string, number> = {}; for (const [t, m] of this.z) o[t] = m.size; return o; }
  async oldestPendingAgeMs(nowMs: number): Promise<number | null> {
    let oldest: number | null = null;
    for (const m of this.z.values()) for (const e of m.values()) if (e.availableAt <= nowMs) oldest = Math.min(oldest ?? Infinity, e.availableAt);
    return oldest == null ? null : nowMs - oldest;
  }
  stats(): QueueStats { return { ...this.counters }; }
  async uniqueQueued(): Promise<number> { return this.dedup.size; }
}

// ── Redis (production) — one ZSET per job type ──────────────────────────────
export class RedisQueue implements EnrichmentQueue {
  private counters = zeroStats();
  constructor(private redis: Redis, private prefix = "aureus:enrich", private lockTtlMs = 120_000) {}
  private q = (t: JobType) => `${this.prefix}:z:${t}`;
  private dedup = () => `${this.prefix}:dedup`;
  private lock = (t: JobType, c: string) => `${this.prefix}:lock:${t}:${c}`;

  async enqueue(type: JobType, candidateId: string, priority = 0): Promise<boolean> {
    const added = await this.redis.sadd(this.dedup(), dedupKey(type, candidateId));
    if (added === 0) { this.counters.duplicateEnqueue++; return false; }
    await this.redis.zadd(this.q(type), priority, JSON.stringify({ id: randomUUID(), type, candidateId, attempts: 0 }));
    this.counters.enqueued++;
    return true;
  }
  async claimDue(type: JobType, nowMs: number, max: number): Promise<Job[]> {
    const members = await this.redis.zrangebyscore(this.q(type), "-inf", nowMs, "LIMIT", 0, max * 4);
    const out: Job[] = [];
    for (const m of members) {
      if (out.length >= max) break;
      const job = JSON.parse(m) as Job;
      const got = await this.redis.set(this.lock(type, job.candidateId), "1", "PX", this.lockTtlMs, "NX");
      if (got !== "OK") continue;
      await this.redis.zrem(this.q(type), m);
      out.push(job);
      this.counters.claimed++;
    }
    return out;
  }
  async ack(job: Job): Promise<void> {
    await this.redis.srem(this.dedup(), dedupKey(job.type, job.candidateId));
    await this.redis.del(this.lock(job.type, job.candidateId));
    this.counters.completed++;
  }
  async retry(job: Job, nowMs: number): Promise<"retried" | "deadlettered"> {
    await this.redis.del(this.lock(job.type, job.candidateId));
    const attempts = job.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await this.redis.srem(this.dedup(), dedupKey(job.type, job.candidateId));
      this.counters.deadLettered++;
      return "deadlettered";
    }
    await this.redis.zadd(this.q(job.type), nowMs + backoffMs(attempts), JSON.stringify({ ...job, attempts }));
    this.counters.retried++;
    return "retried";
  }
  async depth(): Promise<number> {
    let n = 0;
    for (const t of JOB_TYPES) n += await this.redis.zcard(this.q(t));
    return n;
  }
  async depthByType(): Promise<Record<string, number>> {
    const o: Record<string, number> = {};
    for (const t of JOB_TYPES) { const c = await this.redis.zcard(this.q(t)); if (c > 0) o[t] = c; }
    return o;
  }
  async oldestPendingAgeMs(nowMs: number): Promise<number | null> {
    let oldest: number | null = null;
    for (const t of JOB_TYPES) {
      const r = await this.redis.zrangebyscore(this.q(t), "-inf", nowMs, "WITHSCORES", "LIMIT", 0, 1);
      if (r.length >= 2) oldest = Math.min(oldest ?? Infinity, Number(r[1]));
    }
    return oldest == null ? null : nowMs - oldest;
  }
  stats(): QueueStats { return { ...this.counters }; }
  async uniqueQueued(): Promise<number> { return this.redis.scard(this.dedup()); }
}
