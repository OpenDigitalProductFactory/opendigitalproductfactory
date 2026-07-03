-- EP-056D2A5E / BI-CC4659CB — atomic double-booking prevention.
--
-- Kernel decision D2 (principle_decide, 2026-07-02, margin 4.70, high
-- confidence) = gist EXCLUDE constraint: the correct primitive for time-range
-- OVERLAP. A plain UNIQUE only catches identical windows; an application-level
-- check-then-create is a TOCTOU race. These constraints make an overlapping
-- reservation a database error (SQLSTATE 23P01), enforced regardless of which
-- session, process, or code path issues the write.
--
-- FLEET-SAFETY (kernel decision B, principle_decide 2026-07-03, margin 1.25,
-- high confidence, no commandment conflict): a plain ADD CONSTRAINT would FAIL
-- on any install that already has an overlapping booking (possible precisely
-- because the old raceable code allowed it). Under the fail-closed self-upgrade
-- promoter (scripts/promote.sh, `set -e`, migrate runs pre-swap) that does not
-- brick the install, but it WEDGES the forward-only migration chain — the
-- busiest installs would freeze on the old version and stop receiving all future
-- updates. So we REMEDIATE pre-existing overlaps first, then add the constraint.
--
-- Remediation = QUARANTINE, not delete/cancel (kernel rejected auto-cancel as
-- destructive-without-consent, ranked last 1.89 vs 6.92). For each overlapping
-- pair we park the LATER-created row (keep the earliest) in `overlapQuarantinedAt`
-- WITHOUT touching its status — no customer booking is destroyed, the row stays
-- fully recoverable, and non-null rows form an operator review queue. The
-- constraint predicate then excludes quarantined rows. This whole file is
-- idempotent: on a clean DB it quarantines nothing; re-running is a no-op.
--
-- btree_gist supplies the `=` gist operator class for the scalar equality
-- column (providerId / rentableUnitId) so it can share the gist index with the
-- range-overlap (&&) term. DateTime maps to timestamp(3) (no tz) in this schema,
-- so tsrange (not tstzrange) matches the column type.

-- 1. Quarantine columns (additive + nullable = safe while old code still runs).
ALTER TABLE "StorefrontBooking" ADD COLUMN IF NOT EXISTS "overlapQuarantinedAt" TIMESTAMP(3);
ALTER TABLE "RentalAgreement"  ADD COLUMN IF NOT EXISTS "overlapQuarantinedAt" TIMESTAMP(3);

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 2a. Remediate pre-existing StorefrontBooking overlaps. Loop-until-clean: each
-- pass parks the later row of one still-active overlapping pair; the globally
-- earliest row in any component is never the "later" row, so it always survives.
-- Terminates because every pass quarantines >= 1 row (or exits at zero).
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
       AND (a."createdAt", a.id) > (b."createdAt", b.id)  -- a is the LATER row of the pair
      LIMIT 1
    )
    UPDATE "StorefrontBooking" s
       SET "overlapQuarantinedAt" = now()
      FROM pair WHERE s.id = pair.later_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    EXIT WHEN v_rows = 0;
  END LOOP;
END $$;

-- 2b. Remediate pre-existing RentalAgreement overlaps (same strategy).
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

-- 3. Service bookings: at most one active booking per provider per overlapping
-- time window. Predicate excludes cancelled, unassigned (providerId IS NULL),
-- and quarantined rows.
ALTER TABLE "StorefrontBooking"
  ADD CONSTRAINT "StorefrontBooking_no_overlap"
  EXCLUDE USING gist (
    "providerId" WITH =,
    tsrange("scheduledAt", "scheduledAt" + make_interval(mins => "durationMinutes")) WITH &&
  )
  WHERE ("status" <> 'cancelled' AND "providerId" IS NOT NULL AND "durationMinutes" > 0
         AND "overlapQuarantinedAt" IS NULL);

-- 4. Rental agreements: at most one live agreement per serialized unit per
-- overlapping period. Quantity-pool classes (rentableUnitId IS NULL), terminal
-- agreements, and quarantined rows are excluded from contention.
ALTER TABLE "RentalAgreement"
  ADD CONSTRAINT "RentalAgreement_no_overlap"
  EXCLUDE USING gist (
    "rentableUnitId" WITH =,
    tsrange("periodStart", "periodEnd") WITH &&
  )
  WHERE ("rentableUnitId" IS NOT NULL AND "status" NOT IN ('cancelled', 'closed', 'returned')
         AND "overlapQuarantinedAt" IS NULL);
