-- Seed HR Core epic
-- Run: cd packages/db && npx prisma db execute --file ../../scripts/seed-hr-epic.sql --schema prisma/schema.prisma
DO $$
DECLARE
  employees_id   TEXT;
  epic_id        TEXT;
BEGIN
  SELECT id INTO employees_id FROM "Portfolio" WHERE slug = 'for_employees';

  IF employees_id IS NULL THEN
    RAISE EXCEPTION 'Expected portfolio slug "for_employees" not found.';
  END IF;

  INSERT INTO "Epic" (id, "epicId", title, description, status, "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    'EP-' || gen_random_uuid()::text,
    'HR Core',
    'Native employee relationship management built directly on the existing Prisma schema — no external HRIS database. Adds EmployeeProfile extending User with a full lifecycle state machine (prospect → onboarding → active → on_leave → suspended → offboarded), domain attribution via TaxonomyNode, and an HR workspace with list, search, and detail pages. Platform role assignment actions (UserGroup management) are included. Everything stays in one PostgreSQL database. Customer portal and payroll integrations are separate epics.',
    'open', NOW(), NOW()
  ) RETURNING id INTO epic_id;

  INSERT INTO "EpicPortfolio" ("epicId", "portfolioId")
  VALUES (epic_id, employees_id);

  INSERT INTO "BacklogItem" (id, "itemId", title, type, status, priority, "epicId", "createdAt", "updatedAt")
  VALUES
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'EmployeeProfile model (Prisma): one-to-one with User — employeeId (human-readable EMP-xxx), displayName, title, department, startDate, endDate?, lifecycleState enum (prospect|onboarding|active|on_leave|suspended|offboarded), taxonomyNodeId FK for domain attribution',
     'portfolio', 'open', 1, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Employee lifecycle server actions: createEmployeeProfile, activateEmployee, suspendEmployee, placeOnLeave, returnFromLeave, offboardEmployee — role-gated (HR-000/HR-100), audit trail via updatedAt',
     'portfolio', 'open', 2, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Platform role assignment server actions: assignPlatformRole, removePlatformRole managing UserGroup entries — role-gated (HR-000 only), validates against PlatformRole.roleId (HR-000…HR-500)',
     'portfolio', 'open', 3, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     '/employee route: employee list with lifecycle state filter chips, search by name/email, count badges, link to detail — replaces current read-only stub; HR-000/HR-100 see full lifecycle; HR-200/300/400/500 see directory-only view',
     'product', 'open', 4, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     '/employee/[userId] detail page: profile header (name, title, department, lifecycleState), platform role badges, domain attribution (TaxonomyNode link), lifecycle command buttons based on current state and caller role',
     'product', 'open', 5, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Link EmployeeProfile to TaxonomyNode for workforce domain attribution (same pattern as DigitalProduct → taxonomyNodeId); drives headcount reporting per taxonomy domain',
     'portfolio', 'open', 6, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Employee directory read model: Prisma query helper getEmployeeList(filters) returning EmployeeProfile + User email + PlatformRole list; filters: lifecycleState[], taxonomyNodeId, search string; used by both /employee route and future reporting',
     'portfolio', 'open', 7, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Seed initial employee profiles: create EmployeeProfile rows for all existing User records that have at least one UserGroup entry, defaulting to lifecycleState=active and deriving displayName from email prefix',
     'portfolio', 'open', 8, epic_id, NOW(), NOW());

  RAISE NOTICE 'HR Core epic created with 8 stories.';
END $$;
