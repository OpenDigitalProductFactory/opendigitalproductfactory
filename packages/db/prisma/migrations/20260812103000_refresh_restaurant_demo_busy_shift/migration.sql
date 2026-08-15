-- Keep the platform-owned Restaurant demo usable after the original one-time
-- fixture window has elapsed. Real restaurant shifts and bookings are excluded
-- by the stable demo identifiers and the Restaurant archetype join.

UPDATE "StaffingShift" shift
SET
  "startAt" = TIMESTAMPTZ '2020-01-01 00:00:00+00',
  "endAt" = TIMESTAMPTZ '2100-01-01 00:00:00+00',
  lifecycle = 'published',
  "publicationVersion" = shift."publicationVersion" + 1,
  version = shift.version + 1,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE shift."shiftId" IN ('demo-restaurant-shift-1', 'demo-restaurant-shift-2')
  AND EXISTS (
    SELECT 1
    FROM "StorefrontConfig" config
    JOIN "StorefrontArchetype" archetype ON archetype.id = config."archetypeId"
    WHERE config."organizationId" = shift."organizationId"
      AND archetype."archetypeId" = 'restaurant'
  );

WITH demo_state AS (
  SELECT * FROM (VALUES
    (0, 'waiting',   INTERVAL '0 minutes',    INTERVAL '-14 minutes'),
    (1, 'confirmed', INTERVAL '9 minutes',    INTERVAL '-120 minutes'),
    (2, 'seated',    INTERVAL '-55 minutes',  INTERVAL '-180 minutes'),
    (3, 'seated',    INTERVAL '-100 minutes', INTERVAL '-108 minutes'),
    (4, 'seated',    INTERVAL '-50 minutes',  INTERVAL '-240 minutes'),
    (5, 'seated',    INTERVAL '-84 minutes',  INTERVAL '-91 minutes'),
    (6, 'seated',    INTERVAL '-102 minutes', INTERVAL '-210 minutes')
  ) AS state(booking_index, status, scheduled_offset, created_offset)
)
UPDATE "StorefrontBooking" booking
SET
  "demandKind" = CASE WHEN state.booking_index IN (0, 3, 5) THEN 'walk-in' ELSE 'reservation' END,
  covers = CASE state.booking_index
    WHEN 0 THEN 3 WHEN 1 THEN 4 WHEN 2 THEN 4 WHEN 3 THEN 2
    WHEN 4 THEN 8 WHEN 5 THEN 2 ELSE 4 END,
  status = state.status,
  "scheduledAt" = CURRENT_TIMESTAMP + state.scheduled_offset,
  "createdAt" = CURRENT_TIMESTAMP + state.created_offset,
  "durationMinutes" = 90,
  "dietaryNotes" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
FROM demo_state state, "StorefrontConfig" config, "StorefrontArchetype" archetype
WHERE booking."bookingRef" = 'demo-restaurant-bk-' || state.booking_index
  AND config.id = booking."storefrontId"
  AND archetype.id = config."archetypeId"
  AND archetype."archetypeId" = 'restaurant';

WITH turn_state AS (
  SELECT * FROM (VALUES
    (2, 'ordered', INTERVAL '-55 minutes',  INTERVAL '35 minutes', 1),
    (3, 'dirty',   INTERVAL '-100 minutes', INTERVAL '-10 minutes', 1),
    (4, 'ordered', INTERVAL '-50 minutes',  INTERVAL '40 minutes', 1),
    (5, 'paid',    INTERVAL '-84 minutes',  INTERVAL '6 minutes',  2),
    (6, 'seated',  INTERVAL '-102 minutes', INTERVAL '-12 minutes', 1)
  ) AS state(booking_index, stage, started_offset, end_offset, section_index)
)
UPDATE "HospitalityServiceTurn" turn
SET
  "staffingAssignmentId" = assignment.id,
  stage = state.stage,
  "startedAt" = CURRENT_TIMESTAMP + state.started_offset,
  "expectedEndAt" = CURRENT_TIMESTAMP + state.end_offset,
  "closedAt" = NULL,
  version = turn.version + 1,
  "updatedAt" = CURRENT_TIMESTAMP
FROM turn_state state
JOIN "StaffingAssignment" assignment
  ON assignment."assignmentId" = 'demo-restaurant-assignment-' || state.section_index
