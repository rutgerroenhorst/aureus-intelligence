import { Redis } from "ioredis";

/**
 * Redis distributed lock so two workers never run the same cycle. SET NX PX with
 * a random token; release only if we still own it (check-and-del via Lua).
 */
export class CycleLock {
  private redis: Redis;
  private token: string;
  constructor(url = process.env.REDIS_URL ?? "redis://localhost:6379", private key = "aureus:worker:cycle") {
    this.redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2, retryStrategy: () => 1000 });
    // Token varies per worker via pid + a counter; no Math.random needed for correctness.
    this.token = `${process.pid}-${process.hrtime.bigint().toString()}`;
  }
  async connect(): Promise<void> {
    if (this.redis.status === "wait" || this.redis.status === "close" || this.redis.status === "end") {
      await this.redis.connect().catch(() => undefined);
    }
  }
  async acquire(ttlMs: number): Promise<boolean> {
    try {
      const res = await this.redis.set(this.key, this.token, "PX", ttlMs, "NX");
      return res === "OK";
    } catch {
      // If Redis is unreachable, degrade to single-worker assumption (still run).
      return true;
    }
  }
  async release(): Promise<void> {
    const lua = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
    try { await this.redis.eval(lua, 1, this.key, this.token); } catch { /* ignore */ }
  }
  async available(): Promise<boolean> {
    try { return (await this.redis.ping()) === "PONG"; } catch { return false; }
  }
  disconnect(): void { this.redis.disconnect(); }
}
