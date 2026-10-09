-- 0002_roles.sql — least-privilege roles.
-- Enforces the anti-look-ahead boundary structurally: the outcome worker has NO
-- write path to engine/feature/state tables, only to outcomes.
--
-- NOTE: roles use placeholder passwords. In a real deployment, set passwords out
-- of band (ALTER ROLE ... PASSWORD) or use IAM auth; never commit real secrets.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aureus_app') THEN
    CREATE ROLE aureus_app LOGIN PASSWORD 'change_me';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aureus_outcome') THEN
    CREATE ROLE aureus_outcome LOGIN PASSWORD 'change_me';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aureus_readonly') THEN
    CREATE ROLE aureus_readonly LOGIN PASSWORD 'change_me';
  END IF;
END $$;

-- app: read/write everything the pipeline needs.
GRANT USAGE ON SCHEMA public TO aureus_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO aureus_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO aureus_app;

-- readonly: SELECT only (the API read path; the browser never touches the DB).
GRANT USAGE ON SCHEMA public TO aureus_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO aureus_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO aureus_readonly;

-- outcome: SELECT on history/prices; WRITE only to outcomes. No write to engine
-- tables — forward-window data can never leak back into a live gate.
GRANT USAGE ON SCHEMA public TO aureus_outcome;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO aureus_outcome;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM aureus_outcome;
GRANT INSERT, UPDATE ON outcomes TO aureus_outcome;

COMMIT;
