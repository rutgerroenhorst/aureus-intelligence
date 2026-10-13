import { REFRESH_AFTER_DAYS, safeEqual, verifySession } from "./session";

/**
 * Who gets in (docs/ACCESS.md). One rule for every address of the site: a signed cookie from the login page, or the service secret
 * (CRON_SECRET) as `Authorization: Bearer ...`, which is what the database's clock and my own scripts use. Everything else is turned away.
 * Written as a plain function of its inputs so it can be tested without a server.
 */

/** The cookie is called "__Host-aur" on the real site (https only, no way for another site to set it) and "aur" on http://localhost. */
export const cookieName = (production: boolean): string => (production ? "__Host-aur" : "aur");

/** What a visitor may open without a login: the login itself, the files a phone fetches without cookies when it installs the app, the page that tells robots to leave. */
const PUBLIC_EXACT = new Set(["/login", "/api/auth/login", "/api/auth/logout", "/robots.txt", "/favicon.ico", "/manifest.webmanifest"]);
const PUBLIC_PREFIX = ["/_next/static/", "/icons/"];

export const isPublicPath = (pathname: string): boolean => PUBLIC_EXACT.has(pathname) || PUBLIC_PREFIX.some((p) => pathname.startsWith(p));

export interface AuthEnv {
  /** SITE_ACCESS_CODE */
  code?: string;
  /** AUTH_SECRET */
  secret?: string;
  /** CRON_SECRET */
  service?: string;
  production: boolean;
}

export type Decision =
  | { action: "allow"; renew?: boolean }
  /** a page: send the visitor to the login page */
  | { action: "login" }
  /** an API call: 401 */
  | { action: "deny" }
  /** the lock itself is not set up on a real deployment: nobody gets in (the lock fails closed, never open) */
  | { action: "unconfigured" };

export async function decide(input: { pathname: string; cookie?: string | null; authorization?: string | null; now: number; env: AuthEnv }): Promise<Decision> {
  const { pathname, cookie, authorization, now, env } = input;
  if (isPublicPath(pathname)) return { action: "allow" };

  // the service secret opens everything (the clock in the database, my scripts); the routes that write check it again themselves
  if (env.service && authorization && (await safeEqual(authorization, `Bearer ${env.service}`))) return { action: "allow" };

  if (!env.code || !env.secret) {
    // a laptop without a lock set up (npm run dev) stays open; a real deployment without one is closed
    return env.production ? { action: "unconfigured" } : { action: "allow" };
  }

  const session = await verifySession(cookie, env.secret, env.code, now);
  if (session.ok) return { action: "allow", renew: now / 1000 - session.issuedAt > REFRESH_AFTER_DAYS * 86_400 };

  return pathname.startsWith("/api/") ? { action: "deny" } : { action: "login" };
}

/** Where to go after logging in: only a path on this site, never another address. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\r\n]/.test(next)) return "/";
  if (next.startsWith("/login") || next.startsWith("/api/auth")) return "/";
  return next;
}
