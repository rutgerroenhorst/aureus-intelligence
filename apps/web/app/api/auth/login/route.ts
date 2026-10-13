import { NextResponse } from "next/server";
import { cookieName, safeNext } from "@/lib/auth/policy";
import { SESSION_DAYS, canonicalCode, safeEqual, signSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * The login (docs/ACCESS.md): the form on /login posts the access code here. A right code gets a signed cookie and goes on to where it came from;
 * a wrong one waits a moment and goes back. A few wrong codes from one address in a row block that address for a quarter of an hour (kept in the
 * memory of each server instance: the code is long enough that guessing it is hopeless anyway, this only stops noise).
 */
const WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 6;
const fails = new Map<string, { n: number; first: number }>();

/** A redirect with a relative address: the browser resolves it against the address it is on, so no proxy or host header can send anybody elsewhere. */
const see = (to: string) => new NextResponse(null, { status: 303, headers: { Location: to, "cache-control": "no-store" } });

const clientIp = (req: Request) => req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

export async function POST(req: Request) {
  const production = process.env.NODE_ENV === "production";
  const code = process.env.SITE_ACCESS_CODE;
  const secret = process.env.AUTH_SECRET;
  if (!code || !secret) return new NextResponse("Not available.", { status: 503, headers: { "cache-control": "no-store" } });

  const form = await req.formData().catch(() => null);
  const given = String(form?.get("code") ?? "");
  const next = safeNext(String(form?.get("next") ?? ""));
  const back = (e: "1" | "2") => see(`/login?e=${e}&next=${encodeURIComponent(next)}`);

  const ip = clientIp(req);
  const now = Date.now();
  if (fails.size > 2000) fails.clear();
  const f = fails.get(ip);
  if (f && now - f.first < WINDOW_MS && f.n >= MAX_FAILS) return back("2");

  const ok = given.length > 0 && given.length < 200 && (await safeEqual(canonicalCode(given), canonicalCode(code)));
  if (!ok) {
    fails.set(ip, f && now - f.first < WINDOW_MS ? { n: f.n + 1, first: f.first } : { n: 1, first: now });
    await new Promise((r) => setTimeout(r, 700));
    return back("1");
  }

  fails.delete(ip);
  const res = see(next);
  res.cookies.set({ name: cookieName(production), value: await signSession(secret, code, now), httpOnly: true, secure: production, sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86_400 });
  return res;
}
