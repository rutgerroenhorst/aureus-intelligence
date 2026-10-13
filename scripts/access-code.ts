/**
 * The site's access code (docs/ACCESS.md).
 *
 *   corepack pnpm exec tsx scripts/access-code.ts rotate   a new code and a new session secret: written to .env.access.local and set on Vercel (production and preview).
 *                                                          They apply to the NEXT deployment (push to main). Everybody is logged out when they do.
 *   corepack pnpm exec tsx scripts/access-code.ts where    says where the code is kept; never prints it
 *   corepack pnpm exec tsx scripts/access-code.ts check    checks the live site: turned away without a login, let in with the code in the file
 *
 * The code and the secret are never printed and never go into the repository (.env.access.local is git-ignored, mode 600).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomInt } from "node:crypto";
import { REPO, loadEnvFile } from "./lib/hosted.js";

const FILE = path.join(REPO, ".env.access.local");
const SITE = (process.env.SITE_URL ?? "https://aureus-intelligence-nu.vercel.app").replace(/\/+$/, "");
/** no 0/O and 1/I: the code is read off a screen and typed on a phone */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newCode(): string {
  const chars = Array.from({ length: 20 }, () => ALPHABET[randomInt(ALPHABET.length)]!);
  return [0, 4, 8, 12, 16].map((i) => chars.slice(i, i + 4).join("")).join("-");
}

function vercelAuth(): { token: string; projectId: string; teamId: string } {
  const candidates = [path.join(os.homedir(), "Library/Application Support/com.vercel.cli/auth.json"), path.join(os.homedir(), ".local/share/com.vercel.cli/auth.json")];
  const authFile = candidates.find((f) => fs.existsSync(f));
  if (!authFile) throw new Error("the Vercel command line tool is not logged in (no auth.json): run `vercel login` first");
  const token = JSON.parse(fs.readFileSync(authFile, "utf8")).token as string | undefined;
  if (!token) throw new Error("no token in the Vercel auth file");
  const link = JSON.parse(fs.readFileSync(path.join(REPO, ".vercel/project.json"), "utf8")) as { projectId: string; orgId: string };
  return { token, projectId: link.projectId, teamId: link.orgId };
}

async function setVercelEnv(key: string, value: string) {
  const { token, projectId, teamId } = vercelAuth();
  const res = await fetch(`https://api.vercel.com/v10/projects/${projectId}/env?upsert=true&teamId=${teamId}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ key, value, type: "sensitive", target: ["production", "preview"] }),
  });
  if (!res.ok) throw new Error(`Vercel refused ${key}: ${res.status} ${(await res.text()).replace(value, "<hidden>").slice(0, 200)}`);
  console.log(`  ${key}: set on Vercel (production, preview)`);
}

async function rotate() {
  const code = newCode();
  const secret = randomBytes(48).toString("base64url");
  fs.writeFileSync(
    FILE,
    `# The site's access code and the secret its login cookies are signed with (docs/ACCESS.md). SECRET: git-ignored, mode 600. Keep a copy of the code in a password manager.\nSITE_ACCESS_CODE=${code}\nAUTH_SECRET=${secret}\n`,
    { mode: 0o600 },
  );
  fs.chmodSync(FILE, 0o600);
  console.log(`new code and secret written to ${path.relative(REPO, FILE)} (mode 600)`);
  await setVercelEnv("SITE_ACCESS_CODE", code);
  await setVercelEnv("AUTH_SECRET", secret);
  console.log("They apply to the next deployment: push to main (or redeploy in the Vercel dashboard). Until then the old code keeps working.");
}

function fromFile(): { code: string } {
  loadEnvFile(FILE);
  const code = process.env.SITE_ACCESS_CODE;
  if (!code) throw new Error(`no SITE_ACCESS_CODE in ${FILE}: run "rotate" first`);
  return { code };
}

async function check() {
  const { code } = fromFile();
  const ok = (cond: boolean, text: string) => {
    console.log(`${cond ? "PASS" : "FAIL"}  ${text}`);
    return cond;
  };
  let all = true;
  const get = (p: string, init: RequestInit = {}) => fetch(`${SITE}${p}`, { redirect: "manual", ...init });

  let r = await get("/api/telemetry");
  all = ok(r.status === 401, `anonymous API call is turned away (got ${r.status}, want 401)`) && all;
  r = await get("/radar");
  all = ok(r.status === 307 && (r.headers.get("location") ?? "").includes("/login"), `anonymous page goes to the login page (got ${r.status} -> ${r.headers.get("location")})`) && all;
  r = await get("/login");
  all = ok(r.status === 200, `the login page itself opens (got ${r.status})`) && all;
  r = await get("/api/auth/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "code=WRONG-WRONG-WRONG-WRONG-WRONG&next=/" });
  all = ok(r.status === 303 && (r.headers.get("location") ?? "").startsWith("/login?e=1") && !r.headers.get("set-cookie"), `a wrong code is refused (got ${r.status} -> ${r.headers.get("location")})`) && all;
  r = await get("/api/auth/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `code=${encodeURIComponent(code)}&next=/kennis` });
  const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  all = ok(r.status === 303 && cookie.length > 20, `the code in the file lets you in (got ${r.status}, cookie ${cookie ? "set" : "missing"})`) && all;
  if (cookie) {
    r = await get("/api/health", { headers: { cookie } });
    all = ok(r.status === 200 || r.status === 503, `with the cookie the API answers (got ${r.status})`) && all;
    r = await get("/kennis", { headers: { cookie } });
    all = ok(r.status === 200, `with the cookie a page opens (got ${r.status})`) && all;
  }
  console.log(all ? "\nthe site is locked and the code works" : "\nSOMETHING IS WRONG: see the FAIL lines");
  process.exitCode = all ? 0 : 1;
}

const cmd = process.argv[2];
if (cmd === "rotate") await rotate();
else if (cmd === "where") console.log(`the access code is in ${FILE} (mode 600). Open that file to read it; it is never printed here.`);
else if (cmd === "check") await check();
else console.log("usage: tsx scripts/access-code.ts rotate | where | check");
