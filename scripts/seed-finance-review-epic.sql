-- Seed Financial Management Review epic
-- Run: cd packages/db && npx prisma db execute --file ../../scripts/seed-finance-review-epic.sql
--
-- Purpose: Revisit deferred anti-pattern decisions from EP-FINMGMT-001 when demand signals arrive
-- Spec: docs/superpowers/specs/2026-03-20-financial-management-implementation-decisions.md
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
    'Financial Management — Deferred Decision Review',
    'Review gate for features deliberately excluded from EP-FINMGMT-001 based on public discourse analysis (2026-03-20). Each item represents a deferred capability with a specific demand signal that should trigger re-evaluation. Do not action these items speculatively — only open when the triggering condition is observed from real customer usage.',
    'open', NOW(), NOW()
  ) RETURNING id INTO epic_id;

  INSERT INTO "EpicPortfolio" ("epicId", "portfolioId")
  VALUES (epic_id, sold_id), (epic_id, employees_id);

  INSERT INTO "BacklogItem" (id, "itemId", title, type, status, priority, "epicId", "createdAt", "updatedAt", body)
  VALUES
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Evaluate 3-way PO matching (PO → goods receipt → bill)',
     'product', 'deferred', 1, epic_id, NOW(), NOW(),
     'Trigger: customer with 10+ active suppliers and a dedicated procurement person reports that PO-to-bill conversion alone is insufficient for catching delivery shortfalls. Original decision: excluded from V1 because most SMBs under 20 employees do not use formal goods receipt workflows. When triggered: extend PurchaseOrder with GoodsReceipt model, quantity-received tracking, and three-way variance reporting before bill approval.'),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Evaluate customer credit limit management',
     'product', 'deferred', 2, epic_id, NOW(), NOW(),
     'Trigger: customer with 50+ accounts starts experiencing material bad debt from overextended debtors and requests credit controls. Original decision: excluded because almost no SMB sets or enforces credit limits even when the feature exists — investment went to automated reminders instead. When triggered: add creditLimit field to CustomerAccount, warn/block on new invoice creation when limit exceeded, credit review dashboard.'),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Evaluate subscription billing engine vs Stripe Billing integration',
     'portfolio', 'deferred', 3, epic_id, NOW(), NOW(),
     'Trigger: recurring billing (EP-FINMGMT-001 item 12) proves insufficient AND Stripe Billing integration friction is high enough that customers request native proration, plan changes, or card retry/dunning. Original decision: permanent integration boundary — Stripe/Chargebee have hundreds of engineers on this; building even 30% is a multi-year distraction. When triggered: evaluate whether the gap is integration quality (fix the connector) or genuine missing capability (spec a bounded subscription module). Default assumption: fix the integration, do not build the engine.'),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Evaluate custom financial report builder',
     'portfolio', 'deferred', 4, epic_id, NOW(), NOW(),
     'Trigger: multiple customers request report layouts not covered by the standard set AND are not sophisticated enough to use external BI tools (Metabase, Power BI). Original decision: SMBs build custom reports and never use them; businesses that need them outgrow SMB tools and move to BI platforms. When triggered: evaluate whether a lightweight saved-filter/column-picker on existing reports satisfies the need before considering a full report builder. Full report builder remains unlikely — it is building a BI tool, which is not our business.');

  RAISE NOTICE 'Financial Management — Deferred Decision Review epic seeded with 4 items.';
END
$$;