WHERE turn."turnId" = 'demo-restaurant-turn-' || state.booking_index;

UPDATE "HospitalityCapacityAllocation" allocation
SET
  lifecycle = 'released',
  "releasedAt" = CURRENT_TIMESTAMP,
  "releaseReason" = 'Restaurant demo busy shift refreshed',
  version = allocation.version + 1,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "StorefrontBooking" booking
WHERE allocation."bookingId" = booking.id
  AND booking."bookingRef" ~ '^demo-restaurant-bk-[0-6]$'
  AND allocation.lifecycle IN ('reserved', 'active');

WITH turn_tables AS (
  SELECT * FROM (VALUES
    (2, 'demo-restaurant-table-2'),
    (3, 'demo-restaurant-table-3'),
    (4, 'demo-restaurant-table-5'),
    (4, 'demo-restaurant-table-6'),
    (5, 'demo-restaurant-table-7'),
    (6, 'demo-restaurant-table-8')
  ) AS mapping(booking_index, resource_ref)
)
INSERT INTO "HospitalityCapacityAllocation" (
  id, "allocationId", "organizationId", "storefrontId", "resourceId",
  "bookingId", "serviceTurnId", "demandType", "demandRef", "startsAt",
  "endsAt", quantity, lifecycle, "idempotencyKey", version, "createdAt", "updatedAt"
)
SELECT
  'demo_restaurant_allocation_' || mapping.booking_index || '_' || resource."resourceId",
  'demo-restaurant-turn-' || mapping.booking_index || '-' || replace(resource."resourceId", 'demo-restaurant-', ''),
  booking."organizationId", booking."storefrontId", resource.id,
  booking.id, turn.id, 'booking', booking."bookingRef",
  turn."startedAt", turn."expectedEndAt", 1, 'active',
  'demo-restaurant-turn-' || mapping.booking_index || '-' || resource."resourceId" || ':active',
  1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM turn_tables mapping
JOIN "StorefrontBooking" booking
  ON booking."bookingRef" = 'demo-restaurant-bk-' || mapping.booking_index
JOIN "HospitalityServiceTurn" turn
  ON turn."turnId" = 'demo-restaurant-turn-' || mapping.booking_index
JOIN "HospitalityResource" resource
  ON resource."storefrontId" = booking."storefrontId"
  AND resource."resourceId" = mapping.resource_ref
ON CONFLICT ("allocationId") DO UPDATE SET
  "resourceId" = EXCLUDED."resourceId",
  "serviceTurnId" = EXCLUDED."serviceTurnId",
  "startsAt" = EXCLUDED."startsAt",
  "endsAt" = EXCLUDED."endsAt",
  lifecycle = 'active',
  "releasedAt" = NULL,
  "releaseReason" = NULL,
  version = "HospitalityCapacityAllocation".version + 1,
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "HospitalityCapacityAllocation" (
  id, "allocationId", "organizationId", "storefrontId", "resourceId",
  "bookingId", "demandType", "demandRef", "startsAt", "endsAt",
  quantity, lifecycle, "idempotencyKey", version, "createdAt", "updatedAt"
)
SELECT
  'demo_restaurant_reservation_table_9',
  'demo-restaurant-reservation-table-9',
  booking."organizationId", booking."storefrontId", resource.id,
  booking.id, 'booking', booking."bookingRef", booking."scheduledAt",
  booking."scheduledAt" + INTERVAL '90 minutes', 1, 'reserved',
  'demo-restaurant-reservation-table-9:reserved', 1,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "StorefrontBooking" booking
JOIN "HospitalityResource" resource
  ON resource."storefrontId" = booking."storefrontId"
  AND resource."resourceId" = 'demo-restaurant-table-9'
WHERE booking."bookingRef" = 'demo-restaurant-bk-1'
ON CONFLICT ("allocationId") DO UPDATE SET
  "resourceId" = EXCLUDED."resourceId",
  "startsAt" = EXCLUDED."startsAt",
  "endsAt" = EXCLUDED."endsAt",
  lifecycle = 'reserved',
  "releasedAt" = NULL,
  "releaseReason" = NULL,
  version = "HospitalityCapacityAllocation".version + 1,
  "updatedAt" = CURRENT_TIMESTAMP;
