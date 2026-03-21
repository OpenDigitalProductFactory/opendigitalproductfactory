-- Seed CRM Sales Pipeline & Quote-to-Order epic
-- Run: cd packages/db && npx prisma db execute --file ../../scripts/seed-crm-sales-pipeline-epic.sql
--
-- Depends on: CRM Core epic (lifecycle state machine, schema extensions)
-- Spec: docs/superpowers/specs/2026-03-20-crm-sales-pipeline-design.md
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
    'CRM Sales Pipeline & Quote-to-Order',
    'Full sales pipeline from lead capture through quote-to-order conversion. Extends CRM Core with Lead, Opportunity, Quote, QuoteLineItem, SalesOrder, and Activity models. Covers inbound lead management (StorefrontInquiry integration), stage-based opportunity tracking with weighted forecasting, itemised quoting with versioning, and internal sales order generation on quote acceptance. Activity timeline provides unified interaction history per account/contact/opportunity.',
    'open', NOW(), NOW()
  ) RETURNING id INTO epic_id;

  INSERT INTO "EpicPortfolio" ("epicId", "portfolioId")
  VALUES (epic_id, sold_id), (epic_id, employees_id);

  INSERT INTO "BacklogItem" (id, "itemId", title, type, status, priority, "epicId", "createdAt", "updatedAt")
  VALUES
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Lead model (Prisma): leadId, title, status (new|contacted|qualified|unqualified|converted), source, sourceRefId (StorefrontInquiry FK), accountId FK, contactId FK, assignedToId FK, convertedToId FK; server actions for create/update/qualify/convert',
     'portfolio', 'open', 1, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Opportunity model (Prisma): opportunityId, title, stage (qualification|proposal|negotiation|closed_won|closed_lost), probability, expectedValue, expectedClose, accountId FK, leadId FK, assignedToId FK; stage advancement server actions with probability defaults',
     'portfolio', 'open', 2, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Quote + QuoteLineItem models (Prisma): sequential quoteNumber (QUO-2026-0001), version tracking, status (draft|sent|accepted|rejected|expired|superseded), line items with productId FK to DigitalProduct, discount handling, total calculation; revise/send/accept/reject server actions',
     'portfolio', 'open', 3, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'SalesOrder model (Prisma): sequential orderRef (SO-2026-0001), status (confirmed|in_progress|fulfilled|cancelled), 1:1 FK to accepted Quote, accountId FK; auto-created on quote acceptance, fulfilment tracking server actions',
     'portfolio', 'open', 4, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Activity model (Prisma): activityId, type (note|call|email|meeting|task), subject, body, scheduledAt, completedAt; polymorphic links to accountId/contactId/opportunityId; logActivity server action',
     'portfolio', 'open', 5, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Lead-to-Opportunity conversion flow: convertLeadToOpportunity server action creates Opportunity, links lead, transitions lead status to converted; auto-match StorefrontInquiry.customerEmail to existing CustomerContact on lead creation',
     'portfolio', 'open', 6, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Quote-to-Order conversion flow: acceptQuote server action sets quote accepted, creates SalesOrder in transaction, closes parent Opportunity as closed_won with actualClose timestamp',
     'portfolio', 'open', 7, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'API endpoints: leads CRUD + convert, opportunities CRUD + stage advance + close, quotes CRUD + revise/send/accept/reject, sales-orders list + fulfilment update, activities CRUD — all under /api/v1/customer/* with manage_customer permission gate',
     'product', 'open', 8, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     '/customer/leads route: lead list with status filter chips, source badges, assignee column, bulk assign action; /customer/leads/[id] detail page with convert-to-opportunity button',
     'product', 'open', 9, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     '/customer/opportunities route: Kanban board view by stage (drag to advance) + list view toggle; weighted pipeline value header; /customer/opportunities/[id] detail page with quotes tab, activities timeline, stage control buttons',
     'product', 'open', 10, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     '/customer/quotes/[id] route: quote detail with editable line items, version history sidebar, send/accept/reject action bar; quote PDF preview (future: generation)',
     'product', 'open', 11, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Customer workspace pipeline dashboard tile: lead count by status, weighted pipeline value, conversion rate (last 30d), deals closing this month, quote acceptance rate',
     'product', 'open', 12, epic_id, NOW(), NOW());

  RAISE NOTICE 'CRM Sales Pipeline epic created with 12 stories.';
END $$;
