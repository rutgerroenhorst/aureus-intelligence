import { NextResponse, type NextRequest } from "next/server";
import { cookieName, decide } from "./lib/auth/policy";
import { SESSION_DAYS, signSession } from "./lib/auth/session";

/**
 * The lock on the whole site (docs/ACCESS.md). It runs before anything else, also in front of the pages the CDN would serve from its cache.
 * Everything except the files of the static build is checked (the login page and a few brand files are let through by lib/auth/policy.ts).
 */
export const config = { matcher: ["/((?!_next/static).*)"] };

export async function middleware(req: NextRequest) {
  const production = process.env.NODE_ENV === "production";
  const env = { code: process.env.SITE_ACCESS_CODE, secret: process.env.AUTH_SECRET, service: process.env.CRON_SECRET, production };
  const name = cookieName(production);
  const decision = await decide({ pathname: req.nextUrl.pathname, cookie: req.cookies.get(name)?.value, authorization: req.headers.get("authorization"), now: Date.now(), env });

  switch (decision.action) {
    case "allow": {
      const res = NextResponse.next();
      if (decision.renew && env.code && env.secret) {
        res.cookies.set({ name, value: await signSession(env.secret, env.code, Date.now()), httpOnly: true, secure: production, sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86_400 });
      }
      return res;
    }
    case "deny":
      return new NextResponse(JSON.stringify({ error: "login required" }), { status: 401, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    case "unconfigured":
      return new NextResponse("Not available.", { status: 503, headers: { "cache-control": "no-store" } });
    case "login": {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
      return NextResponse.redirect(url);
    }
  }
}
