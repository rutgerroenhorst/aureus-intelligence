/**
 * The site's lock (docs/ACCESS.md): one access code, a signed cookie, nothing else.
 *
 * Only Web Crypto is used, so the same code runs in the edge middleware, in a route handler and in the tests.
 * The cookie says "v1.<issued>.<expires>.<signature>". The signing key is made from AUTH_SECRET *and* the access code, so
 * changing either one logs every device out at once.
 */

export const SESSION_DAYS = 90;
/** a cookie older than this is renewed on use, so somebody who opens the site now and then is never asked again */
export const REFRESH_AFTER_DAYS = 7;

const enc = new TextEncoder();

function toB64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** The access code as it is compared: spaces and dashes do not count and case does not matter ("7k4m q9xd" is "7K4M-Q9XD"). */
export function canonicalCode(code: string): string {
  return code.replace(/[\s-]+/g, "").toUpperCase();
}

async function signingKey(secret: string, code: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest("SHA-256", enc.encode(`auriga-session|${secret}|${canonicalCode(code)}`));
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** A fresh cookie value for somebody who knew the code. */
export async function signSession(secret: string, code: string, nowMs: number, days: number = SESSION_DAYS): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  const body = `v1.${iat}.${iat + Math.round(days * 86_400)}`;
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(secret, code), enc.encode(body)));
  return `${body}.${toB64url(sig)}`;
}

export type SessionCheck = { ok: false } | { ok: true; issuedAt: number; expiresAt: number };

/** Is this cookie value one we signed with this secret and code, and has it not run out? Never throws. */
export async function verifySession(token: string | null | undefined, secret: string, code: string, nowMs: number): Promise<SessionCheck> {
  try {
    if (!token || token.length > 200) return { ok: false };
    const parts = token.split(".");
    if (parts.length !== 4 || parts[0] !== "v1") return { ok: false };
    const [version, issued, expires, signature] = parts as [string, string, string, string];
    const iat = Number(issued);
    const exp = Number(expires);
    if (!Number.isSafeInteger(iat) || !Number.isSafeInteger(exp)) return { ok: false };
    const sig = fromB64url(signature);
    if (!sig) return { ok: false };
    const genuine = await crypto.subtle.verify("HMAC", await signingKey(secret, code), sig, enc.encode(`${version}.${issued}.${expires}`));
    if (!genuine) return { ok: false };
    const now = Math.floor(nowMs / 1000);
    if (exp <= now || iat > now + 300) return { ok: false };
    return { ok: true, issuedAt: iat, expiresAt: exp };
  } catch {
    return { ok: false };
  }
}

/** Equal strings, in the same time whatever part of them is right (both sides are hashed first, then compared byte by byte). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}
