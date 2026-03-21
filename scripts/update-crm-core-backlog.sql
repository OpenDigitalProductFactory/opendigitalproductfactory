-- Update CRM Core backlog items to reflect research-backed design decisions
-- Run: cd packages/db && npx prisma db execute --file ../../scripts/update-crm-core-backlog.sql
--
-- Changes:
--   - P1 "Extended contact model" expanded with specific fields from research
--   - P2 "Interaction history" → now covered by Activity model in Sales Pipeline epic
--   - New items: ContactAccountRole junction, extended account model, search vectors, dedup prevention
DO $$
DECLARE
  epic_pk TEXT;
BEGIN
  SELECT id INTO epic_pk FROM "Epic"
  WHERE title = 'Rich CRM & Customer Lifecycle'
  AND status = 'open'
  LIMIT 1;

  IF epic_pk IS NULL THEN
    RAISE EXCEPTION 'CRM Core epic (Rich CRM & Customer Lifecycle) not found.';
  END IF;

  -- Update epic description
  UPDATE "Epic"
  SET description = 'Foundation CRM models: extend CustomerContact (firstName/lastName split, phone, jobTitle, linkedinUrl, source, doNotContact), many-to-many Contact↔Account via ContactAccountRole junction table, extend CustomerAccount (website, employeeCount, annualRevenue, currency, parentAccountId, lifecycleState), full-text search vectors, duplicate prevention at creation. Research-backed: Twenty, Attio, SuiteCRM, Frappe patterns.',
      "updatedAt" = NOW()
  WHERE id = epic_pk;

  -- Remove old items and replace with research-informed ones
  DELETE FROM "BacklogItem" WHERE "epicId" = epic_pk;

  INSERT INTO "BacklogItem" (id, "itemId", title, type, status, priority, "epicId", "createdAt", "updatedAt")
  VALUES
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Extend CustomerContact: split name→firstName+lastName, add phone, jobTitle, linkedinUrl, source (web|referral|import|manual), doNotContact boolean, avatarUrl; progressive disclosure — only email required at creation',
     'portfolio', 'open', 1, epic_pk, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'ContactAccountRole junction table: many-to-many Contact↔Account with roleTitle, isPrimary, startedAt, endedAt; handles job changes without data loss; migrate existing accountId FK data to junction rows',
     'portfolio', 'open', 2, epic_pk, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Extend CustomerAccount: replace status with lifecycleState enum (prospect|qualified|onboarding|active|at_risk|suspended|closed), add website, employeeCount (integer), annualRevenue (Decimal) + currency, parentAccountId self-reference for corporate hierarchies, notes, sourceSystem, sourceId',
     'portfolio', 'open', 3, epic_pk, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Full-text search: add searchVector tsvector columns to CustomerContact and CustomerAccount with GIN indexes; populate from name, email, phone, company name, notes; PostgreSQL native — no external dependency',
     'portfolio', 'open', 4, epic_pk, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Duplicate prevention at contact creation: fuzzy match on email (exact), firstName+lastName (normalized), phone (digit-only); return similarContacts with confidence scores in API response; UI shows "did you mean?" before creating',
     'portfolio', 'open', 5, epic_pk, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Customer lifecycle server actions: createProspect, qualifyAccount, startOnboarding, activateAccount, markAtRisk, suspendAccount, closeAccount — role-gated (HR-200/HR-000), auto-log Activity on each transition',
     'portfolio', 'open', 6, epic_pk, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     '/customer route: account list with lifecycle state filter chips, search (full-text), count badges, primary contact shown; /customer/[accountId] detail with timeline-first layout, contacts list, linked products, lifecycle command buttons',
     'product', 'open', 7, epic_pk, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Customer agent tools: createAccount, createContact (with dedup check), updateLifecycleState, logActivity, searchContacts (full-text) — for AI workforce integration',
     'product', 'open', 8, epic_pk, NOW(), NOW());

  RAISE NOTICE 'CRM Core backlog updated: 8 revised stories (research-backed).';
END $$;
