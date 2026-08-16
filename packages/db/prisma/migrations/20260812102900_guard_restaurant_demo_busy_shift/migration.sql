-- Fail closed before refreshing reserved Restaurant demo identifiers. This guard
-- runs immediately before 20260812103000 and leaves installs without the demo
-- corpus untouched. A reserved identifier collision must be resolved explicitly;
-- it must never turn a demo refresh into an operator-data mutation.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "StorefrontBooking" booking
    WHERE booking."bookingRef" ~ '^demo-restaurant-bk-[0-6]$'
      AND NOT EXISTS (
        SELECT 1
        FROM "StorefrontConfig" config
        JOIN "StorefrontArchetype" archetype ON archetype.id = config."archetypeId"
        WHERE config.id = booking."storefrontId"
          AND config."organizationId" = booking."organizationId"
          AND archetype."archetypeId" = 'restaurant'
      )
  ) THEN
    RAISE EXCEPTION 'Reserved Restaurant demo booking identifiers are attached to non-demo data';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "StaffingShift" shift
    WHERE shift."shiftId" IN ('demo-restaurant-shift-1', 'demo-restaurant-shift-2')
      AND NOT EXISTS (
        SELECT 1
        FROM "StorefrontBooking" booking
        JOIN "StorefrontConfig" config ON config.id = booking."storefrontId"
        JOIN "StorefrontArchetype" archetype ON archetype.id = config."archetypeId"
        WHERE booking."organizationId" = shift."organizationId"
          AND booking."bookingRef" ~ '^demo-restaurant-bk-[0-6]$'
          AND archetype."archetypeId" = 'restaurant'
      )
  ) THEN
    RAISE EXCEPTION 'Reserved Restaurant demo shift identifiers are attached to non-demo data';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "StaffingAssignment" assignment
    WHERE assignment."assignmentId" IN (
      'demo-restaurant-assignment-1',
      'demo-restaurant-assignment-2'
    )
      AND NOT EXISTS (
        SELECT 1
        FROM "StorefrontBooking" booking
        JOIN "StorefrontConfig" config ON config.id = booking."storefrontId"
        JOIN "StorefrontArchetype" archetype ON archetype.id = config."archetypeId"
        WHERE booking."organizationId" = assignment."organizationId"
          AND booking."bookingRef" ~ '^demo-restaurant-bk-[0-6]$'
          AND archetype."archetypeId" = 'restaurant'
      )
  ) THEN
    RAISE EXCEPTION 'Reserved Restaurant demo assignment identifiers are attached to non-demo data';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "HospitalityServiceTurn" turn
    WHERE turn."turnId" ~ '^demo-restaurant-turn-[2-6]$'
      AND NOT EXISTS (
        SELECT 1
        FROM "StorefrontBooking" booking
        JOIN "StorefrontConfig" config ON config.id = booking."storefrontId"
        JOIN "StorefrontArchetype" archetype ON archetype.id = config."archetypeId"
        WHERE booking.id = turn."bookingId"
          AND booking."organizationId" = turn."organizationId"
          AND booking."storefrontId" = turn."storefrontId"
          AND booking."bookingRef" = replace(turn."turnId", 'demo-restaurant-turn-', 'demo-restaurant-bk-')
          AND archetype."archetypeId" = 'restaurant'
      )
  ) THEN
    RAISE EXCEPTION 'Reserved Restaurant demo turn identifiers are attached to non-demo data';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "HospitalityCapacityAllocation" allocation
    JOIN (VALUES
      ('demo-restaurant-turn-2-table-2', 'demo-restaurant-bk-2'),
      ('demo-restaurant-turn-3-table-3', 'demo-restaurant-bk-3'),
      ('demo-restaurant-turn-4-table-5', 'demo-restaurant-bk-4'),
      ('demo-restaurant-turn-4-table-6', 'demo-restaurant-bk-4'),
      ('demo-restaurant-turn-5-table-7', 'demo-restaurant-bk-5'),
      ('demo-restaurant-turn-6-table-8', 'demo-restaurant-bk-6'),
      ('demo-restaurant-reservation-table-9', 'demo-restaurant-bk-1')
    ) AS expected(allocation_ref, booking_ref)
      ON expected.allocation_ref = allocation."allocationId"
    WHERE NOT EXISTS (
      SELECT 1
      FROM "StorefrontBooking" booking
      JOIN "StorefrontConfig" config ON config.id = booking."storefrontId"
      JOIN "StorefrontArchetype" archetype ON archetype.id = config."archetypeId"
      WHERE booking."bookingRef" = expected.booking_ref
        AND booking.id = allocation."bookingId"
        AND booking."organizationId" = allocation."organizationId"
        AND booking."storefrontId" = allocation."storefrontId"
        AND archetype."archetypeId" = 'restaurant'
    )
  ) THEN
    RAISE EXCEPTION 'Reserved Restaurant demo allocation identifiers are attached to non-demo data';
  END IF;
END $$;
