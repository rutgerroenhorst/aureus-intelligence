-- 0025_cloud_scan.sql: lets the web app run the scanner itself (on Vercel), with no separate worker host.
--
-- 1. scan_lease: a scan only starts when it can claim this row, so two serverless instances never scan
--    at the same time, and a scan that crashed frees itself once locked_until has passed.
-- 2. ensure_time_partitions() now runs with its owner's rights. The web role is least-privilege (no DDL),
--    but the monthly partition rollover must never stop the feed, and the function only creates partitions.

CREATE TABLE IF NOT EXISTS scan_lease (
  name          TEXT PRIMARY KEY,
  locked_until  TIMESTAMPTZ NOT NULL DEFAULT 'epoch',
  last_started  TIMESTAMPTZ,
  last_finished TIMESTAMPTZ,
  last_result   JSONB
);

ALTER FUNCTION ensure_time_partitions(INT) SECURITY DEFINER SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION ensure_time_partitions(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ensure_time_partitions(INT) TO aureus_app;
