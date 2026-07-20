-- BI-69306ED7 — restore agreement between the ScheduledJob heap and its
-- canonical job-id index. Affected installs can hold duplicate heap rows even
-- while pg_index reports the btree healthy.
--
-- Fleet safety: the newest persisted job state remains active; older rows are
-- quarantined by jobId, never deleted. IDs, configuration, run state, and
-- timestamps are preserved. Clean installs change no data; the migration is
-- idempotent and fails closed.

BEGIN;

SET LOCAL enable_indexscan = off;
SET LOCAL enable_indexonlyscan = off;
SET LOCAL enable_bitmapscan = off;

DO $$
DECLARE
  duplicate_row RECORD;
  quarantine_job_id TEXT;
BEGIN
  FOR duplicate_row IN
    WITH ranked AS MATERIALIZED (
      SELECT
        id,
        "jobId",
        row_number() OVER (
          PARTITION BY "jobId"
          ORDER BY "updatedAt" DESC, "lastRunAt" DESC NULLS LAST, "createdAt" DESC, id DESC
        ) AS duplicate_rank
      FROM "ScheduledJob"
    )
    SELECT id, "jobId"
    FROM ranked
    WHERE duplicate_rank > 1
    ORDER BY "jobId", id
  LOOP
    quarantine_job_id := '__dpf_quarantined__' || duplicate_row.id || '__' || duplicate_row."jobId";
    WHILE EXISTS (
      SELECT 1
      FROM "ScheduledJob"
      WHERE "jobId" = quarantine_job_id AND id <> duplicate_row.id
    ) LOOP
      quarantine_job_id := quarantine_job_id || '_';
    END LOOP;

    UPDATE "ScheduledJob"
    SET "jobId" = quarantine_job_id
    WHERE id = duplicate_row.id;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ScheduledJob"
    GROUP BY "jobId"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'ScheduledJob integrity repair left duplicate job ids';
  END IF;
END $$;

DROP INDEX IF EXISTS "ScheduledJob_jobId_key";
CREATE UNIQUE INDEX "ScheduledJob_jobId_key" ON "ScheduledJob" ("jobId");

COMMIT;
