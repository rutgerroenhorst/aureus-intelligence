import { describe, expect, it } from "vitest";
import { canonicalCode, safeEqual, signSession, verifySession } from "./session";
import { cookieName, decide, isPublicPath, safeNext, type AuthEnv } from "./policy";

const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
const DAY = 86_400_000;
const CODE = "7K4M-Q9XD-R2TH-W6PB-5FNC";
const SECRET = "x".repeat(48);

describe("the access code", () => {
  it("is compared without spaces, dashes or case", () => {
    expect(canonicalCode("7k4m q9xd-r2th W6PB 5fnc")).toBe("7K4MQ9XDR2THW6PB5FNC");
    expect(canonicalCode(CODE)).toBe(canonicalCode("7k4mq9xdr2thw6pb5fnc"));
  });
  it("is compared in the same way whatever part is right", async () => {
    expect(await safeEqual("abc", "abc")).toBe(true);
    expect(await safeEqual("abc", "abd")).toBe(false);
    expect(await safeEqual("abc", "abcd")).toBe(false);
    expect(await safeEqual("", "")).toBe(true);
  });
});

describe("the cookie", () => {
  it("is accepted for the secret and code it was signed with", async () => {
    const token = await signSession(SECRET, CODE, NOW);
    const check = await verifySession(token, SECRET, CODE, NOW + DAY);
    expect(check.ok).toBe(true);
    // the code may be typed in another way: it is the same code
    expect((await verifySession(token, SECRET, "7k4mq9xdr2thw6pb5fnc", NOW + DAY)).ok).toBe(true);
  });
  it("stops working after 90 days", async () => {
    const token = await signSession(SECRET, CODE, NOW);
    expect((await verifySession(token, SECRET, CODE, NOW + 89 * DAY)).ok).toBe(true);
    expect((await verifySession(token, SECRET, CODE, NOW + 91 * DAY)).ok).toBe(false);
  });
  it("is worthless when the code or the secret changes: every device is logged out", async () => {
    const token = await signSession(SECRET, CODE, NOW);
    expect((await verifySession(token, SECRET, "AAAA-BBBB-CCCC-DDDD-EEEE", NOW)).ok).toBe(false);
    expect((await verifySession(token, "y".repeat(48), CODE, NOW)).ok).toBe(false);
  });
  it("cannot be forged or stretched", async () => {
    const token = await signSession(SECRET, CODE, NOW);
    const [v, iat, exp, sig] = token.split(".") as [string, string, string, string];
    expect((await verifySession(`${v}.${iat}.${Number(exp) + 10 * 86400}.${sig}`, SECRET, CODE, NOW)).ok).toBe(false); // a later expiry
    expect((await verifySession(`${v}.${iat}.${exp}.${sig.slice(0, -2)}AA`, SECRET, CODE, NOW)).ok).toBe(false); // a changed signature
    expect((await verifySession(`v2.${iat}.${exp}.${sig}`, SECRET, CODE, NOW)).ok).toBe(false);
    const future = await signSession(SECRET, CODE, NOW + 3 * DAY);
    expect((await verifySession(future, SECRET, CODE, NOW)).ok).toBe(false); // issued in the future
  });
  it("never throws on rubbish", async () => {
    for (const t of [undefined, null, "", "a", "v1", "v1.1.2", "v1.a.b.c", "v1.1.2.%%%", "v1.1.2.AAAA", "x".repeat(500), "v1..." + "A".repeat(80)]) {
      expect((await verifySession(t as string | undefined, SECRET, CODE, NOW)).ok, String(t)).toBe(false);
    }
  });
});

