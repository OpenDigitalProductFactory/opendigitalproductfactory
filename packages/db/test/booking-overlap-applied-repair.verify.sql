-- Verification harness for BI-0CC492A8 repair migration.
--
-- Run against a THROWAWAY Postgres database:
--   psql -v ON_ERROR_STOP=1 -f packages/db/test/booking-overlap-applied-repair.verify.sql
--
-- Proves:
--   1. an old-applied StorefrontBooking state (constraint exists, quarantine
--      column absent) is repaired to the quarantine-aware schema;
--   2. active overlaps are quarantined, not deleted/cancelled;
--   3. the repaired EXCLUDE constraint rejects future active overlaps;
--   4. the repair is idempotent on an already-repaired schema;
--   5. RentalAgreement receives the same quarantine-aware repair.

\echo 'BI-0CC492A8 repair harness: setup old-applied state'

DROP TABLE IF EXISTS "StorefrontBooking";
DROP TABLE IF EXISTS "RentalAgreement";
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE "StorefrontBooking" (
  id text PRIMARY KEY,
  "providerId" text,
  "scheduledAt" timestamp(3) NOT NULL,
  "durationMinutes" int NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  "createdAt" timestamp(3) NOT NULL DEFAULT now()
);

CREATE TABLE "RentalAgreement" (
  id text PRIMARY KEY,
  "rentableUnitId" text,
  "periodStart" timestamp(3) NOT NULL,
  "periodEnd" timestamp(3) NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  "createdAt" timestamp(3) NOT NULL DEFAULT now()
);

-- Match the old-applied migration state: constraints exist but no quarantine columns.
ALTER TABLE "StorefrontBooking"
  ADD CONSTRAINT "StorefrontBooking_no_overlap"
  EXCLUDE USING gist (
    "providerId" WITH =,
    tsrange("scheduledAt", "scheduledAt" + make_interval(mins => "durationMinutes")) WITH &&
  )
  WHERE ("status" <> 'cancelled' AND "providerId" IS NOT NULL AND "durationMinutes" > 0);

ALTER TABLE "RentalAgreement"
  ADD CONSTRAINT "RentalAgreement_no_overlap"
  EXCLUDE USING gist (
    "rentableUnitId" WITH =,
    tsrange("periodStart", "periodEnd") WITH &&
  )
  WHERE ("rentableUnitId" IS NOT NULL AND "status" NOT IN ('cancelled', 'closed', 'returned'));

INSERT INTO "StorefrontBooking"(id,"providerId","scheduledAt","durationMinutes",status,"createdAt") VALUES
 ('old-b1','P1','2026-08-01 09:00',60,'confirmed','2026-07-01 10:00'),
 ('old-b2','P1','2026-08-01 10:00',60,'confirmed','2026-07-01 11:00');

INSERT INTO "RentalAgreement"(id,"rentableUnitId","periodStart","periodEnd",status,"createdAt") VALUES
 ('old-r1','U1','2026-08-01 09:00','2026-08-01 10:00','active','2026-07-01 10:00'),
 ('old-r2','U1','2026-08-01 10:00','2026-08-01 11:00','active','2026-07-01 11:00');

\echo 'BI-0CC492A8 repair harness: apply repair once'
\i packages/db/prisma/migrations/20260714100000_repair_booking_overlap_applied_state/migration.sql

-- EXPECT: both quarantine columns now exist.
SELECT COUNT(*) AS quarantine_column_count
FROM information_schema.columns
WHERE table_name IN ('StorefrontBooking', 'RentalAgreement')
  AND column_name = 'overlapQuarantinedAt';

DO $$
DECLARE v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM information_schema.columns
  WHERE table_name IN ('StorefrontBooking', 'RentalAgreement')
    AND column_name = 'overlapQuarantinedAt';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'expected 2 quarantine columns, got %', v_count;
  END IF;
END $$;

-- The old non-overlapping rows should remain active/unquarantined.
SELECT id, CASE WHEN "overlapQuarantinedAt" IS NULL THEN 'ACTIVE' ELSE 'QUARANTINED' END AS state
FROM "StorefrontBooking" ORDER BY id;

DO $$
DECLARE v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM "StorefrontBooking"
  WHERE id LIKE 'old-b%' AND "overlapQuarantinedAt" IS NOT NULL;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'expected old non-overlapping bookings to remain active, got % quarantined', v_count;
  END IF;
END $$;

-- Create a drift/manual state by temporarily dropping the repaired constraint,
-- inserting overlaps, and re-running the repair. This proves the quarantine loop.
ALTER TABLE "StorefrontBooking" DROP CONSTRAINT "StorefrontBooking_no_overlap";
INSERT INTO "StorefrontBooking"(id,"providerId","scheduledAt","durationMinutes",status,"createdAt") VALUES
 ('drift-b1','P2','2026-08-02 09:00',60,'confirmed','2026-07-02 10:00'),
 ('drift-b2','P2','2026-08-02 09:30',60,'confirmed','2026-07-02 11:00'),
 ('drift-b3','P2','2026-08-02 09:45',60,'confirmed','2026-07-02 12:00');

ALTER TABLE "RentalAgreement" DROP CONSTRAINT "RentalAgreement_no_overlap";
INSERT INTO "RentalAgreement"(id,"rentableUnitId","periodStart","periodEnd",status,"createdAt") VALUES
 ('drift-r1','U2','2026-08-02 09:00','2026-08-02 10:00','active','2026-07-02 10:00'),
 ('drift-r2','U2','2026-08-02 09:30','2026-08-02 10:30','active','2026-07-02 11:00');

\echo 'BI-0CC492A8 repair harness: apply repair twice'
\i packages/db/prisma/migrations/20260714100000_repair_booking_overlap_applied_state/migration.sql
\i packages/db/prisma/migrations/20260714100000_repair_booking_overlap_applied_state/migration.sql

