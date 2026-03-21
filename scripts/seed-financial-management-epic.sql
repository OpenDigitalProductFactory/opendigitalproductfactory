-- Seed Financial Management Suite epic (EP-FINMGMT-001)
-- Run: cd packages/db && npx prisma db execute --file ../../scripts/seed-financial-management-epic.sql
--
-- Depends on: EP-FINANCE-001 (ERPNext connectors), EP-STORE-001 (storefront archetypes)
-- Spec: docs/superpowers/specs/2026-03-20-financial-management-design.md
DO $$
DECLARE
  sold_id        TEXT;
  employees_id   TEXT;
  mfg_id         TEXT;
  epic_id        TEXT;
BEGIN
  SELECT id INTO sold_id      FROM "Portfolio" WHERE slug = 'products_and_services_sold';
  SELECT id INTO employees_id FROM "Portfolio" WHERE slug = 'for_employees';
  SELECT id INTO mfg_id       FROM "Portfolio" WHERE slug = 'manufacturing_floor';

  IF sold_id IS NULL OR employees_id IS NULL THEN
    RAISE EXCEPTION 'Expected portfolio slugs not found.';
  END IF;

  INSERT INTO "Epic" (id, "epicId", title, description, status, "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    'EP-' || gen_random_uuid()::text,
    'Financial Management Suite',
    'End-to-end financial management capability for business operators. Covers invoicing (create, send, track, collect), accounts payable (supplier management, bills, purchase orders, payment runs), banking and reconciliation (bank feeds, matching, cash position), recurring billing and credit control (subscriptions, dunning, aging), expense management (employee claims, receipts, approvals, reimbursement), financial reporting (P&L, balance sheet, aged debtors/creditors, cash flow, budgets), fixed asset management (register, depreciation, disposal), and archetype-driven financial setup (chart of accounts, tax codes, payment terms, invoice templates seeded from storefront business type). DPF is the experience layer; ERPNext remains the ledger of record per Finance Hub Architecture spec.',
    'open', NOW(), NOW()
  ) RETURNING id INTO epic_id;

  -- Link to sold (invoicing/billing is a product feature) and employees (expense management, payslip visibility)
  INSERT INTO "EpicPortfolio" ("epicId", "portfolioId")
  VALUES (epic_id, sold_id), (epic_id, employees_id);

  -- Also link to manufacturing_floor if it exists (finance tooling is internal infrastructure)
  IF mfg_id IS NOT NULL THEN
    INSERT INTO "EpicPortfolio" ("epicId", "portfolioId")
    VALUES (epic_id, mfg_id);
  END IF;

  INSERT INTO "BacklogItem" (id, "itemId", title, type, status, priority, "epicId", "createdAt", "updatedAt", body)
  VALUES
    -- Phase A: Invoicing & Payments (Foundation)
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Invoice data model and sequential numbering',
     'product', 'open', 1, epic_id, NOW(), NOW(),
     'Create Invoice and InvoiceLineItem Prisma models with sequential numbering (INV-2026-0001). Support invoice types: standard, credit_note, proforma, recurring_instance. Include source tracking (sales_order, storefront_order, recurring, manual), tax calculation per line item, and ERP sync status fields. Add server actions: createInvoice, updateInvoice, approveInvoice, voidInvoice.'),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Invoice lifecycle and payment recording',
     'product', 'open', 2, epic_id, NOW(), NOW(),
     'Implement invoice status workflow: draft → approved → sent → viewed → partially_paid → paid (also overdue, void, written_off). Build Payment model with inbound/outbound direction, PaymentAllocation for split payments across invoices. Support payment methods: bank_transfer, card, cash, cheque, direct_debit, stripe. Auto-calculate amountDue = totalAmount - sum(allocations). Server actions: recordPayment, allocatePayment, refundPayment.'),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Invoice generation from sales orders and storefront orders',
     'product', 'open', 3, epic_id, NOW(), NOW(),
     'Auto-generate invoices when SalesOrder status = confirmed (from EP-CRM-SALES-001 quote acceptance) and when StorefrontOrder is completed. Map line items, customer details, and payment terms. Handle tax calculation based on customer jurisdiction. Idempotent — do not duplicate invoices for the same source order.'),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Invoice sending, Pay Now portal, and view tracking',
     'product', 'open', 4, epic_id, NOW(), NOW(),
     'Generate invoice PDF (filename: Invoice-{NUMBER}-{CLIENT}.pdf). Send via email with embedded Pay Now button linking to a secure payment page — the payment link is the hero, PDF is secondary download. Payment page requires zero account creation (enter card/bank details, pay, done). Page branded with business storefront styling. Track email open, page view, and payment status. 5 template styles mapped to archetype categories (professional, trade, creative, nonprofit, minimal). Brand customisation: logo, primary colour, font. Inline template editing — never navigate to settings. Precedent: 40% same-day payment with payment links vs 5% for traditional invoices (Stripe data).'),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Invoicing UI — 60-second invoice creation and admin views',
     'product', 'open', 5, epic_id, NOW(), NOW(),
     'Single-page invoice creation (no multi-step wizard). Customer auto-complete with recents at top. Line item quick-add with product/service picker. Smart defaults: currency from customer, terms from customer or org, tax from org. Save and Send as primary action. Pre-fill from source orders with zero additional input. Shell routes: /finance/invoices (list with Viewed But Not Paid status column, filters: status, customer, date, overdue), /finance/invoices/new, /finance/invoices/[id] (detail with payment history, send, void). Dashboard cards: outstanding, overdue, paid this month. Precedent: FreshBooks wins because invoice creation is fast. QB 2025 redesign backlash when it went from 1 min to 5 min.'),

    -- Phase B: Accounts Payable
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Supplier model, bill capture with OCR, and approval routing',
     'product', 'open', 6, epic_id, NOW(), NOW(),
     'Create Supplier model (name, contact, tax ID, payment terms, bank details, status). Create Bill and BillLineItem models (BILL-2026-0001 sequential). Bill lifecycle: draft → awaiting_approval → approved → partially_paid → paid → void. OCR bill capture: dedicated email inbox per org (bills@{slug}.odpf.io), extract supplier/date/lines/totals/tax. Side-by-side display: original document left, extracted data right. Quick correction UX (click to edit, tab between fields). Learn from corrections per supplier. Multi-step approval routing: rules by amount threshold, supplier, category (e.g. under £500 auto-approved, £500-5K manager, 5K+ director). Approvers get email with approve/reject buttons — no login required (secure token link). Precedent: ApprovalMax (19K businesses) exists because Xero/QB approval is inadequate; Dext OCR ~85% accurate, correction speed matters more than marginal accuracy. Admin UI: /finance/suppliers, /finance/bills.'),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Purchase order workflow (optional, archetype-driven)',
     'product', 'open', 7, epic_id, NOW(), NOW(),
     'POs disabled by default for service archetypes, enabled for trades/construction/retail. Toggleable in settings. Create PurchaseOrder and PurchaseOrderLineItem models (PO-2026-0001 sequential). PO lifecycle: draft → sent → acknowledged → received → cancelled. PO creation under 2 minutes: pick supplier, add lines, send. Primary value: PO-to-bill conversion — when supplier invoice arrives, match to PO, auto-populate bill, catch pricing discrepancies. No 3-way matching (PO → goods receipt → bill) in V1 — most SMBs under 20 employees do not use it; add later for growing businesses. Admin UI: /finance/purchase-orders.'),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Payment runs and batch outbound payments',
     'product', 'open', 8, epic_id, NOW(), NOW(),
     'Build payment run workflow: select approved bills due within date range, group by supplier with option to consolidate multiple bills per supplier into one payment (addresses Xero gap). Generate BACs file (UK) or ACH/Nacha file (US) for bank upload. Approval gate before execution (separate from bill approval). Record outbound payments and allocate to bills. Support partial payment of bills. Include expense claim reimbursements in the same payment run system. Admin UI: /finance/payment-runs with history and audit trail.'),

    -- Phase C: Banking & Reconciliation
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Bank account model and CSV feed import',
     'product', 'open', 9, epic_id, NOW(), NOW(),
     'Create BankAccount model (name, bank, account number, sort code, IBAN, currency, type, opening balance, current balance). Create BankTransaction model for imported statement lines (date, description, amount, balance, match status). CSV import with format auto-detection (date format, column mapping, debit/credit vs signed amounts) for major UK/US bank formats. Critical: one bad row must NOT fail the entire import — report errors, import the rest (precedent: silent CSV import failure is a known high-abandonment point). Admin UI: /finance/banking with account list and transaction feed as primary view (code-as-you-go, not monthly reconciliation).'),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Bank reconciliation matching engine with rules and AI assist',
     'product', 'open', 10, epic_id, NOW(), NOW(),
     'Code-as-you-go workflow: bank transactions appear in a feed, user matches/categorises each one. Suggested matches with confidence indicator (green = high confidence). One-click confirm for auto-matched transactions. Bank rules from day one: match by payee name (contains/exact), amount (range/exact), description keywords. Rules auto-apply account code, tax rate, description. Create Rule From This Transaction button on every bank line. Rules auto-suggested after 3+ similar manual categorisations. AI-assisted matching: learn from user reconciliation history, improve confidence over time, auto-categorise recurring transactions — but never auto-confirm without user review. Precedent: Xero JAX reduced bookkeeper time from 7hrs/week to 30 minutes with 80%+ auto-match rate. Admin UI: /finance/banking/[id]/reconcile.'),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Cash position dashboard and cash runway',
     'portfolio', 'open', 11, epic_id, NOW(), NOW(),
     'Real-time cash position across all bank accounts — the single most important financial metric (precedent: universal across SMB dashboard research). Cash flow forecast: 30/60/90-day forward view based on receivables due dates + payables due dates + recurring schedules + payroll dates. Cash runway metric: At current burn rate, cash lasts X months — trivially computed, critically useful for SMB owners. Simple what-if: What if Invoice X is paid 30 days late? What if I hire at Y salary? (this is where Float wins over built-in tools). Present the answer as a number first, visualisation second: You have £X. Based on what is owed in and out, you will have £Y in 30 days. Highlight projected cash shortfalls. Currency breakdown for multi-currency.'),

    -- Phase D: Recurring Billing & Credit Control
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Recurring billing schedules and auto-invoicing',
     'product', 'open', 12, epic_id, NOW(), NOW(),
     'Create RecurringSchedule and RecurringLineItem models. Support frequencies: weekly, fortnightly, monthly, quarterly, annually. Auto-generate invoices on schedule (cron job or event-driven). Track nextInvoiceDate, auto-advance after generation. Schedule lifecycle: active → paused → cancelled → completed. Link generated invoices back to schedule with sourceType=recurring. Admin UI: /finance/recurring.'),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Smart default dunning with pre-due reminders',
     'product', 'open', 13, epic_id, NOW(), NOW(),
     'Default dunning active out of the box — no setup required (precedent: biggest barrier to credit control is emotional; automation removes friction of chasing money). Default sequence: Day -3 friendly heads-up BEFORE due date (significantly improves on-time payment but most users never configure this), Day +7 first overdue with payment link, Day +14 firm reminder, Day +30 final notice + account flagged, Day +45 escalation task for owner. Every reminder includes Pay Now link. Archetype-aware defaults: nonprofits dunning off, trades aggressive (+3/+7/+14/+30), professional services standard. Weekly email digest to owner: You have £X overdue, top 5 customers. Configurable but works perfectly with defaults. Admin config: /finance/settings/dunning.'),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Aging analysis and actionable aged debtors widget',
     'product', 'open', 14, epic_id, NOW(), NOW(),
     'Aged debtors report as a dashboard widget, not buried in a reports menu (precedent: this is the core credit control report, run weekly by disciplined businesses). Current/30d/60d/90d/120d+ buckets per customer. Click any row → customer detail with Send Reminder action (payment link included). Aged creditors: same structure for supplier bills. Customer statement generation (PDF) with all transactions and balance. Add paymentTerms to CustomerAccount. No credit limit enforcement in V1 — almost no SMB sets or uses credit limits even when available; investment goes to better automated reminders instead. Admin UI: /finance/reports/aged-debtors, /finance/reports/aged-creditors.'),

    -- Phase E: Expense Management
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Mobile-first expense claims with receipt capture and approval',
     'product', 'open', 15, epic_id, NOW(), NOW(),
     'Phone-camera receipt capture as primary input (non-negotiable per Expensify/Dext precedent): take photo → auto-extract amount, date, vendor, category. Show original receipt alongside extracted data for verification. Learn from corrections per vendor. Create ExpenseClaim and ExpenseItem models (EXP-2026-0001 sequential). Claim lifecycle: draft → submitted → approved → rejected → paid. Categories: travel, meals, accommodation, supplies, mileage, other (archetype-extensible). Approval routing by amount threshold: under £25 auto-approved, £25-500 manager, £500+ director (configurable). Approvers get email with expense + receipt + approve/reject buttons — no login required (secure token link). Reimbursement via payment run system (same as supplier payments). Employee portal: /portal/expenses (mobile-optimised). Manager view: /finance/expense-claims.'),

    -- Phase F: Financial Reporting
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Financial reporting — four-widget dashboard and plain-language reports',
     'portfolio', 'open', 16, epic_id, NOW(), NOW(),
     'Default finance dashboard shows exactly four widgets (precedent: these drive 90% of SMB decisions): (1) Cash position — current bank balance(s) with trend arrow, (2) Cash flow forecast — 30/60/90-day forward, (3) Outstanding invoices — total owed, overdue count, worst-offender customer, (4) P&L summary — this month vs last, revenue and expenses with trend. Additional widgets available but hidden by default: aged debtors, aged creditors, budget vs actual. Plain language by default: Money In not Revenue, Money Out not Expenditure, Money Owed To You not Accounts Receivable. Accountant mode toggle for proper terminology. Every report has a one-sentence summary: You made £12,400 profit this month, up 8%. Core reports: P&L, Balance Sheet (via ERPNext), aged debtors/creditors, cash flow, VAT summary. No custom report builder (SMBs never use them). Export to CSV/PDF.'),

    -- Phase G: Asset Management & Multi-Currency
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Fixed asset register and depreciation',
     'product', 'open', 17, epic_id, NOW(), NOW(),
     'Create FixedAsset model (name, category, purchase date/cost, depreciation method, useful life, residual value, book value, accumulated depreciation, status, serial number, assigned employee). Depreciation methods: straight_line, reducing_balance. Monthly depreciation calculation (batch job). Asset lifecycle: active → disposed → written_off. Disposal with gain/loss calculation. Admin UI: /finance/assets. ERP sync for GL posting of depreciation journals.'),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Multi-currency — per-transaction, transparent, not premium-gated',
     'product', 'open', 18, epic_id, NOW(), NOW(),
     'Multiple currencies per customer/supplier (precedent: QB one-currency-per-customer model is universally hated — no duplicate Customer A GBP / Customer A USD profiles). Every invoice/bill can use any currency regardless of customer default. Cross-currency payments handled natively — no dummy clearing accounts. Organization base currency set during onboarding. Auto-fetch daily exchange rates (ECB or configurable). Manual override per transaction (bank rates differ from market). Every payment shows: invoice currency, payment currency, rate used, base currency equivalent. Realised FX gain/loss on payment allocation. Unrealised FX on period-end revaluation with full line-by-line detail. FX summary report. Multi-currency bank accounts. Not gated behind a premium tier (UK businesses with US clients is baseline, not edge case).'),

    -- Phase H: Archetype-Driven Setup
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Archetype-driven financial profile templates',
     'product', 'open', 19, epic_id, NOW(), NOW(),
     'Map each storefront archetype to a financial profile: chart of accounts template, default tax configuration (VAT registered vs not, rate bands), default payment terms, invoice template style, expense categories, dunning defaults, recurring billing toggle. Financial profile applied during first-run setup wizard (after storefront archetype selection). Include UK and US variants for tax and chart of accounts. Store templates in packages/finance-templates.'),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Financial setup wizard — first win in under 5 minutes',
     'product', 'open', 20, epic_id, NOW(), NOW(),
     '3 questions maximum during setup: business type (already answered via storefront archetype), VAT registered (yes/no), base currency (GBP/USD). Auto-generate everything else from archetype profile — user sees confirmation: Based on your business type, we have set up your finances. You can customise later. Do NOT show the full chart of accounts during setup (precedent: 85% abandonment rate in complex setup, COA is the #1 barrier). Skip opening balances entirely — add later when the accountant gets involved. Bank connection NOT required to start. Prompt first win: Send your first invoice or Record your first expense. One-click demo data option: sample customer + pre-filled invoice. Progressive disclosure: Week 1 prompts Connect your bank, Add your first supplier. Month 1 prompts Review your first P&L. Advanced features (POs, assets, multi-currency) discoverable but not promoted until signalled. Revisitable from /finance/settings.');

  RAISE NOTICE 'EP-FINMGMT-001: Financial Management Suite epic seeded with 20 backlog items.';
END
$$;
