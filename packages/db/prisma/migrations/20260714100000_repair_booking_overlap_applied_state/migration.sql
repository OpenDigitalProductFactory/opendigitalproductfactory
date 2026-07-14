-- BI-0CC492A8 — repair installs that applied the pre-quarantine version of
-- 20260702150000_booking_overlap_exclusion before PR #2568 made that migration
-- fleet-safe in source.
--
-- Some installs can have _prisma_migrations recording the old checksum while
-- schema.prisma and current source now expect `overlapQuarantinedAt` columns and
-- quarantine-aware EXCLUDE predicates. This forward migration reconciles both
-- populations:
--   1. installs that already applied the old migration (constraints exist,
--      quarantine columns absent);
--   2. installs that apply the corrected original migration first (columns and
--      corrected constraints already exist).
--
-- Data safety: quarantine active pre-existing overlaps before (re)adding the
-- constraints. No booking/agreement rows are deleted, cancelled, provider-nulled,
-- or unit-nulled.

BEGIN;

ALTER TABLE "StorefrontBooking" ADD COLUMN IF NOT EXISTS "overlapQuarantinedAt" TIMESTAMP(3);
ALTER TABLE "RentalAgreement"  ADD COLUMN IF NOT EXISTS "overlapQuarantinedAt" TIMESTAMP(3);

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- StorefrontBooking remediation. Each pass quarantines the later-created row of
-- one remaining active overlap pair. The earliest row in an overlap component
-- survives; later rows become an operator-review queue.
DO $$
DECLARE v_rows int;
BEGIN
  LOOP
    WITH pair AS (
      SELECT a.id AS later_id
      FROM "StorefrontBooking" a
      JOIN "StorefrontBooking" b
        ON a."providerId" = b."providerId"
       AND a.id <> b.id
       AND a."status" <> 'cancelled' AND b."status" <> 'cancelled'
       AND a."providerId" IS NOT NULL AND a."durationMinutes" > 0 AND b."durationMinutes" > 0
       AND a."overlapQuarantinedAt" IS NULL AND b."overlapQuarantinedAt" IS NULL
       AND tsrange(a."scheduledAt", a."scheduledAt" + make_interval(mins => a."durationMinutes")) &&
           tsrange(b."scheduledAt", b."scheduledAt" + make_interval(mins => b."durationMinutes"))
       AND (a."createdAt", a.id) > (b."createdAt", b.id)
      LIMIT 1
    )
    UPDATE "StorefrontBooking" s
       SET "overlapQuarantinedAt" = now()
      FROM pair WHERE s.id = pair.later_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    EXIT WHEN v_rows = 0;
  END LOOP;
END $$;

-- RentalAgreement remediation, matching the original fleet-safe strategy.
DO $$
DECLARE v_rows int;
BEGIN
  LOOP
    WITH pair AS (
      SELECT a.id AS later_id
      FROM "RentalAgreement" a
      JOIN "RentalAgreement" b
        ON a."rentableUnitId" = b."rentableUnitId"
       AND a.id <> b.id
       AND a."rentableUnitId" IS NOT NULL
       AND a."status" NOT IN ('cancelled', 'closed', 'returned')
       AND b."status" NOT IN ('cancelled', 'closed', 'returned')
       AND a."overlapQuarantinedAt" IS NULL AND b."overlapQuarantinedAt" IS NULL
       AND tsrange(a."periodStart", a."periodEnd") && tsrange(b."periodStart", b."periodEnd")
       AND (a."createdAt", a.id) > (b."createdAt", b.id)
      LIMIT 1
    )
    UPDATE "RentalAgreement" s
       SET "overlapQuarantinedAt" = now()
      FROM pair WHERE s.id = pair.later_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    EXIT WHEN v_rows = 0;
  END LOOP;
END $$;

ALTER TABLE "StorefrontBooking" DROP CONSTRAINT IF EXISTS "StorefrontBooking_no_overlap";
ALTER TABLE "RentalAgreement" DROP CONSTRAINT IF EXISTS "RentalAgreement_no_overlap";

ALTER TABLE "StorefrontBooking"
  ADD CONSTRAINT "StorefrontBooking_no_overlap"
  EXCLUDE USING gist (
    "providerId" WITH =,
    tsrange("scheduledAt", "scheduledAt" + make_interval(mins => "durationMinutes")) WITH &&
  )
  WHERE ("status" <> 'cancelled' AND "providerId" IS NOT NULL AND "durationMinutes" > 0
         AND "overlapQuarantinedAt" IS NULL);

ALTER TABLE "RentalAgreement"
  ADD CONSTRAINT "RentalAgreement_no_overlap"
  EXCLUDE USING gist (
    "rentableUnitId" WITH =,
    tsrange("periodStart", "periodEnd") WITH &&
  )
  WHERE ("rentableUnitId" IS NOT NULL AND "status" NOT IN ('cancelled', 'closed', 'returned')
         AND "overlapQuarantinedAt" IS NULL);

COMMIT;
