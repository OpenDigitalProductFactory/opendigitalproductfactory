-- Repair only the platform-owned, reversible restaurant demo corpus. Real
-- hospitality resources and operator-authored restaurant data are untouched.
WITH demo_tables AS (
  SELECT
    resource.id,
    provider."providerId",
    substring(provider."providerId" FROM 'res-([0-9]+)$')::INTEGER AS table_index
  FROM "HospitalityResource" resource
  JOIN "ServiceProvider" provider
    ON provider.id = resource."legacyServiceProviderId"
  JOIN "StorefrontConfig" storefront ON storefront.id = resource."storefrontId"
  JOIN "StorefrontArchetype" archetype ON archetype.id = storefront."archetypeId"
  WHERE provider."providerId" ~ '^demo-restaurant-prov-res-[0-8]$'
    AND archetype."archetypeId" = 'restaurant'
)
UPDATE "HospitalityResource" resource
SET
  "resourceId" = 'demo-restaurant-table-' || (demo.table_index + 1),
  label = CASE demo.table_index
    WHEN 0 THEN 'Aster 1' WHEN 1 THEN 'Aster 2' WHEN 2 THEN 'Aster 3'
    WHEN 3 THEN 'Aster 4' WHEN 4 THEN 'Harvest 1' WHEN 5 THEN 'Harvest 2'
    WHEN 6 THEN 'Window 1' WHEN 7 THEN 'Window 2' ELSE 'Patio 1'
  END,
  capacity = CASE demo.table_index
    WHEN 0 THEN 4 WHEN 1 THEN 4 WHEN 2 THEN 2 WHEN 3 THEN 4
    WHEN 4 THEN 4 WHEN 5 THEN 4 WHEN 6 THEN 2 WHEN 7 THEN 4 ELSE 6
  END,
  "serviceArea" = CASE
    WHEN demo.table_index <= 5 THEN 'Main dining'
    WHEN demo.table_index <= 7 THEN 'Window room'
    ELSE 'Patio'
  END,
  status = CASE WHEN demo.table_index = 3 THEN 'blocked' ELSE 'active' END,
  "blockedReason" = CASE WHEN demo.table_index = 3 THEN 'Chair repair' ELSE NULL END,
  attributes = jsonb_build_object(
    'shape',
    CASE
      WHEN demo.table_index IN (2) THEN 'square'
      WHEN demo.table_index IN (4, 5, 8) THEN 'rectangle'
      WHEN demo.table_index IN (6, 7) THEN 'booth'
      ELSE 'round'
    END
  ) || CASE
    WHEN demo.table_index IN (4, 5)
      THEN jsonb_build_object('combinationGroup', 'banquet-a')
    ELSE '{}'::jsonb
  END,
  version = resource.version + 1,
  "updatedAt" = CURRENT_TIMESTAMP
FROM demo_tables demo
WHERE resource.id = demo.id;

-- The authored demo roster puts two real server identities into the staffing
-- substrate. These refs are platform-owned; no operator employee is renamed.
UPDATE "EmployeeProfile"
SET
  "firstName" = CASE "employeeId"
    WHEN 'demo-restaurant-emp-worker-0' THEN 'Chloe'
    WHEN 'demo-restaurant-emp-worker-1' THEN 'Leo'
    ELSE 'Maya'
  END,
  "lastName" = CASE "employeeId"
    WHEN 'demo-restaurant-emp-worker-0' THEN 'Tan'
    WHEN 'demo-restaurant-emp-worker-1' THEN 'Marchetti'
    ELSE 'Okafor'
  END,
  "displayName" = CASE "employeeId"
    WHEN 'demo-restaurant-emp-worker-0' THEN 'Chloe Tan'
    WHEN 'demo-restaurant-emp-worker-1' THEN 'Leo Marchetti'
    ELSE 'Maya Okafor'
  END,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "employeeId" IN (
  'demo-restaurant-emp-worker-0',
  'demo-restaurant-emp-worker-1',
  'demo-restaurant-emp-worker-2'
);

