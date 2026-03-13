-- Seed CRM Core epic
-- Run: cd packages/db && npx prisma db execute --file ../../scripts/seed-crm-epic.sql --schema prisma/schema.prisma
DO $$
DECLARE
  sold_id        TEXT;
  employees_id   TEXT;
  epic_id        TEXT;
BEGIN
  SELECT id INTO sold_id      FROM "Portfolio" WHERE slug = 'products_and_services_sold';
  SELECT id INTO employees_id FROM "Portfolio" WHERE slug = 'for_employees';

  IF sold_id IS NULL OR employees_id IS NULL THEN
    RAISE EXCEPTION 'Expected portfolio slugs not found.';
  END IF;

  INSERT INTO "Epic" (id, "epicId", title, description, status, "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    'EP-' || gen_random_uuid()::text,
    'CRM Core',
    'Native customer relationship management built directly on the existing Prisma schema — no external CRM database. Extends CustomerAccount and CustomerContact with a full lifecycle state machine (prospect → qualified → onboarding → active → at_risk → suspended → closed), orders, subscriptions, and an internal CRM workspace. Customer portal auth is a separate epic. Everything stays in one PostgreSQL database.',
    'open', NOW(), NOW()
  ) RETURNING id INTO epic_id;

  INSERT INTO "EpicPortfolio" ("epicId", "portfolioId")
  VALUES (epic_id, sold_id), (epic_id, employees_id);

  INSERT INTO "BacklogItem" (id, "itemId", title, type, status, priority, "epicId", "createdAt", "updatedAt")
  VALUES
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Extend CustomerAccount schema: replace status with lifecycle_state enum (prospect|qualified|onboarding|active|at_risk|suspended|closed), add notes and source_system/source_id fields',
     'portfolio', 'open', 1, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Extend CustomerContact schema: add name, phone, role, isPrimary flag; retain email unique constraint and account FK',
     'portfolio', 'open', 2, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Customer lifecycle server actions: createProspect, qualifyAccount, startOnboarding, activateAccount, suspendAccount, closeAccount — role-gated (HR-200/HR-000), audit trail via updatedAt',
     'portfolio', 'open', 3, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     '/customer route: account list with lifecycle state filter chips, search, count badges, link to detail — replaces current read-only stub',
     'product', 'open', 4, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     '/customer/[accountId] detail page: account header, contacts list, linked products (via DigitalProduct), lifecycle command buttons based on current state',
     'product', 'open', 5, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'CustomerOrder model (Prisma): accountId FK, digitalProductId FK, status (draft|submitted|accepted|provisioning|fulfilled|cancelled), server actions for order lifecycle',
     'portfolio', 'open', 6, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'CustomerSubscription model (Prisma): active entitlement linking CustomerAccount + DigitalProduct, status (pending_activation|active|suspended|pending_renewal|cancelled|expired), startDate/endDate',
     'portfolio', 'open', 7, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Link CustomerAccount to TaxonomyNode for ownership domain attribution (same pattern as DigitalProduct → taxonomyNodeId)',
     'portfolio', 'open', 8, epic_id, NOW(), NOW());

  RAISE NOTICE 'CRM Core epic created with 8 stories.';
END $$;
