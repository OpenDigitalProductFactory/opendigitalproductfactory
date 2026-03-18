-- Update the existing Finance epic to capture ERPNext + AP/AR/Payroll/Tax/Cart/CRM scope.
-- Run from repo root with:
--   cd packages/db && npx prisma db execute --file ../../scripts/update-finance-epic.sql

DO $$
DECLARE
  finance_epic_id TEXT;
  inserted_count INTEGER;
BEGIN
  SELECT e.id INTO finance_epic_id
  FROM "Epic" e
  WHERE e.title = 'Financial Primitives and Budget Management'
     OR e.title ILIKE 'Financial %Budget%'
     OR e.title ILIKE 'Finance%'
  LIMIT 1;

  IF finance_epic_id IS NULL THEN
    RAISE EXCEPTION 'Epic not found: Financial Primitives and Budget Management';
  END IF;

  UPDATE "Epic"
  SET
    description = 'Implement robust finance operations in the platform with ERPNext as the execution engine (multi-business, multi-company), including accounts payable, accounts receivable, payroll, taxes, shopping cart to receivables workflow, and CRM handoff for trainer signup + billing events.',
    status = CASE
      WHEN status = 'done' THEN 'in-progress'
      ELSE status
    END,
    "updatedAt" = NOW()
  WHERE id = finance_epic_id;

  UPDATE "BacklogItem" b
  SET
    title = vals.title,
    body = vals.body,
    type = vals.type,
    "updatedAt" = NOW()
  FROM (
    VALUES
      (1, 'ERPNext deployment and connector platform (multi-company, multi-entity)', 'Add platform-hosted ERPNext connector foundation with secure credential handling, connection health checks, and tenant-aware company scoping for two-business operations.', 'product'),
      (2, 'Procure-to-pay and vendor/AP processing', 'Implement invoice capture from ERPNext: supplier onboarding, bill entry, payment run, and tax withholding rules; include PO/expense-to-payable reconciliation where applicable.', 'product'),
      (3, 'Order-to-cash and receivables', 'Integrate customer onboarding, sales orders, invoices, credit handling, customer payments, and unapplied cash handling in ERPNext using event-driven updates from platform purchases and trainer subscriptions.', 'product'),
      (4, 'Payroll + statutory compliance pipeline', 'Implement payroll source data, earnings rules, deduction profiles, and payroll run export/import between platform workforce states and ERPNext payroll with audit traceability by business.', 'product'),
      (5, 'Tax calculation and compliance reporting', 'Capture tax jurisdictions, tax codes, tax posting, and compliance summaries to support local filings and variance review dashboards by business portfolio.', 'product'),
      (6, 'AI provider cost attribution and ledger posting', 'Create spend attribution for AI providers (models, tokens, infrastructure, subscriptions) and post periodic journal entries to ERP accounting and profitability dashboards.', 'product'),
      (7, 'Employee-facing managed finance tool catalog', 'Update finance story to expose managed finance and accounting services through DPF role-aware launch and request entry points so employees can discover and act without opening ERP directly.', 'product'),
      (8, 'US and UK payroll provider abstraction', 'Build payroll provider connectors (US + UK), provider-specific payroll settings, and payout status tracking while keeping jurisdictional logic outside DPF core payroll engine.', 'product'),
      (9, 'Cart-to-ledger state machine', 'Model trainer storefront orders and payments through explicit finance request states and idempotent invoice reconciliation to ERPNext (created, paid, failed, reversed, refunded).', 'product'),
      (10, 'Cross-portfolio finance visibility', 'Track finance KPIs, budgets, and approvals by business entity with per-portfolio role-aware views and exception reporting.', 'portfolio')
  ) AS vals(priority, title, body, type)
  WHERE b."epicId" = finance_epic_id
    AND b.priority = vals.priority;

  INSERT INTO "BacklogItem" (id, "itemId", title, status, type, priority, "epicId", "createdAt", "updatedAt", body)
  SELECT
    gen_random_uuid()::text,
    'BI-FIN-' || LPAD(data.priority::text, 3, '0'),
    data.title,
    'open',
    data.type,
    data.priority,
    finance_epic_id,
    NOW(),
    NOW(),
    data.body
  FROM (
    VALUES
      (11, 'Trainer storefront checkout integration', 'Build product catalog/registration cart for trainers with pricing, coupons, taxes, and multi-business attribution; persist order state for finance reconciliation.', 'product'),
      (12, 'Payment-to-ledger automation', 'Handle Stripe checkout webhooks + failed/retried payment states, then create/clear ERPNext invoices, collections actions, and reconciliation snapshots.', 'product'),
      (13, 'Finance + CRM workflow integration', 'Push qualified trainer leads, subscriptions, and payment outcomes into CRM as lifecycle stages with next-action guidance (follow-up, onboarding, refund handling).', 'product'),
      (14, 'Finance governance and reporting', 'Add role-based controls, GL lock windows, approval thresholds, and finance KPIs by business and portfolio including budget-vs-actual variance and P&L summaries.', 'portfolio'),
      (15, 'Vendor and customer master reconciliation', 'Implement canonical matching and enrichment rules for duplicate parties, tax IDs, payment terms, and default ledgers across businesses.', 'product'),
      (16, 'Dispute and adjustment handling', 'Implement credit note, chargeback, refund, discount, and write-off workflows with audit trail and full link back to order/payment records.', 'product')
  ) AS data(priority, title, body, type)
  WHERE NOT EXISTS (
    SELECT 1
    FROM "BacklogItem" b
    WHERE b."epicId" = finance_epic_id
      AND b.priority = data.priority
  );

  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  IF inserted_count > 0 THEN
    RAISE NOTICE 'Added % new finance backlog items for ERP expansion.', inserted_count;
  ELSE
    RAISE NOTICE 'No new finance backlog items were inserted.';
  END IF;
END
$$;