WITH demo_bookings AS (
  SELECT
    booking.id,
    substring(booking."bookingRef" FROM 'bk-([0-9]+)$')::INTEGER AS booking_index
  FROM "StorefrontBooking" booking
  JOIN "StorefrontConfig" storefront ON storefront.id = booking."storefrontId"
  JOIN "StorefrontArchetype" archetype ON archetype.id = storefront."archetypeId"
  WHERE booking."bookingRef" ~ '^demo-restaurant-bk-[0-6]$'
    AND archetype."archetypeId" = 'restaurant'
)
UPDATE "StorefrontBooking" booking
SET
  "demandKind" = CASE WHEN demo.booking_index IN (0, 3, 5) THEN 'walk-in' ELSE 'reservation' END,
  covers = CASE demo.booking_index
    WHEN 0 THEN 3 WHEN 1 THEN 4 WHEN 2 THEN 4 WHEN 3 THEN 2
    WHEN 4 THEN 8 WHEN 5 THEN 2 ELSE 4
  END,
  status = CASE WHEN demo.booking_index = 0 THEN 'waiting' WHEN demo.booking_index = 1 THEN 'confirmed' ELSE 'seated' END,
  "scheduledAt" = CURRENT_TIMESTAMP + CASE demo.booking_index
    WHEN 0 THEN INTERVAL '0 minutes' WHEN 1 THEN INTERVAL '9 minutes'
    WHEN 2 THEN INTERVAL '-55 minutes' WHEN 3 THEN INTERVAL '-100 minutes'
    WHEN 4 THEN INTERVAL '-50 minutes' WHEN 5 THEN INTERVAL '-84 minutes'
    ELSE INTERVAL '-102 minutes'
  END,
  "createdAt" = CURRENT_TIMESTAMP + CASE demo.booking_index
    WHEN 0 THEN INTERVAL '-14 minutes' WHEN 1 THEN INTERVAL '-120 minutes'
    WHEN 2 THEN INTERVAL '-180 minutes' WHEN 3 THEN INTERVAL '-108 minutes'
    WHEN 4 THEN INTERVAL '-240 minutes' WHEN 5 THEN INTERVAL '-91 minutes'
    ELSE INTERVAL '-210 minutes'
  END,
  "durationMinutes" = 90,
  "dietaryNotes" = CASE WHEN demo.booking_index = 0 THEN 'Allergy note held for authorized staff' ELSE NULL END,
  "hospitalityResourceId" = CASE demo.booking_index
    WHEN 1 THEN (SELECT id FROM "HospitalityResource" WHERE "storefrontId" = booking."storefrontId" AND "resourceId" = 'demo-restaurant-table-9')
    WHEN 2 THEN (SELECT id FROM "HospitalityResource" WHERE "storefrontId" = booking."storefrontId" AND "resourceId" = 'demo-restaurant-table-2')
    WHEN 3 THEN (SELECT id FROM "HospitalityResource" WHERE "storefrontId" = booking."storefrontId" AND "resourceId" = 'demo-restaurant-table-3')
    WHEN 4 THEN (SELECT id FROM "HospitalityResource" WHERE "storefrontId" = booking."storefrontId" AND "resourceId" = 'demo-restaurant-table-5')
    WHEN 5 THEN (SELECT id FROM "HospitalityResource" WHERE "storefrontId" = booking."storefrontId" AND "resourceId" = 'demo-restaurant-table-7')
    WHEN 6 THEN (SELECT id FROM "HospitalityResource" WHERE "storefrontId" = booking."storefrontId" AND "resourceId" = 'demo-restaurant-table-8')
    ELSE NULL
  END,
  "updatedAt" = CURRENT_TIMESTAMP
FROM demo_bookings demo
WHERE booking.id = demo.id;

-- Published demo shifts establish the two server sections consumed by the live
-- floor projection. The internal ids are stable and scoped to demo refs.
INSERT INTO "StaffingShift" (
  id, "shiftId", "organizationId", "startAt", "endAt", timezone,
  lifecycle, "publicationVersion", version, "createdAt", "updatedAt"
)
SELECT
  'demo_restaurant_shift_' || section.section_index,
  'demo-restaurant-shift-' || section.section_index,
  org.id,
  CURRENT_TIMESTAMP - INTERVAL '4 hours',
  CURRENT_TIMESTAMP + INTERVAL '4 hours',
  COALESCE(config.timezone, 'UTC'),
  'published', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization" org
