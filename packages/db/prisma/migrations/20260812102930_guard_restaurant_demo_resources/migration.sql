-- Fail closed before the busy-shift refresh if a reserved demo table identifier
-- is not backed by its exact platform-owned demo provider in a Restaurant
-- storefront. This migration intentionally sits between the aggregate guard
-- and the refresh; committed migrations remain immutable.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "HospitalityResource" resource
    JOIN (VALUES
      ('demo-restaurant-table-1', 'demo-restaurant-prov-res-0'),
      ('demo-restaurant-table-2', 'demo-restaurant-prov-res-1'),
      ('demo-restaurant-table-3', 'demo-restaurant-prov-res-2'),
      ('demo-restaurant-table-4', 'demo-restaurant-prov-res-3'),
      ('demo-restaurant-table-5', 'demo-restaurant-prov-res-4'),
      ('demo-restaurant-table-6', 'demo-restaurant-prov-res-5'),
      ('demo-restaurant-table-7', 'demo-restaurant-prov-res-6'),
      ('demo-restaurant-table-8', 'demo-restaurant-prov-res-7'),
      ('demo-restaurant-table-9', 'demo-restaurant-prov-res-8')
    ) AS expected(resource_ref, provider_ref)
      ON expected.resource_ref = resource."resourceId"
    WHERE NOT EXISTS (
      SELECT 1
      FROM "ServiceProvider" provider
      JOIN "StorefrontConfig" config ON config.id = resource."storefrontId"
      JOIN "StorefrontArchetype" archetype ON archetype.id = config."archetypeId"
        WHERE provider.id = resource."legacyServiceProviderId"
        AND provider."providerId" = expected.provider_ref
        AND provider."storefrontId" = resource."storefrontId"
        AND config."organizationId" = resource."organizationId"
        AND archetype."archetypeId" = 'restaurant'
    )
  ) THEN
    RAISE EXCEPTION 'Reserved Restaurant demo table identifiers are attached to non-demo data';
  END IF;
END $$;
