-- A previously exercised demo walk-in can have a terminal service turn. The
-- busy-shift refresh must not reopen that historical aggregate or attach new
-- capacity to it. Preserve the history, release any stale terminal allocation,
-- and mint one fresh demo demand for the canonical host-stand acceptance path.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "StorefrontBooking" booking
    WHERE (
      booking.id = 'demo_restaurant_booking_live_1'
      OR booking."bookingRef" = 'demo-restaurant-bk-live-1'
    )
      AND NOT EXISTS (
        SELECT 1
        FROM "StorefrontConfig" config
        JOIN "StorefrontArchetype" archetype ON archetype.id = config."archetypeId"
        WHERE config.id = booking."storefrontId"
          AND config."organizationId" = booking."organizationId"
          AND archetype."archetypeId" = 'restaurant'
          AND booking.id = 'demo_restaurant_booking_live_1'
          AND booking."bookingRef" = 'demo-restaurant-bk-live-1'
      )
  ) THEN
    RAISE EXCEPTION 'Reserved Restaurant demo live walk-in identifiers are attached to non-demo data';
  END IF;
END $$;

UPDATE "HospitalityCapacityAllocation" allocation
SET
  lifecycle = 'released',
  "releasedAt" = CURRENT_TIMESTAMP,
  "releaseReason" = 'Restaurant demo stale terminal allocation released',
  version = allocation.version + 1,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "StorefrontBooking" booking
JOIN "HospitalityServiceTurn" turn
  ON turn."bookingId" = booking.id
  AND turn."organizationId" = booking."organizationId"
WHERE booking."bookingRef" = 'demo-restaurant-bk-0'
  AND turn.stage IN ('closed', 'cancelled')
  AND allocation."bookingId" = booking.id
  AND allocation."serviceTurnId" = turn.id
  AND allocation.lifecycle IN ('reserved', 'active');

INSERT INTO "StorefrontBooking" (
  id, "bookingRef", "storefrontId", "itemId", "customerContactId",
  "customerEmail", "customerName", "customerPhone", "scheduledAt",
  "durationMinutes", notes, status, "createdAt", "updatedAt",
  "assignmentMode", "cancellationReason", "cancelledAt", "fromReschedule",
  "idempotencyKey", "parentBookingId", "providerId", "recurrenceEndDate",
  "recurrenceRule", "overlapQuarantinedAt", "organizationId", covers,
  "dietaryNotes", "hospitalityResourceId", "demandKind"
)
SELECT
  'demo_restaurant_booking_live_1',
  'demo-restaurant-bk-live-1',
  booking."storefrontId",
  booking."itemId",
  booking."customerContactId",
  booking."customerEmail",
  booking."customerName",
  booking."customerPhone",
  CURRENT_TIMESTAMP,
  90,
  NULL,
  'waiting',
  CURRENT_TIMESTAMP - INTERVAL '14 minutes',
  CURRENT_TIMESTAMP,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  booking."organizationId",
  3,
  NULL,
  NULL,
  'walk-in'
FROM "StorefrontBooking" booking
JOIN "StorefrontConfig" config ON config.id = booking."storefrontId"
JOIN "StorefrontArchetype" archetype ON archetype.id = config."archetypeId"
WHERE booking."bookingRef" = 'demo-restaurant-bk-0'
  AND config."organizationId" = booking."organizationId"
  AND archetype."archetypeId" = 'restaurant'
  AND EXISTS (
    SELECT 1
    FROM "HospitalityServiceTurn" turn
    WHERE turn."bookingId" = booking.id
      AND turn."organizationId" = booking."organizationId"
      AND turn.stage IN ('closed', 'cancelled')
  )
ON CONFLICT ("bookingRef") DO NOTHING;