JOIN "StorefrontConfig" config ON config."organizationId" = org.id
JOIN "StorefrontArchetype" archetype ON archetype.id = config."archetypeId"
CROSS JOIN (VALUES (1), (2)) AS section(section_index)
WHERE archetype."archetypeId" = 'restaurant'
  AND EXISTS (
    SELECT 1 FROM "StorefrontBooking" booking
    WHERE booking."organizationId" = org.id
      AND booking."bookingRef" LIKE 'demo-restaurant-bk-%'
  )
ON CONFLICT ("shiftId") DO UPDATE SET
  "startAt" = EXCLUDED."startAt",
  "endAt" = EXCLUDED."endAt",
  timezone = EXCLUDED.timezone,
  lifecycle = 'published',
  "publicationVersion" = "StaffingShift"."publicationVersion" + 1,
  version = "StaffingShift".version + 1,
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "StaffingAssignment" (
  id, "assignmentId", "organizationId", "staffingShiftId",
  "employeeProfileId", lifecycle, source, version, "createdAt", "updatedAt"
)
SELECT
  'demo_restaurant_assignment_' || section.section_index,
  'demo-restaurant-assignment-' || section.section_index,
  shift."organizationId",
  shift.id,
  employee.id,
  'on_site', 'demo', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  (1, 'demo-restaurant-emp-worker-1'),
  (2, 'demo-restaurant-emp-worker-2')
) AS section(section_index, employee_ref)
JOIN "StaffingShift" shift
  ON shift."shiftId" = 'demo-restaurant-shift-' || section.section_index
JOIN "EmployeeProfile" employee ON employee."employeeId" = section.employee_ref
ON CONFLICT ("assignmentId") DO UPDATE SET
  "staffingShiftId" = EXCLUDED."staffingShiftId",
  "employeeProfileId" = EXCLUDED."employeeProfileId",
  lifecycle = 'on_site',
  source = 'demo',
  version = "StaffingAssignment".version + 1,
  "updatedAt" = CURRENT_TIMESTAMP;

DELETE FROM "StaffingResourceLink" link
USING "StaffingShift" shift
WHERE link."staffingShiftId" = shift.id
  AND shift."shiftId" IN ('demo-restaurant-shift-1', 'demo-restaurant-shift-2')
  AND link."resourceType" = 'table';

INSERT INTO "StaffingResourceLink" (
  id, "organizationId", "staffingShiftId", "resourceType", "resourceRef", "createdAt"
)
SELECT
  'demo_restaurant_link_' || md5(shift.id || resource.id),
  shift."organizationId",
  shift.id,
  'table',
  resource.id,
  CURRENT_TIMESTAMP
FROM "StaffingShift" shift
JOIN "HospitalityResource" resource ON resource."organizationId" = shift."organizationId"
WHERE shift."shiftId" IN ('demo-restaurant-shift-1', 'demo-restaurant-shift-2')
  AND resource."resourceId" ~ '^demo-restaurant-table-[1-9]$'
  AND (
    (shift."shiftId" = 'demo-restaurant-shift-1' AND resource."resourceId" IN (
      'demo-restaurant-table-1', 'demo-restaurant-table-2', 'demo-restaurant-table-3',
      'demo-restaurant-table-4', 'demo-restaurant-table-5', 'demo-restaurant-table-8'
    ))
    OR
    (shift."shiftId" = 'demo-restaurant-shift-2' AND resource."resourceId" IN (
      'demo-restaurant-table-6', 'demo-restaurant-table-7', 'demo-restaurant-table-9'
    ))
  );

-- Preserve old allocations as released history before making the authored demo
-- turn state active. No capacity row is deleted.
UPDATE "HospitalityCapacityAllocation" allocation
SET
  lifecycle = 'released',
  "releasedAt" = CURRENT_TIMESTAMP,
  "releaseReason" = 'Restaurant demo state refreshed',
  version = allocation.version + 1,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "StorefrontBooking" booking
