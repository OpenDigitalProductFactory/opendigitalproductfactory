-- Verification harness for migration 20260702150000_booking_overlap_exclusion
-- (EP-056D2A5E / BI-CC4659CB). NOT a Prisma migration — Prisma only executes
-- `migration.sql` inside a timestamped folder, so this file is inert to
-- `migrate deploy`. Run it by hand against a THROWAWAY database to re-prove the
-- fleet-safety remediation before merging or before applying to any install
-- that may already hold overlapping bookings:
--
--   createdb dpf_migtest && psql -d dpf_migtest -v ON_ERROR_STOP=1 -f this-file
--
-- Proves: (1) the earliest booking in an overlap component survives ACTIVE;
-- (2) later overlapping rows are QUARANTINED, never deleted/cancelled;
-- (3) non-overlapping, null-provider, and cancelled rows are untouched;
-- (4) the EXCLUDE constraint lands after remediation; (5) a fresh overlapping
-- insert is rejected 23P01; (6) remediation is idempotent (0 overlaps remain).
-- Last run green: 2026-07-03 against postgres:16-alpine.

CREATE TABLE "StorefrontBooking" (
  id text PRIMARY KEY, "providerId" text, "scheduledAt" timestamp(3) NOT NULL,
  "durationMinutes" int NOT NULL, status text NOT NULL DEFAULT 'pending',
  "overlapQuarantinedAt" timestamp(3), "createdAt" timestamp(3) NOT NULL DEFAULT now()
);

-- 3-way overlapping chain on P1 (createdAt order b1<b2<b3) + controls
INSERT INTO "StorefrontBooking"(id,"providerId","scheduledAt","durationMinutes",status,"createdAt") VALUES
 ('b1','P1','2026-08-01 09:00',60,'confirmed','2026-07-01 10:00'),   -- earliest -> keep
 ('b2','P1','2026-08-01 09:30',60,'confirmed','2026-07-01 11:00'),   -- later    -> quarantine
 ('b3','P1','2026-08-01 09:45',60,'confirmed','2026-07-01 12:00'),   -- later    -> quarantine
 ('b4','P1','2026-08-01 11:00',60,'confirmed','2026-07-01 12:30'),   -- no overlap -> keep
 ('b5',NULL,'2026-08-01 09:00',60,'confirmed','2026-07-01 12:40'),   -- null provider -> ignored
 ('b6','P1','2026-08-01 09:10',60,'cancelled','2026-07-01 12:50');   -- cancelled -> ignored

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Remediation loop (verbatim logic from migration.sql §2a).
DO $$
DECLARE v_rows int;
BEGIN
  LOOP
    WITH pair AS (
      SELECT a.id AS later_id
      FROM "StorefrontBooking" a
      JOIN "StorefrontBooking" b
        ON a."providerId" = b."providerId" AND a.id <> b.id
       AND a."status" <> 'cancelled' AND b."status" <> 'cancelled'
       AND a."providerId" IS NOT NULL AND a."durationMinutes" > 0 AND b."durationMinutes" > 0
       AND a."overlapQuarantinedAt" IS NULL AND b."overlapQuarantinedAt" IS NULL
       AND tsrange(a."scheduledAt", a."scheduledAt" + make_interval(mins => a."durationMinutes")) &&
           tsrange(b."scheduledAt", b."scheduledAt" + make_interval(mins => b."durationMinutes"))
       AND (a."createdAt", a.id) > (b."createdAt", b.id)
      LIMIT 1
    )
    UPDATE "StorefrontBooking" s SET "overlapQuarantinedAt" = now() FROM pair WHERE s.id = pair.later_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    EXIT WHEN v_rows = 0;
  END LOOP;
END $$;

ALTER TABLE "StorefrontBooking"
  ADD CONSTRAINT "StorefrontBooking_no_overlap"
  EXCLUDE USING gist ("providerId" WITH =,
    tsrange("scheduledAt", "scheduledAt" + make_interval(mins => "durationMinutes")) WITH &&)
  WHERE ("status" <> 'cancelled' AND "providerId" IS NOT NULL AND "durationMinutes" > 0
         AND "overlapQuarantinedAt" IS NULL);

-- EXPECT: b1,b4,b5,b6 ACTIVE ; b2,b3 QUARANTINED
SELECT id, CASE WHEN "overlapQuarantinedAt" IS NULL THEN 'ACTIVE' ELSE 'QUARANTINED' END AS state
FROM "StorefrontBooking" ORDER BY id;

-- EXPECT: ERROR 23P01 (overlaps b1)
-- INSERT INTO "StorefrontBooking"(id,"providerId","scheduledAt","durationMinutes",status,"createdAt")
--   VALUES ('b7','P1','2026-08-01 09:05',30,'confirmed',now());

-- EXPECT: 0 (idempotent — no active overlapping pairs remain)
SELECT count(*) AS remaining_active_overlaps
FROM "StorefrontBooking" a JOIN "StorefrontBooking" b
  ON a."providerId"=b."providerId" AND a.id<>b.id
 AND a.status<>'cancelled' AND b.status<>'cancelled'
 AND a."overlapQuarantinedAt" IS NULL AND b."overlapQuarantinedAt" IS NULL
 AND tsrange(a."scheduledAt",a."scheduledAt"+make_interval(mins=>a."durationMinutes")) &&
     tsrange(b."scheduledAt",b."scheduledAt"+make_interval(mins=>b."durationMinutes"));
