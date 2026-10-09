-- 0012 — Automatic time-partition maintenance.
--
-- 0001_init created partitions for 2026m07 only, with the comment "A maintenance
-- job creates future months". That job was never written. On 2026-08-01 every
-- INSERT into prices / liquidity_snapshots / transaction_aggregates began failing
-- with "no partition of relation ... found for row", the worker logged a
-- per-candidate error and carried on reporting healthy cycles, and the whole board
-- silently drained to zero. A schema that stops accepting writes on a calendar
-- boundary is a time bomb; this defuses it.
--
-- Idempotent: safe to call on every worker boot and on a timer.

CREATE OR REPLACE FUNCTION ensure_time_partitions(months_ahead INT DEFAULT 3)
RETURNS TABLE (created TEXT) AS $$
DECLARE
  tbl        TEXT;
  m          INT;
  start_date DATE;
  end_date   DATE;
  part_name  TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['prices', 'liquidity_snapshots', 'transaction_aggregates'] LOOP
    -- Start one month BACK: a late-arriving observation, or a clock that moved
    -- while the worker was down, must not hit a missing partition either.
    FOR m IN -1 .. months_ahead LOOP
      start_date := date_trunc('month', CURRENT_DATE) + (m || ' month')::INTERVAL;
      end_date   := start_date + INTERVAL '1 month';
      part_name  := format('%s_%sm%s', tbl, to_char(start_date, 'YYYY'), to_char(start_date, 'MM'));

      IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
        EXECUTE format(
          'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
          part_name, tbl, start_date, end_date);
        created := part_name;
        RETURN NEXT;
      END IF;
    END LOOP;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ensure_time_partitions IS
  'Creates any missing monthly partitions from one month back to N months ahead. Idempotent; called by the worker on boot and hourly.';

-- Close the gap that is open right now.
SELECT * FROM ensure_time_partitions(3);
