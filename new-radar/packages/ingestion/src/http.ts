/**
 * HTTP client with rate limiting, retries, exponential backoff + jitter.
 * Honors 429/5xx as retryable; 4xx (except 429) as terminal. Uses the global
 * fetch (Node >= 18). The random jitter uses Math.random by design (spreads
 * retries); this module is not run inside deterministic workflow scripts.
 */
import { TokenBucketLimiter } from "./rateLimiter.js";

export interface HttpResponse {
  status: number;
  ok: boolean;
  json: unknown;
  text: string;
}

export interface HttpOptions {
  limiter?: TokenBucketLimiter;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly terminal: boolean,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export async function httpGet(url: string, opts: HttpOptions = {}): Promise<HttpResponse> {
  const maxRetries = opts.maxRetries ?? 4;
  const base = opts.baseDelayMs ?? 500;
  const max = opts.maxDelayMs ?? 15000;

  let attempt = 0;
  for (;;) {
    if (opts.limiter) await opts.limiter.acquire();

    let status = 0;
    try {
      const ctrl = new AbortController();
      const t = opts.timeoutMs ? setTimeout(() => ctrl.abort(), opts.timeoutMs) : undefined;
      const res = await fetch(url, { headers: opts.headers, signal: ctrl.signal });
      if (t) clearTimeout(t);
      status = res.status;
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (res.ok) return { status, ok: true, json, text };

      if (!RETRYABLE.has(status) || attempt >= maxRetries) {
        throw new HttpError(`GET ${url} → ${status}`, status, !RETRYABLE.has(status));
      }
    } catch (err) {
      if (err instanceof HttpError && err.terminal) throw err;
      if (attempt >= maxRetries) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(`GET ${url} failed: ${(err as Error).message}`, status, false);
      }
    }

    const delay = Math.min(max, base * 2 ** attempt);
    const jitter = delay * 0.25 * Math.random();
    await new Promise((r) => setTimeout(r, delay + jitter));
    attempt++;
  }
}
