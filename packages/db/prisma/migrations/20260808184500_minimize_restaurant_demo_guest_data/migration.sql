-- The restaurant demo needs operational demand pressure, not sensitive guest
-- content. Clear notes only on the globally unique, platform-owned restaurant
-- demo booking refs; real bookings and other archetypes remain untouched.
UPDATE "StorefrontBooking" booking
SET
  "dietaryNotes" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "StorefrontConfig" storefront
JOIN "StorefrontArchetype" archetype ON archetype.id = storefront."archetypeId"
WHERE booking."storefrontId" = storefront.id
  AND booking."bookingRef" ~ '^demo-restaurant-bk-[0-6]$'
  AND archetype."archetypeId" = 'restaurant';
