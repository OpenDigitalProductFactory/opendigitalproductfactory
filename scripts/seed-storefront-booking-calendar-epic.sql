-- EP-STORE-003: Storefront Booking Calendar
-- Seeds the epic and backlog item for tracking implementation.

INSERT INTO "Epic" ("id", "epicId", "title", "description", "status", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'EP-STORE-003',
  'Storefront Booking Calendar — Availability, Slot Computation & Scheduling Patterns',
  'Availability-first architecture with computed slots for booking-enabled storefronts. Three scheduling patterns (slot-based, class/capacity, recurring). ServiceProvider + ProviderAvailability + BookingHold. Archetype-driven defaults. Spec: docs/superpowers/specs/2026-03-20-storefront-booking-calendar-design.md',
  'open',
  NOW(),
  NOW()
)
ON CONFLICT ("epicId") DO UPDATE SET
  "title" = EXCLUDED."title",
  "description" = EXCLUDED."description",
  "updatedAt" = NOW();

INSERT INTO "BacklogItem" ("id", "itemId", "title", "body", "status", "priority", "type", "epicId", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  'EP-STORE-003',
  'Storefront Booking Calendar — Availability, Slot Computation & Scheduling Patterns',
  'Availability-first architecture with computed slots for booking-enabled storefronts. Three scheduling patterns (slot-based, class/capacity, recurring). ServiceProvider + ProviderAvailability + BookingHold. Archetype-driven defaults. Spec: docs/superpowers/specs/2026-03-20-storefront-booking-calendar-design.md',
  'open',
  1,
  'epic',
  e.id,
  NOW(),
  NOW()
FROM "Epic" e
WHERE e."epicId" = 'EP-STORE-003'
ON CONFLICT ("itemId") DO UPDATE SET
  "title" = EXCLUDED."title",
  "body" = EXCLUDED."body",
  "updatedAt" = NOW();
