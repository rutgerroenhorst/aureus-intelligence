# The lock: who can open the site

Added 2026-10-13 at the owner's request ("only you and I can see it"). Before this the site's production address was public: anyone with the link could read the pages and the API
(the journal, the followed wallet's trades, the Checks). Now **every address of the site needs a login**, except the login itself.

## How it works

- `apps/web/middleware.ts` runs before every request (also in front of pages the CDN would serve from its cache) and asks `apps/web/lib/auth/policy.ts` (`decide`) whether to let it in.
- **A visitor** logs in on `/login` with the **access code**. A right code gets a signed cookie (`__Host-aur`, HttpOnly, Secure, SameSite=Lax, 90 days, renewed on use once it is a week old), so
  somebody who opens the site now and then is never asked again. A wrong code waits 0.7 s and goes back; six wrong codes from one address block it for 15 minutes. The code is 20 characters
  from a 32-letter alphabet (100 bits), so guessing it is hopeless anyway; spaces, dashes and case do not matter when typing it.
- **The service secret** (`CRON_SECRET`) opens every address as `Authorization: Bearer <secret>`. That is how the database's clock (pg_cron: exit alerts every 2 minutes, graduations every 3, scan, learning,
  the watchdog) reaches the site, and how my own scripts and checks do. The routes that write (`/api/cron/*`, `/api/scan`, `/api/learning-track`) check the secret again themselves (`lib/trusted.ts`).
- **Public without a login**: `/login`, `/api/auth/login`, `/api/auth/logout`, `/robots.txt` (disallows everything), `/favicon.ico`, `/manifest.webmanifest` (just the name and icons: no description),
  `/icons/*` and `/_next/static/*` (the build's files). The phone fetches the manifest and icons without cookies when the app is installed, which is why they stay open.
- **Fail closed**: on a real deployment (`NODE_ENV=production`) without `SITE_ACCESS_CODE` or `AUTH_SECRET`, every address answers 503 (only the service secret still works, so the clock keeps running). A laptop
  without those variables (`pnpm dev`) stays open, and the dev server and `next start` listen on 127.0.0.1 only (set `AUREUS_HOST=0.0.0.0` to change that; the compose `web` service does).
- The pages that call `/api/...` get a `401` when the session has ended; the shell (`AppShellElite`) then sends the visitor to `/login`. "Uitloggen" (sidebar, and the phone's More sheet) posts to `/api/auth/logout`.
- Every response also carries `X-Robots-Tag: noindex, nofollow, noarchive`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and a `Permissions-Policy` that switches
  camera, microphone, location and payment off (`next.config.mjs`).

## The secrets and where they are

| name | what | where |
| --- | --- | --- |
| `SITE_ACCESS_CODE` | the access code | Vercel (type *sensitive*, production and preview) and the git-ignored `.env.access.local` (mode 600) in the repo folder. **Keep a copy in a password manager** |
| `AUTH_SECRET` | signs the cookies; with the code it makes the signing key, so changing either logs every device out | the same two places |
| `CRON_SECRET` | the service secret | Vercel (production), the Supabase vault entry `aureus_cron_secret` (the clock reads it when it runs) |

None of them is ever printed by the scripts, written into the repository, or put in a reply.

## Everyday use

- **First time on a device**: open the site, type the code (copy it from the password manager). On the iPhone's installed app, log in inside the app itself (it has its own cookies); the password manager can fill it.
- **Check that the lock holds** (from the repo folder): `corepack pnpm exec tsx scripts/access-code.ts check`. It asks the live site as a stranger (must be turned away), with a wrong code (refused) and with the code
  in the file (let in). `scripts/verify-system.ts` includes the same questions.
- **New code** (it leaked, or a device was lost): `corepack pnpm exec tsx scripts/access-code.ts rotate`, then push to `main` (or redeploy in the Vercel dashboard); the new code applies with that deployment and
  every device has to log in again. `access-code.ts where` says where the file is.
- **Lost the code**: it is in `.env.access.local`. If that is gone too, `rotate` makes a new one (needs the Vercel command line tool to be logged in) or set `SITE_ACCESS_CODE` and `AUTH_SECRET` by hand in the Vercel
  dashboard (Settings, Environment Variables) and redeploy.
- **Locked out and need the site open at once**: restore the code before the lock (`scripts/restore-baseline.sh restore/2026-10-13-before-hardening`), which also removes the lock. Prefer `rotate`.

## Limits, said honestly

- A shared code, not accounts: whoever has it and a cookie is the owner. It protects against strangers, search engines and scanners; it does not protect a device that is lost unlocked or a code that is typed into a
  fake page (check the address).
- The login counter lives in each server instance's memory; it only slows noise down. The code's length is the real protection.
- Vercel's own "Deployment Protection" cannot cover the production address on the free plan, which is why the lock is in the application.
- The build's static files (`/_next/static`) are fetchable by anybody who knows their hashed names. They are the program, not the data; no page lists them without a login.
- The Supabase database has its own door (its data API with the `anon` key); see `docs/DISASTER_RECOVERY.md` for how that was closed.
