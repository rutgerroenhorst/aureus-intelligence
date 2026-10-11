import { timingSafeEqual } from "node:crypto";

/**
 * Only a caller that knows CRON_SECRET (an outside scheduler, or a person holding it) is trusted. Without the env var
 * nobody is: the site's production address is public, so a route that writes must not rely on "only I know the URL".
 * The comparison takes the same time whatever part of the secret is right.
 */
export function isTrusted(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}
