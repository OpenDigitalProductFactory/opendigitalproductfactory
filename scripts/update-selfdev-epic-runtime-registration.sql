-- Update the AI-Driven Platform Self-Development epic to capture
-- automatic inventory and digital product registration for downloaded runtimes.
-- Run from repo root with:
--   cd packages/db && npx prisma db execute --file ../../scripts/update-selfdev-epic-runtime-registration.sql --schema prisma/schema.prisma

DO $$
DECLARE
  selfdev_epic_id TEXT;
  dpf_product_id TEXT;
BEGIN
  SELECT e.id INTO selfdev_epic_id
  FROM "Epic" e
  WHERE e."epicId" = 'EP-SELF-DEV-001'
     OR e.title ILIKE 'AI-Driven Platform Self-Development%'
  LIMIT 1;

  IF selfdev_epic_id IS NULL THEN
    RAISE EXCEPTION 'Epic not found: AI-Driven Platform Self-Development';
  END IF;

  SELECT dp.id INTO dpf_product_id
  FROM "DigitalProduct" dp
  WHERE dp."productId" = 'dpf-portal'
  LIMIT 1;

  UPDATE "BacklogItem"
  SET
    body = 'The platform can pull updates from the repository, apply migrations, install or upgrade managed runtimes, and restart itself. Every downloaded or managed runtime must register in inventory and, when employee-facing or employee-operated, create or link a DigitalProduct record in the correct for_employees portfolio context. Version rollback if something breaks. Non-technical admin can trigger updates from the platform UI. Add environment-aware placeholders for dev/test vs production footprint, resource licensing, and runtime-to-product linkage lifecycle.',
    "updatedAt" = NOW()
  WHERE "itemId" = 'BI-SELFDEV-004';

  INSERT INTO "BacklogItem" (
    id,
    "itemId",
    title,
    status,
    type,
    body,
    priority,
    "digitalProductId",
    "createdAt",
    "updatedAt",
    "epicId"
  )
  SELECT
    gen_random_uuid()::text,
    'BI-SELFDEV-005',
    'Automatic runtime inventory and digital product registration',
    'open',
    'product',
    'When the platform downloads, installs, upgrades, or manages a package/runtime such as ERPNext or the IdP, it must create or update inventory records and create or link the corresponding DigitalProduct in the correct employee-facing portfolio/taxonomy context. Discovery, lifecycle state, ownership, and runtime-to-product linkage must stay synchronized. Keep separate entries for dev/test and production runtime footprints, and track license/resource consumption by environment to avoid unmanaged deployment debt.',
    5,
    dpf_product_id,
    NOW(),
    NOW(),
    selfdev_epic_id
  WHERE NOT EXISTS (
    SELECT 1
    FROM "BacklogItem" b
    WHERE b."itemId" = 'BI-SELFDEV-005'
  );
END
$$;