-- EXPECT: drift-b1 ACTIVE; drift-b2/drift-b3 QUARANTINED.
SELECT id, CASE WHEN "overlapQuarantinedAt" IS NULL THEN 'ACTIVE' ELSE 'QUARANTINED' END AS state
FROM "StorefrontBooking" WHERE id LIKE 'drift-b%' ORDER BY id;

DO $$
DECLARE v_bad int;
BEGIN
  SELECT COUNT(*) INTO v_bad
  FROM "StorefrontBooking"
  WHERE (id = 'drift-b1' AND "overlapQuarantinedAt" IS NOT NULL)
     OR (id IN ('drift-b2', 'drift-b3') AND "overlapQuarantinedAt" IS NULL);
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'unexpected StorefrontBooking quarantine state count=%', v_bad;
  END IF;
END $$;

-- EXPECT: drift-r1 ACTIVE; drift-r2 QUARANTINED.
SELECT id, CASE WHEN "overlapQuarantinedAt" IS NULL THEN 'ACTIVE' ELSE 'QUARANTINED' END AS state
FROM "RentalAgreement" WHERE id LIKE 'drift-r%' ORDER BY id;

DO $$
DECLARE v_bad int;
BEGIN
  SELECT COUNT(*) INTO v_bad
  FROM "RentalAgreement"
  WHERE (id = 'drift-r1' AND "overlapQuarantinedAt" IS NOT NULL)
     OR (id = 'drift-r2' AND "overlapQuarantinedAt" IS NULL);
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'unexpected RentalAgreement quarantine state count=%', v_bad;
  END IF;
END $$;

-- EXPECT: 0 active StorefrontBooking overlaps.
SELECT COUNT(*) AS remaining_active_booking_overlaps
FROM "StorefrontBooking" a
JOIN "StorefrontBooking" b
  ON a."providerId" = b."providerId"
 AND a.id < b.id
 AND a."status" <> 'cancelled' AND b."status" <> 'cancelled'
 AND a."providerId" IS NOT NULL
 AND a."durationMinutes" > 0 AND b."durationMinutes" > 0
 AND a."overlapQuarantinedAt" IS NULL AND b."overlapQuarantinedAt" IS NULL
 AND tsrange(a."scheduledAt", a."scheduledAt" + make_interval(mins => a."durationMinutes")) &&
     tsrange(b."scheduledAt", b."scheduledAt" + make_interval(mins => b."durationMinutes"));

DO $$
DECLARE v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM "StorefrontBooking" a
  JOIN "StorefrontBooking" b
    ON a."providerId" = b."providerId"
   AND a.id < b.id
   AND a."status" <> 'cancelled' AND b."status" <> 'cancelled'
   AND a."providerId" IS NOT NULL
   AND a."durationMinutes" > 0 AND b."durationMinutes" > 0
   AND a."overlapQuarantinedAt" IS NULL AND b."overlapQuarantinedAt" IS NULL
   AND tsrange(a."scheduledAt", a."scheduledAt" + make_interval(mins => a."durationMinutes")) &&
       tsrange(b."scheduledAt", b."scheduledAt" + make_interval(mins => b."durationMinutes"));
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'expected 0 remaining active booking overlaps, got %', v_count;
  END IF;
END $$;

-- EXPECT: 0 active RentalAgreement overlaps.
SELECT COUNT(*) AS remaining_active_rental_overlaps
FROM "RentalAgreement" a
JOIN "RentalAgreement" b
  ON a."rentableUnitId" = b."rentableUnitId"
 AND a.id < b.id
 AND a."rentableUnitId" IS NOT NULL
 AND a."status" NOT IN ('cancelled', 'closed', 'returned')
 AND b."status" NOT IN ('cancelled', 'closed', 'returned')
 AND a."overlapQuarantinedAt" IS NULL AND b."overlapQuarantinedAt" IS NULL
 AND tsrange(a."periodStart", a."periodEnd") && tsrange(b."periodStart", b."periodEnd");

DO $$
DECLARE v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM "RentalAgreement" a
  JOIN "RentalAgreement" b
    ON a."rentableUnitId" = b."rentableUnitId"
   AND a.id < b.id
   AND a."rentableUnitId" IS NOT NULL
   AND a."status" NOT IN ('cancelled', 'closed', 'returned')
   AND b."status" NOT IN ('cancelled', 'closed', 'returned')
   AND a."overlapQuarantinedAt" IS NULL AND b."overlapQuarantinedAt" IS NULL
   AND tsrange(a."periodStart", a."periodEnd") && tsrange(b."periodStart", b."periodEnd");
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'expected 0 remaining active rental overlaps, got %', v_count;
  END IF;
END $$;

DO $$
BEGIN
  INSERT INTO "StorefrontBooking"(id,"providerId","scheduledAt","durationMinutes",status,"createdAt")
  VALUES ('future-bad','P2','2026-08-02 09:05',30,'confirmed',now());
  RAISE EXCEPTION 'expected future overlapping booking insert to fail';
EXCEPTION
  WHEN exclusion_violation THEN
    -- expected SQLSTATE 23P01
    NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'StorefrontBooking_no_overlap'
      AND pg_get_constraintdef(oid) LIKE '%overlapQuarantinedAt%'
  ) THEN
    RAISE EXCEPTION 'StorefrontBooking constraint is not quarantine-aware';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'RentalAgreement_no_overlap'
      AND pg_get_constraintdef(oid) LIKE '%overlapQuarantinedAt%'
  ) THEN
    RAISE EXCEPTION 'RentalAgreement constraint is not quarantine-aware';
  END IF;
END $$;

\echo 'BI-0CC492A8 repair harness complete'
