-- lockdown.sql: close the hosted (Supabase) database's data API to strangers (docs/DISASTER_RECOVERY.md).
--
-- Supabase gives its two web roles, `anon` and `authenticated`, every privilege on every new table, sequence and function in `public`, and exposes `public` through a REST
-- API that these roles may use. Anybody holding the project's public `anon` key could then read, change and delete every table (and call prune_history()). The site does not use
-- that API at all: it connects as `aureus_app` (and the clock as `postgres`), so nothing is lost by taking these roles' privileges away.
--
-- Safe to run again, and run it again after every fresh project (and after any migration that creates tables: the default privileges below keep new tables closed).
-- Apply:  corepack pnpm exec tsx scripts/hosted-sql.ts --write "$(cat db/hosted/lockdown.sql)"
-- Check:  corepack pnpm exec tsx scripts/verify-system.ts       (the line about the open web roles)
-- Undo (not advised):  GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;  (and the same for SEQUENCES and FUNCTIONS)
BEGIN;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
-- the one maintenance function that was open to everybody (PUBLIC); the site's role keeps it. (The three trigger functions that are also open cannot be called as functions.)
REVOKE ALL ON FUNCTION public.reconcile_rule_current() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_rule_current() TO aureus_app;
-- the placeholder passwords of migration 0002 must never be live on a hosted database: only the site's role may log in, with a password set out of band
-- (ALTER ROLE aureus_app PASSWORD '<long random>'; the connection string goes into Vercel as DATABASE_URL)
ALTER ROLE aureus_outcome NOLOGIN;
ALTER ROLE aureus_readonly NOLOGIN;
COMMIT;