WHERE allocation."bookingId" = booking.id
  AND booking."bookingRef" ~ '^demo-restaurant-bk-[0-6]$'
  AND allocation.lifecycle IN ('reserved', 'active');

INSERT INTO "HospitalityServiceTurn" (
  id, "turnId", "organizationId", "storefrontId", "bookingId",
  "staffingAssignmentId", "demandType", "demandRef", stage,
  "startedAt", "expectedEndAt", version, "createdAt", "updatedAt"
)
SELECT
  'demo_restaurant_turn_' || turn.booking_index,
  'demo-restaurant-turn-' || turn.booking_index,
  booking."organizationId",
  booking."storefrontId",
  booking.id,
  assignment.id,
  'booking',
  booking."bookingRef",
  turn.stage,
  CURRENT_TIMESTAMP + turn.started_offset,
  CURRENT_TIMESTAMP + turn.end_offset,
  1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  (2, 'ordered', INTERVAL '-55 minutes', INTERVAL '35 minutes', 1),
  (3, 'dirty',   INTERVAL '-100 minutes', INTERVAL '-10 minutes', 1),
  (4, 'ordered', INTERVAL '-50 minutes', INTERVAL '40 minutes', 1),
  (5, 'paid',    INTERVAL '-84 minutes', INTERVAL '6 minutes', 2),
  (6, 'seated',  INTERVAL '-102 minutes', INTERVAL '-12 minutes', 1)
) AS turn(booking_index, stage, started_offset, end_offset, section_index)
JOIN "StorefrontBooking" booking
  ON booking."bookingRef" = 'demo-restaurant-bk-' || turn.booking_index
JOIN "StaffingAssignment" assignment
  ON assignment."assignmentId" = 'demo-restaurant-assignment-' || turn.section_index
ON CONFLICT ("turnId") DO UPDATE SET
  "staffingAssignmentId" = EXCLUDED."staffingAssignmentId",
  stage = EXCLUDED.stage,
  "startedAt" = EXCLUDED."startedAt",
  "expectedEndAt" = EXCLUDED."expectedEndAt",
  "closedAt" = NULL,
  version = "HospitalityServiceTurn".version + 1,
  "updatedAt" = CURRENT_TIMESTAMP;

-- HospitalityServiceTurnEvent owns occurredAt (not the createdAt convention
-- used by the mutable aggregates above) and enforces the canonical event type.
INSERT INTO "HospitalityServiceTurnEvent" (
  id, "eventId", "organizationId", "serviceTurnId", "idempotencyKey",
  "eventType", "toStage", "atVersion", "actorRef", "occurredAt"
)
SELECT
  'demo_restaurant_turn_event_' || turn."turnId",
  turn."turnId" || '-seeded',
  turn."organizationId",
  turn.id,
  turn."turnId" || ':seeded',
  'stage-transition',
  turn.stage,
  1,
  'demo-loader',
  CURRENT_TIMESTAMP
FROM "HospitalityServiceTurn" turn
WHERE turn."turnId" ~ '^demo-restaurant-turn-[2-6]$'
ON CONFLICT ("eventId") DO NOTHING;

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
  booking."organizationId",
  booking."storefrontId",
  resource.id,
  booking.id,
  turn.id,
  'booking',
  booking."bookingRef",
  turn."startedAt",
  turn."expectedEndAt",
  1,
  'active',
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
  "bookingId", "demandType", "demandRef", "startsAt", "endsAt", quantity,
  lifecycle, "idempotencyKey", version, "createdAt", "updatedAt"
)
SELECT
  'demo_restaurant_reservation_table_9',
  'demo-restaurant-reservation-table-9',
  booking."organizationId",
  booking."storefrontId",
  resource.id,
  booking.id,
  'booking',
  booking."bookingRef",
  booking."scheduledAt",
  booking."scheduledAt" + INTERVAL '90 minutes',
  1, 'reserved', 'demo-restaurant-reservation-table-9:reserved', 1,
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
