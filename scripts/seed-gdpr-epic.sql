-- Seed GDPR Governance Entity epic
-- Run: cd packages/db && npx prisma db execute --file ../../scripts/seed-gdpr-epic.sql
--
-- Architecture notes:
--   • GDPR (EU 2016/679) as a first-class regulation entity in EP-GRC-001 compliance engine
--   • Leverages existing Regulation, Obligation, Control, Evidence, Incident models
--   • Adds GDPR-specific data processing records (Art 30), DPIA support (Art 35),
--     Data Subject Request (DSR) workflow (Arts 15-22), breach notification (Art 33/34)
--   • Consent management linked to digital products/services
--   • Cross-border transfer tracking (Chapter V) — SCCs, adequacy decisions, BCRs
--   • DPO assignment tracked via EmployeeProfile role
DO $$
DECLARE
  found_id    TEXT;
  mfg_id      TEXT;
  emp_id      TEXT;
  sold_id     TEXT;
  epic_id     TEXT;
BEGIN
  SELECT id INTO found_id FROM "Portfolio" WHERE slug = 'foundational';
  SELECT id INTO mfg_id   FROM "Portfolio" WHERE slug = 'manufacturing_and_delivery';
  SELECT id INTO emp_id   FROM "Portfolio" WHERE slug = 'for_employees';
  SELECT id INTO sold_id  FROM "Portfolio" WHERE slug = 'products_and_services_sold';

  IF found_id IS NULL OR mfg_id IS NULL THEN
    RAISE EXCEPTION 'Expected portfolio slugs not found.';
  END IF;

  INSERT INTO "Epic" (id, "epicId", title, description, status, "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    'EP-' || gen_random_uuid()::text,
    'GDPR Governance Entity',
    'Register GDPR (EU 2016/679) as a first-class regulation in the EP-GRC-001 compliance engine. Populates obligations from key GDPR articles, adds processing activity records (Art 30), Data Protection Impact Assessments (Art 35), Data Subject Request workflows (Arts 15-22), breach notification pipeline (Art 33/34), consent management per product/service, and cross-border transfer tracking (Chapter V — SCCs, adequacy decisions, BCRs). DPO assignment is tracked via EmployeeProfile. All GDPR obligations link to the existing control, evidence, and audit infrastructure.',
    'open', NOW(), NOW()
  ) RETURNING id INTO epic_id;

  -- GDPR spans foundational (governance infrastructure) + manufacturing_and_delivery (product compliance)
  INSERT INTO "EpicPortfolio" ("epicId", "portfolioId")
  VALUES (epic_id, found_id), (epic_id, mfg_id);

  INSERT INTO "BacklogItem" (id, "itemId", title, type, status, priority, "epicId", "createdAt", "updatedAt")
  VALUES
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'GDPR Regulation seed: register EU 2016/679 as Regulation entity with key obligations mapped to Articles 5-9 (lawful basis, consent), Art 13-14 (transparency), Art 15-22 (data subject rights), Art 25 (privacy by design), Art 30 (processing records), Art 32 (security), Art 33-34 (breach notification), Art 35 (DPIA), Art 44-49 (cross-border transfers). Each obligation gets default control stubs.',
     'portfolio', 'open', 1, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Processing Activity Register (Art 30): ProcessingActivity model — name, purpose (array of lawful bases), dataCategories (personal/special/children), dataSubjectCategories, recipients, retentionPeriod, transferCountries, technicalMeasures, organisationalMeasures. Linked to DigitalProduct and Regulation obligation. CRUD server actions + /compliance/processing-activities route.',
     'portfolio', 'open', 2, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Data Protection Impact Assessment (Art 35): DpiaRecord model — processingActivityId FK, necessity (high-risk criteria checklist), risks (array of identified risks with likelihood/severity), mitigations (linked to Controls), dpoOpinion text, outcome enum (proceed/mitigate/consult_authority/abandon), consultationDate (Art 36 supervisory authority consultation if needed). CRUD + /compliance/dpia route.',
     'portfolio', 'open', 3, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Data Subject Request workflow (Arts 15-22): DataSubjectRequest model — requestType enum (access/rectification/erasure/restriction/portability/objection/automated_decision), subjectIdentifier (pseudonymised reference), receivedAt, dueAt (30 calendar days from receivedAt), status (received/verified/in_progress/completed/extended/refused), responseType, responseData (JSON), completedAt. Integrates with existing Incident model for escalation. CRUD + /compliance/dsr route with deadline tracking dashboard.',
     'product', 'open', 4, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Breach Notification pipeline (Art 33/34): extend existing Incident model with gdprBreachFields — personalDataCategories, approximateSubjectCount, approximateRecordCount, likelyConsequences, measuresTaken, notifyAuthorityBy (72h from awareness), authorityNotifiedAt, notifySubjects bool (high risk trigger), subjectsNotifiedAt. Breach notification checklist with 72-hour countdown timer on incident detail page.',
     'product', 'open', 5, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Consent Management: ConsentRecord model — subjectIdentifier, purpose, lawfulBasis (consent/legitimate_interest/contract/legal_obligation/vital_interest/public_task), consentGivenAt, consentWithdrawnAt, digitalProductId FK, evidenceId FK (links to Evidence for audit trail). Consent dashboard per product showing active/withdrawn counts. Withdrawal flow triggers review of processing activities.',
     'product', 'open', 6, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Cross-Border Transfer Register (Chapter V): TransferRecord model — processingActivityId FK, destinationCountry, transferMechanism enum (adequacy_decision/scc/bcr/derogation/certification), legalReference, tiaCompletedAt (Transfer Impact Assessment date), supplementaryMeasures text. Dashboard showing all active transfers with mechanism validity tracking.',
     'portfolio', 'open', 7, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'DPO Assignment and GDPR compliance dashboard: DPO role flag on EmployeeProfile, auto-populate DPO in DPIA reviews and breach notifications. Unified /compliance/gdpr dashboard showing obligation coverage %, overdue DSRs, open breaches, DPIA status, processing activity completeness, and upcoming deadlines. Links to EP-GRC-003 reporting engine for audit package generation.',
     'portfolio', 'open', 8, epic_id, NOW(), NOW());

  RAISE NOTICE 'GDPR Governance Entity epic created with 8 stories.';
END $$;