describe("who gets in", () => {
  const prod: AuthEnv = { code: CODE, secret: SECRET, service: "svc-secret-0123456789", production: true };
  const ask = (pathname: string, extra: { cookie?: string | null; authorization?: string | null } = {}, env: AuthEnv = prod, now = NOW) => decide({ pathname, now, env, ...extra });

  it("lets the login and the brand files through, and nothing else, without a login", async () => {
    for (const p of ["/login", "/api/auth/login", "/api/auth/logout", "/robots.txt", "/favicon.ico", "/manifest.webmanifest", "/icons/icon-192.png", "/_next/static/chunks/main.js"]) {
      expect((await ask(p)).action, p).toBe("allow");
    }
    for (const p of ["/", "/radar", "/kennis", "/learning", "/api/telemetry", "/api/health", "/api/my-trades", "/api/radar-bundle", "/api/cron/exit-alerts", "/loginx", "/icons", "/api/auth"]) {
      expect(isPublicPath(p), p).toBe(false);
    }
  });
  it("sends a visitor without a login to the login page, and answers an API call with 401", async () => {
    expect((await ask("/radar")).action).toBe("login");
    expect((await ask("/kennis")).action).toBe("login");
    expect((await ask("/api/telemetry")).action).toBe("deny");
    expect((await ask("/api/my-trades")).action).toBe("deny");
  });
  it("lets a visitor with a good cookie in, and renews an old one", async () => {
    const fresh = await signSession(SECRET, CODE, NOW - 1 * DAY);
    expect(await ask("/radar", { cookie: fresh })).toEqual({ action: "allow", renew: false });
    const old = await signSession(SECRET, CODE, NOW - 10 * DAY);
    expect(await ask("/api/telemetry", { cookie: old })).toEqual({ action: "allow", renew: true });
    const expired = await signSession(SECRET, CODE, NOW - 100 * DAY);
    expect((await ask("/radar", { cookie: expired })).action).toBe("login");
  });
  it("lets the database's clock and my scripts in with the service secret, exactly", async () => {
    expect((await ask("/api/cron/exit-alerts", { authorization: "Bearer svc-secret-0123456789" })).action).toBe("allow");
    expect((await ask("/api/radar-bundle", { authorization: "Bearer svc-secret-0123456789" })).action).toBe("allow");
    expect((await ask("/api/cron/exit-alerts", { authorization: "Bearer svc-secret-012345678" })).action).toBe("deny");
    expect((await ask("/api/cron/exit-alerts", { authorization: "Bearer svc-secret-0123456789x" })).action).toBe("deny");
    expect((await ask("/api/cron/exit-alerts", { authorization: "svc-secret-0123456789" })).action).toBe("deny");
    expect((await ask("/radar", { authorization: "Bearer wrong" })).action).toBe("login");
    // no service secret set: a bearer header is worth nothing
    expect((await ask("/api/telemetry", { authorization: "Bearer undefined" }, { ...prod, service: undefined })).action).toBe("deny");
    expect((await ask("/api/telemetry", { authorization: "Bearer " }, { ...prod, service: undefined })).action).toBe("deny");
  });
  it("is closed, not open, on a real deployment where the lock was not set up; an unlocked laptop stays open", async () => {
    expect((await ask("/radar", {}, { production: true })).action).toBe("unconfigured");
    expect((await ask("/api/telemetry", {}, { code: CODE, production: true })).action).toBe("unconfigured"); // a secret is missing
    expect((await ask("/api/telemetry", { authorization: "Bearer svc" }, { service: "svc", production: true })).action).toBe("allow"); // the clock still works
    expect((await ask("/radar", {}, { production: false })).action).toBe("allow");
    expect((await ask("/radar", {}, { code: CODE, secret: SECRET, production: false })).action).toBe("login"); // a laptop WITH a lock is locked
  });
  it("names the cookie differently on https and on localhost", () => {
    expect(cookieName(true)).toBe("__Host-aur");
    expect(cookieName(false)).toBe("aur");
  });
});

describe("where a login goes next", () => {
  it("only to a path on this site", () => {
    expect(safeNext("/radar?tab=graduates")).toBe("/radar?tab=graduates");
    expect(safeNext("/kennis")).toBe("/kennis");
    for (const bad of ["https://evil.example/x", "//evil.example", "/\\evil.example", "javascript:alert(1)", "radar", "", null, undefined, "/x\r\nSet-Cookie: a=b", "/login", "/login?e=1", "/api/auth/logout"]) {
      expect(safeNext(bad as string | null | undefined), String(bad)).toBe("/");
    }
  });
});
