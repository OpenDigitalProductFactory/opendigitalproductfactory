-- Update CRM Sales Pipeline backlog items to reflect research-backed design decisions
-- Run: cd packages/db && npx prisma db execute --file ../../scripts/update-crm-sales-pipeline-backlog.sql
--
-- Changes:
--   - Lead model → Engagement model (no separate lead table)
--   - Added discovery stage to pipeline
--   - Lead-to-Opportunity → Engagement qualification
--   - Updated UI routes (leads → engagements)
--   - Updated API endpoints description
--   - Updated dashboard tile description
--
-- Strategy: Delete old backlog items for this epic, insert revised ones.
-- Safe because the epic was just created today and no work has started.
DO $$
DECLARE
  epic_pk TEXT;
BEGIN
  -- Find the Sales Pipeline epic by title (created earlier today)
  SELECT id INTO epic_pk FROM "Epic"
  WHERE title = 'CRM Sales Pipeline & Quote-to-Order'
  AND status = 'open'
  LIMIT 1;

  IF epic_pk IS NULL THEN
    RAISE EXCEPTION 'CRM Sales Pipeline epic not found.';
  END IF;

  -- Update epic description to reflect research changes
  UPDATE "Epic"
  SET description = 'Full sales pipeline from prospect engagement through quote-to-order conversion. Uses Engagement model (not separate Lead table) linked to existing CustomerContact — avoids Salesforce conversion nightmare. Buyer-centric pipeline stages (qualification→discovery→proposal→negotiation→closed) with dormant auto-flagging. Itemised quoting with line + header discounts (ERPNext/Odoo pattern). Unified polymorphic Activity timeline with system auto-logging. Research-backed design: no data duplication, progressive disclosure, duplicate prevention at creation.',
      "updatedAt" = NOW()
  WHERE id = epic_pk;

  -- Remove old backlog items (no work started, safe to replace)
  DELETE FROM "BacklogItem" WHERE "epicId" = epic_pk;

  -- Insert revised backlog items
  INSERT INTO "BacklogItem" (id, "itemId", title, type, status, priority, "epicId", "createdAt", "updatedAt")
  VALUES
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Engagement model (Prisma): engagementId, title, status (new|contacted|qualified|unqualified|converted), source, sourceRefId (StorefrontInquiry FK), contactId FK (required — identity anchor), accountId FK, assignedToId FK, convertedToId FK; no data duplication from contact',
     'portfolio', 'open', 1, epic_pk, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Opportunity model (Prisma): opportunityId, title, buyer-centric stages (qualification|discovery|proposal|negotiation|closed_won|closed_lost), isDormant flag, probability, expectedValue, stageChangedAt for aging; engagementId FK (if from engagement)',
     'portfolio', 'open', 2, epic_pk, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Quote + QuoteLineItem models (Prisma): sequential quoteNumber, version tracking via previousId amendment chain, line-level discountPercent + taxPercent, header-level discountType (percentage|fixed) + discountValue; status (draft|sent|accepted|rejected|expired|superseded)',
     'portfolio', 'open', 3, epic_pk, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'SalesOrder model (Prisma): sequential orderRef (SO-2026-0001), status (confirmed|in_progress|fulfilled|cancelled), 1:1 FK to accepted Quote, accountId FK; auto-created on quote acceptance, fulfilment tracking',
     'portfolio', 'open', 4, epic_pk, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Activity model (Prisma): activityId, polymorphic type (note|call|email|meeting|task|status_change|quote_event|system), subject, body; links to accountId/contactId/opportunityId; system-generated events auto-logged with createdById=null',
     'portfolio', 'open', 5, epic_pk, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Engagement-to-Opportunity qualification: qualifyEngagement server action creates Opportunity, sets engagement.status=converted, links via engagementId FK, auto-logs system Activity; StorefrontInquiry auto-matches email to existing CustomerContact',
     'portfolio', 'open', 6, epic_pk, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Quote-to-Order conversion: acceptQuote server action sets quote accepted, creates SalesOrder in transaction, closes parent Opportunity as closed_won, logs quote_event + status_change Activities',
     'portfolio', 'open', 7, epic_pk, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Dormant deal detection: background job or server action checks stageChangedAt > 45 days for open opportunities, sets isDormant=true, logs system Activity; dashboard surfaces dormant count as "deals at risk"',
     'portfolio', 'open', 8, epic_pk, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'API endpoints: engagements CRUD + qualify, opportunities CRUD + stage advance + close, quotes CRUD + revise/send/accept/reject, sales-orders list + fulfilment, activities CRUD — all under /api/v1/customer/* with manage_customer permission',
     'product', 'open', 9, epic_pk, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     '/customer/engagements route: engagement list with status filter chips, source badges, assignee column, bulk assign; /customer/engagements/[id] detail with qualify-to-opportunity button',
     'product', 'open', 10, epic_pk, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     '/customer/opportunities route: Kanban board by stage (drag to advance) + list view toggle; weighted pipeline value header; dormant badge; /customer/opportunities/[id] timeline-first detail with quotes tab and stage controls',
     'product', 'open', 11, epic_pk, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     '/customer/quotes/[id] route: quote detail with editable line items (line + header discounts), version history via amendment chain sidebar, send/accept/reject action bar',
     'product', 'open', 12, epic_pk, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Customer workspace pipeline dashboard tile: engagement count by status, weighted pipeline value, conversion rate (last 30d), deals closing this month, quote acceptance rate, deals at risk (dormant count)',
     'product', 'open', 13, epic_pk, NOW(), NOW());

  RAISE NOTICE 'CRM Sales Pipeline backlog updated: 13 revised stories (research-backed).';
END $$;
