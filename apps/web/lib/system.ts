import "server-only";
import Redis from "ioredis";
import { loadConfig } from "@aureus/config";

export async function pingRedis(): Promise<boolean> {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 800, retryStrategy: () => null });
  try {
    await client.connect();
    const pong = await client.ping();
    return pong === "PONG";
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}

export function sourceModes() {
  try {
    return loadConfig().modes;
  } catch {
    return { dexscreener: "LIVE", geckoterminal: "LIVE", helius: "DEGRADED", bubblemaps: "DEGRADED", fomo: "DEGRADED" } as const;
  }
}
