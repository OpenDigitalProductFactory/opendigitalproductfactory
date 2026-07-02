-- EP-056D2A5E / BI-CC4659CB — atomic double-booking prevention.
--
-- Kernel decision D2 (principle_decide, 2026-07-02, margin 4.70, high
-- confidence) = gist EXCLUDE constraint: the correct primitive for time-range
-- OVERLAP. A plain UNIQUE only catches identical windows; an application-level
-- check-then-create is a TOCTOU race. These constraints make an overlapping
-- reservation a database error (SQLSTATE 23P01), enforced regardless of which
-- session, process, or code path issues the write.
--
-- btree_gist supplies the `=` gist operator class for the scalar equality
-- column (providerId / rentableUnitId) so it can share the gist index with the
-- range-overlap (&&) term. DateTime maps to timestamp(3) (no tz) in this schema,
-- so tsrange (not tstzrange) matches the column type.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Service bookings: at most one active booking per provider per overlapping
-- time window. Partial predicate excludes cancelled bookings and unassigned
-- (providerId IS NULL) rows, which carry no provider to contend over.
ALTER TABLE "StorefrontBooking"
  ADD CONSTRAINT "StorefrontBooking_no_overlap"
  EXCLUDE USING gist (
    "providerId" WITH =,
    tsrange("scheduledAt", "scheduledAt" + make_interval(mins => "durationMinutes")) WITH &&
  )
  WHERE ("status" <> 'cancelled' AND "providerId" IS NOT NULL AND "durationMinutes" > 0);

-- Rental agreements: at most one live agreement per serialized unit per
-- overlapping period. Quantity-pool classes (rentableUnitId IS NULL) and
-- terminal agreements are excluded from contention.
ALTER TABLE "RentalAgreement"
  ADD CONSTRAINT "RentalAgreement_no_overlap"
  EXCLUDE USING gist (
    "rentableUnitId" WITH =,
    tsrange("periodStart", "periodEnd") WITH &&
  )
  WHERE ("rentableUnitId" IS NOT NULL AND "status" NOT IN ('cancelled', 'closed', 'returned'));
