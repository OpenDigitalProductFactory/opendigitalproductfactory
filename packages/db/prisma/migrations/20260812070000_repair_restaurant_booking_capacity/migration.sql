-- Forward-repair the platform-owned Restaurant demo so public reservations use
-- the authored table resources instead of the generic compatibility provider.
-- Operator-owned storefronts and providers are intentionally out of scope.
WITH demo_table_providers AS (
  SELECT
    provider.id AS provider_id,
    resource.id AS resource_id,
    resource."organizationId" AS organization_id,
    resource."storefrontId" AS storefront_id
  FROM "ServiceProvider" provider
  JOIN "HospitalityResource" resource
    ON resource."legacyServiceProviderId" = provider.id
  JOIN "StorefrontConfig" storefront ON storefront.id = resource."storefrontId"
  JOIN "StorefrontArchetype" archetype ON archetype.id = storefront."archetypeId"
  WHERE provider."providerId" ~ '^demo-restaurant-prov-res-[0-8]$'
    AND resource.kind = 'table'
    AND resource.status = 'active'
    AND archetype."archetypeId" = 'restaurant'
)
INSERT INTO "ProviderService" (id, "providerId", "itemId")
SELECT
  'demo_restaurant_ps_' || md5(provider.provider_id || item.id),
  provider.provider_id,
  item.id
FROM demo_table_providers provider
JOIN "StorefrontItem" item
  ON item."storefrontId" = provider.storefront_id
  AND item."isActive" = TRUE
  AND item."ctaType" = 'booking'
ON CONFLICT ("providerId", "itemId") DO NOTHING;

-- Once table-backed providers exist, a Restaurant table reservation must not
-- keep routing through an unrelated generic/human provider and bypass capacity.
DELETE FROM "ProviderService" service
USING "StorefrontItem" item, "StorefrontConfig" storefront, "StorefrontArchetype" archetype
WHERE service."itemId" = item.id
  AND item."storefrontId" = storefront.id
  AND storefront."archetypeId" = archetype.id
  AND item."ctaType" = 'booking'
  AND archetype."archetypeId" = 'restaurant'
  AND EXISTS (
    SELECT 1
    FROM "HospitalityResource" demo_resource
    JOIN "ServiceProvider" demo_provider
      ON demo_provider.id = demo_resource."legacyServiceProviderId"
    WHERE demo_resource."storefrontId" = storefront.id
      AND demo_provider."providerId" ~ '^demo-restaurant-prov-res-[0-8]$'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "HospitalityResource" table_resource
    WHERE table_resource."storefrontId" = storefront.id
      AND table_resource."legacyServiceProviderId" = service."providerId"
      AND table_resource.kind = 'table'
      AND table_resource.status = 'active'
  );

-- Use confirmed owner hours when present; otherwise use the Restaurant
-- template's canonical 11:00-22:00 default on every day.
WITH day_defs(day_name, day_index) AS (
  VALUES
    ('sunday', 0), ('monday', 1), ('tuesday', 2), ('wednesday', 3),
    ('thursday', 4), ('friday', 5), ('saturday', 6)
), confirmed_profile AS (
  SELECT "businessHours" AS hours
  FROM "BusinessProfile"
  WHERE "isActive" = TRUE AND "hoursConfirmedAt" IS NOT NULL
  ORDER BY "updatedAt" DESC
  LIMIT 1
), operating_hours AS (
  SELECT
    day.day_index,
    COALESCE(profile.hours -> day.day_name ->> 'open', '11:00') AS start_time,
    COALESCE(profile.hours -> day.day_name ->> 'close', '22:00') AS end_time
  FROM day_defs day
  LEFT JOIN confirmed_profile profile ON TRUE
  WHERE profile.hours IS NULL OR profile.hours -> day.day_name IS NOT NULL
), grouped_hours AS (
  SELECT array_agg(day_index ORDER BY day_index) AS days, start_time, end_time
  FROM operating_hours
  GROUP BY start_time, end_time
), demo_table_providers AS (
  SELECT provider.id AS provider_id
  FROM "ServiceProvider" provider
  JOIN "HospitalityResource" resource
    ON resource."legacyServiceProviderId" = provider.id
  JOIN "StorefrontConfig" storefront ON storefront.id = resource."storefrontId"
  JOIN "StorefrontArchetype" archetype ON archetype.id = storefront."archetypeId"
  WHERE provider."providerId" ~ '^demo-restaurant-prov-res-[0-8]$'
    AND archetype."archetypeId" = 'restaurant'
)
INSERT INTO "ProviderAvailability" (
  id, "providerId", days, "startTime", "endTime", "createdAt", "updatedAt"
)
SELECT
  'demo_restaurant_pa_' || md5(provider.provider_id || hours.start_time || hours.end_time),
  provider.provider_id,
  hours.days,
  hours.start_time,
  hours.end_time,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM demo_table_providers provider
CROSS JOIN grouped_hours hours
WHERE NOT EXISTS (
  SELECT 1 FROM "ProviderAvailability" existing
  WHERE existing."providerId" = provider.provider_id
);

WITH day_defs(day_name, day_index) AS (
  VALUES
    ('sunday', 0), ('monday', 1), ('tuesday', 2), ('wednesday', 3),
    ('thursday', 4), ('friday', 5), ('saturday', 6)
), confirmed_profile AS (
  SELECT "businessHours" AS hours
  FROM "BusinessProfile"
  WHERE "isActive" = TRUE AND "hoursConfirmedAt" IS NOT NULL
  ORDER BY "updatedAt" DESC
  LIMIT 1
), operating_hours AS (
  SELECT
    day.day_index,
    COALESCE(profile.hours -> day.day_name ->> 'open', '11:00') AS start_time,
    COALESCE(profile.hours -> day.day_name ->> 'close', '22:00') AS end_time
  FROM day_defs day
  LEFT JOIN confirmed_profile profile ON TRUE
  WHERE profile.hours IS NULL OR profile.hours -> day.day_name IS NOT NULL
), grouped_hours AS (
  SELECT array_agg(day_index ORDER BY day_index) AS days, start_time, end_time
  FROM operating_hours
  GROUP BY start_time, end_time
), demo_tables AS (
  SELECT resource.id, resource."organizationId" AS organization_id
  FROM "HospitalityResource" resource
  JOIN "ServiceProvider" provider
    ON provider.id = resource."legacyServiceProviderId"
  JOIN "StorefrontConfig" storefront ON storefront.id = resource."storefrontId"
  JOIN "StorefrontArchetype" archetype ON archetype.id = storefront."archetypeId"
  WHERE provider."providerId" ~ '^demo-restaurant-prov-res-[0-8]$'
    AND archetype."archetypeId" = 'restaurant'
)
INSERT INTO "HospitalityResourceAvailability" (
  id, "availabilityId", "organizationId", "resourceId", kind, days,
  "startTime", "endTime", version, "createdAt", "updatedAt"
)
SELECT
  'demo_restaurant_hra_' || md5(resource.id || hours.start_time || hours.end_time),
  'HRA-DEMO-' || upper(substr(md5(resource.id || hours.start_time || hours.end_time), 1, 16)),
  resource.organization_id,
  resource.id,
  'available',
  hours.days,
  hours.start_time,
  hours.end_time,
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM demo_tables resource
CROSS JOIN grouped_hours hours
WHERE NOT EXISTS (
  SELECT 1 FROM "HospitalityResourceAvailability" existing
  WHERE existing."resourceId" = resource.id
);
