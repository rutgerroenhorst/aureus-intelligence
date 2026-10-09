import { Redis } from "ioredis";

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT) : 6379,
      db: 0,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      enableOfflineQueue: false,
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
    });

    redis.on("error", (err: Error) => {
      console.error("[REDIS] Connection error:", err);
    });
  }
  return redis;
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

/**
 * Decorator: Cache API results for N seconds
 * Uses time-bucketing to group cache hits efficiently
 *
 * Example:
 * const data = await withCache(
 *   "early-coins",
 *   () => expensiveQuery(),
 *   60  // cache for 60 seconds
 * )
 */
export async function withCache<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlSeconds: number = 60,
  bucketMinutes: number = 1
): Promise<T> {
  const redis = getRedis();

  // Time-bucket the key: same minute = same cache key
  const bucketKey = `${key}:${Math.floor(Date.now() / 1000 / 60 / bucketMinutes)}`;

  try {
    const cached = await redis.get(bucketKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (err) {
    console.error(`[CACHE] Get error for ${bucketKey}:`, err);
  }

  // Not in cache, fetch fresh data
  const data = await fetchFn();

  // Store in cache
  try {
    await redis.setex(bucketKey, ttlSeconds, JSON.stringify(data));
  } catch (err) {
    console.error(`[CACHE] Set error for ${bucketKey}:`, err);
    // Continue anyway - cache failure shouldn't break the API
  }

  return data;
}

/**
 * Invalidate a cache key pattern
 * Usage: await invalidateCache("early-coins*")
 */
export async function invalidateCache(pattern: string): Promise<number> {
  const redis = getRedis();
  const keys = await redis.keys(pattern);
  if (keys.length === 0) return 0;
  return redis.del(...keys);
}

/**
 * Warm up cache with precomputed data
 * Used for expensive queries that don't change often
 */
export async function warmCache(
  key: string,
  data: any,
  ttlSeconds: number = 3600
): Promise<void> {
  const redis = getRedis();
  const bucketKey = `${key}:${Math.floor(Date.now() / 1000 / 60)}`;

  try {
    await redis.setex(bucketKey, ttlSeconds, JSON.stringify(data));
  } catch (err) {
    console.error(`[CACHE] Warm error for ${bucketKey}:`, err);
  }
}

/**
 * Get cache stats for monitoring
 */
export async function getCacheStats(): Promise<{
  memory: string;
  keys: number;
  hits: string;
  misses: string;
}> {
  const redis = getRedis();

  try {
    const info = await redis.info("stats");
    const memInfo = await redis.info("memory");
    const keys = await redis.dbsize();

    return {
      memory: memInfo.split("\n").find((line: string) => line.startsWith("used_memory_human"))?.split(":")[1] || "N/A",
      keys: keys,
      hits: info.split("\n").find((line: string) => line.startsWith("keyspace_hits"))?.split(":")[1] || "0",
      misses: info.split("\n").find((line: string) => line.startsWith("keyspace_misses"))?.split(":")[1] || "0",
    };
  } catch (err) {
    console.error("[CACHE] Stats error:", err);
    return { memory: "N/A", keys: 0, hits: "0", misses: "0" };
  }
}

export type { Redis };
