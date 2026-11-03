-- BI-3C0F7A92 / DI-BAAF37D46EC3: retain admission truth across gate revival.
-- @migration-safety: data-safe: two nullable columns, no default or backfill;
-- existing rows retain unknown history. Only future fresh producer inserts
-- acquire a stamp. No rows, grants, ownership or lifecycle statuses are changed.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "NonProductionEnvironmentLease"
  ADD COLUMN "admissionHistoryVersion" INTEGER,
  ADD COLUMN "firstAdmittedAt" TIMESTAMP(3);

CREATE FUNCTION nonprod_lease_preserve_admission_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."admissionHistoryVersion" IS NOT NULL OR NEW."firstAdmittedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Reservation admission history is database-owned' USING ERRCODE = '23514';
    END IF;
    -- The real claim producer omits createdAt, using this transaction default.
    -- Historical/backdated copies and terminal inserts cannot mint proof.
    IF NEW."createdAt" = CURRENT_TIMESTAMP::timestamp(3) THEN
      IF NEW.status = 'queued' AND NEW."admittedAt" IS NULL
        AND NEW."slotKey" IS NULL AND NEW."activeKey" IS NULL THEN
        NEW."admissionHistoryVersion" := 1;
      ELSIF NEW.status = 'active' THEN
        NEW."admissionHistoryVersion" := 1;
        NEW."firstAdmittedAt" := clock_timestamp();
      END IF;
    END IF;
  ELSE
    -- Normalise even explicit NULL/default values from older writer shapes.
    -- Legacy NULL can never be upgraded, and recorded admission never erased.
    NEW."admissionHistoryVersion" := OLD."admissionHistoryVersion";
    NEW."firstAdmittedAt" := OLD."firstAdmittedAt";
    IF OLD."admissionHistoryVersion" = 1 AND OLD."firstAdmittedAt" IS NULL
      AND NEW.status = 'active' THEN
      NEW."firstAdmittedAt" := clock_timestamp();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "NonProductionEnvironmentLease_admission_history"
  BEFORE INSERT OR UPDATE ON "NonProductionEnvironmentLease"
  FOR EACH ROW EXECUTE FUNCTION nonprod_lease_preserve_admission_history();
COMMIT;
