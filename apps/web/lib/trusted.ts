/**
 * Only a caller that knows CRON_SECRET (an outside scheduler, or a person holding it) is trusted. Without the env var
 * nobody is: the site's production address is public, so a route that writes must not rely on "only I know the URL".
 */
export function isTrusted(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
}
