# EP-FINMGMT-001: Implementation Decisions

**Date:** 2026-03-20
**Status:** Approved
**Based on:** Public discourse analysis of Xero, QuickBooks, FreshBooks, Wave, Zoho Books, Expensify, Dext, Pleo, ApprovalMax, Float, and related SMB financial tools. G2/Capterra reviews, Reddit threads, AccountingWeb forums, accountant practitioner feedback, and vendor data.

**Purpose:** Binding design decisions for EP-FINMGMT-001 based on what works, what doesn't, and what makes SMBs switch tools. Every decision references the precedent that drives it.

---

## 1. Invoicing: Speed and Payment Conversion Are Everything

### Decision 1.1: Invoice creation must complete in under 60 seconds

**Precedent:** FreshBooks wins invoicing because creating and sending an invoice is fast. QuickBooks's 2025 invoice redesign turned a 1-minute process into 5+ minutes, triggering mass user complaints and switching research.

**Implementation:**
- Single-page invoice creation (no multi-step wizard)
- Customer auto-complete with recent customers at top
- Line item quick-add with product/service picker
- Smart defaults: currency from customer, payment terms from customer or org default, tax rate from org default
- "Save and Send" as the primary action, not "Save and Close"
- Pre-fill from source (sales order, storefront order) with zero additional input needed

### Decision 1.2: "Pay Now" button is the hero of every invoice

**Precedent:** 40% of customers who receive a payment link pay within 24 hours vs 5% for traditional invoices. Offering one additional payment method increases revenue by 12%. Stripe Link increases checkout conversion by 14% for returning customers.

**Implementation:**
- Every sent invoice includes an embedded "Pay Now" button linking to a secure payment page
- Payment page requires zero account creation — enter card or bank details, pay, done
- Support card + bank transfer minimum (each captures a different segment)
- No PDF-only invoices — PDF is a secondary download, the payment link is primary
- Payment page branded with the business's storefront styling

### Decision 1.3: Invoice view tracking with automated follow-up

**Precedent:** "Viewed but not paid" is actionable intelligence used by all major platforms. Combining view tracking with automated reminders is the highest-converting collection workflow.

**Implementation:**
- Track when invoice email is opened
- Track when invoice payment page is viewed
- "Viewed but not paid" status visible in invoice list
- Auto-trigger first reminder if viewed but not paid after 48 hours (configurable)

### Decision 1.4: Smart default reminder sequences — no configuration required

**Precedent:** 62.6% of UK SME invoices are paid late. The biggest barrier to credit control is emotional — "people feel awkward asking customers to pay." Automation removes that friction. Pre-due reminders (before the due date) significantly improve on-time payment but most users never configure them.

**Implementation:**
- Default dunning sequence active out of the box, no setup required:
  - Day -3: "Friendly heads-up" reminder before due date
  - Day +7: First overdue reminder with payment link
  - Day +14: Firm reminder
  - Day +30: Final notice, account flagged
  - Day +45: Escalation task created for owner
- Every reminder includes the payment link
- Sequence configurable but works perfectly with defaults
- Archetype-aware: nonprofits have dunning disabled by default; trades default to more aggressive timing

### Decision 1.5: Recurring invoicing is a core feature, not a premium upsell

**Precedent:** FreshBooks locks recurring invoices behind the Plus tier ($38/month) — this is the most-requested feature gated by price. SMBs consider this table stakes. Memberships, retainers, and subscriptions are fundamental to healthcare, fitness, training, and professional services archetypes.

**Implementation:**
- Recurring schedules available to all users
- Support: weekly, fortnightly, monthly, quarterly, annually
- Auto-generate and optionally auto-send invoices on schedule
- Do NOT build subscription management (proration, plan changes, dunning retries on cards) — integrate with Stripe Billing for that. Our recurring is for fixed-amount retainer/membership billing only.

### Decision 1.6: Predictable PDF filenames and professional templates

**Precedent:** QuickBooks changed PDF filenames from "Invoice XXXXX.pdf" to random numbers, infuriating users. Invoice design "creates an indelible impression on clients."

**Implementation:**
- PDF filename: `Invoice-{NUMBER}-{CLIENT}.pdf` (e.g., `Invoice-INV-2026-0042-AcmeCorp.pdf`)
- 5 template styles mapped to archetype categories (professional, trade, creative, nonprofit, minimal)
- Brand customization: logo upload, primary colour, font selection
- Inline template editing — never navigate away to a settings page to customise invoice layout

---

## 2. Accounts Payable: Approval Workflows Are the Gap

### Decision 2.1: Bill capture via email forwarding + OCR

**Precedent:** Dext/Receipt Bank built entire businesses on this workflow. The pattern accountants want: forward the PDF to bills@company.com, it gets extracted automatically. OCR is ~85% accurate industry-wide; the speed of correcting the 15% matters more than marginal accuracy gains.

**Implementation:**
- Dedicated email inbox per org (e.g., bills@{slug}.odpf.io or configurable)
- OCR extraction of supplier name, invoice number, date, line items, totals, tax
- Side-by-side display: original document on left, extracted data on right
- Quick correction UX: click any field to edit, tab between fields
- Learn from corrections to improve future extraction for same supplier

### Decision 2.2: Multi-step approval routing (the ApprovalMax insight)

**Precedent:** Both Xero and QuickBooks are weak on approvals. ApprovalMax (19,000+ businesses) exists specifically because neither platform does this well. Key insight: approvers don't need accounting system access — they just need to see the bill and approve/reject.

**Implementation:**
- Approval rules by: amount threshold, supplier, category, department
- Example: under £500 auto-approved, £500-£5000 requires manager, £5000+ requires director
- Approvers receive email with bill summary + original document + approve/reject buttons
- No login required for simple approve/reject (secure token link)
- Full audit trail: who approved, when, with what comments
- Available from Phase B (not gated behind a premium tier)

### Decision 2.3: Purchase orders are optional and archetype-driven

**Precedent:** Most SMBs under 10 employees don't use POs. The trigger is purchasing complexity, not company size. Construction/trades need POs (they serve as contracts). Pure service businesses don't. The PO-to-bill conversion is the killer feature, not the PO itself.

**Implementation:**
- POs disabled by default for service-oriented archetypes
- POs enabled by default for trades, construction, retail, wholesale archetypes
- Can be toggled on/off in settings regardless of archetype
- PO creation under 2 minutes: pick supplier, add lines, send
- PO-to-bill conversion: when supplier invoice arrives, match to PO, auto-populate bill
- Do NOT build 3-way matching (PO → receipt → bill) in V1 — add later for growing businesses

### Decision 2.4: Batch payment runs with approval gate

**Precedent:** Selecting bills and paying in bulk is table stakes. Xero supports this but can't consolidate multiple bills to the same supplier into one payment (a known gap).

**Implementation:**
- Select approved bills due within date range
- Group by supplier, with option to consolidate multiple bills per supplier into one payment
- Approval gate before execution (separate from bill approval)
- Generate BACs file (UK) or ACH/Nacha file (US) for bank upload
- Record payments and allocate to bills automatically
- Support partial payment of bills

---

## 3. Banking & Reconciliation: Daily Trickle, Not Monthly Dread

### Decision 3.1: "Code as you go" reconciliation (Xero model)

**Precedent:** Xero's daily-trickle approach prevents month-end backlogs. QuickBooks' traditional tick-and-tie creates more friction. Users who reconcile daily/weekly stay on top of their books; monthly reconcilers fall behind and eventually stop.

**Implementation:**
- Primary workflow: bank transactions appear in a feed, user matches/categorises each one
- Suggested matches shown with confidence indicator (green = high confidence)
- One-click confirm for auto-matched transactions
- Manual match: search invoices/bills by amount, date, or reference
- "Code as you go" is the default view, not buried behind a "Reconcile" button

### Decision 3.2: Bank rules from day one

**Precedent:** Bank rules compound in value. Xero users who set up rules for their top 20 recurring transactions save hours weekly. FreshBooks has no bank rule feature, which is a cited weakness.

**Implementation:**
- Rule builder: match by payee name (contains/exact), amount (range/exact), description keywords
- Rules auto-apply account code, tax rate, and description
- "Create rule from this transaction" button on every bank transaction
- Rules suggested after 3+ similar manual categorisations
- Batch apply: select multiple matching transactions, apply rule to all

### Decision 3.3: AI-assisted matching as a differentiator

**Precedent:** Xero's JAX AI reconciliation (launched Q4 2025) auto-matches 80%+ of transactions. Bookkeeper reports: 7 hours/week reduced to 30 minutes. It learns from user history and anonymised patterns. This is proven, not marketing.

**Implementation:**
- Learn from user's reconciliation history to suggest matches
- Improve confidence scores over time as patterns are established
- Auto-categorise recurring transactions after 3+ manual categorisations
- Never auto-confirm without user review — suggest with confidence score, user confirms

### Decision 3.4: CSV import first, Open Banking later

**Precedent:** Bank feed reliability is the #1 frustration across all platforms. Yodlee feeds are "typically very unreliable." Open Banking consent expires every 90 days in the UK. Broken bank feeds = broken trust on day one.

**Implementation:**
- Phase C ships with CSV import supporting major UK and US bank formats
- Format auto-detection (date format, column mapping, debit/credit vs signed amounts)
- One bad row must NOT fail the entire import — report errors, import the rest
- Open Banking / Plaid integration is a future phase, not a gate
- Manual transaction entry always available as fallback

---

## 4. Financial Reporting: Cash Position, Not Accounting Jargon

### Decision 4.1: Dashboard defaults to the four things that matter

**Precedent:** Cash position is "the single most important financial metric on your dashboard." P&L is the report owners actually open. Cash flow forecast is where accounting software adds real value vs spreadsheets. Complex custom reports are built but never used by SMBs.

**Implementation:**
- Default finance dashboard shows exactly four widgets:
  1. **Cash position** — current bank balance(s), trend arrow
  2. **Cash flow forecast** — 30/60/90-day forward view based on receivables + payables + recurring
  3. **Outstanding invoices** — total owed, overdue count and amount, "worst offender" customer
  4. **P&L summary** — this month vs last month, revenue and expenses with trend
- Additional widgets available but not shown by default: aged debtors, aged creditors, budget vs actual
- "Cash runway" metric: "At current burn rate, cash lasts X months" — trivially computed, critically useful

### Decision 4.2: Plain language over accounting jargon

**Precedent:** Most SMB owners don't understand balance sheets. "How much money do I have?" beats "Current Assets less Current Liabilities." Xero's Business Snapshot succeeds because it's approachable to non-accountants.

**Implementation:**
- Dashboard labels use plain language: "Money In" not "Revenue", "Money Out" not "Expenditure", "Money Owed To You" not "Accounts Receivable"
- Accountant mode toggle: switches to proper accounting terminology for professionals
- Reports default to simplified view with drill-down to detail
- Every report has a one-sentence summary at the top: "You made £12,400 profit this month, up 8% from last month"

### Decision 4.3: Aged debtors as an actionable widget, not a buried report

**Precedent:** Aged debtors is the core credit control report — run weekly by disciplined businesses. But most SMBs bury it in a reports menu and rarely look at it.

**Implementation:**
- Aged debtors widget on finance dashboard showing 30/60/90/90+ buckets
- Click any row → opens customer detail with "Send Reminder" action
- Payment link included in every reminder sent from this view
- Weekly email digest to business owner: "You have £X overdue, here are the top 5 customers"

---

## 5. Onboarding: First Win in Under 5 Minutes

### Decision 5.1: Financial setup auto-generates from storefront archetype

**Precedent:** 85% abandonment rate in complex SMB software setup. 67% quit because of too many steps. Chart of accounts setup is the single biggest barrier — most owners don't know what a COA is. Xero auto-generates COA from business type — correct pattern.

**Implementation:**
- Storefront archetype selection (already in EP-STORE-001) feeds financial profile
- Auto-generate: chart of accounts, tax defaults (VAT registered? Y/N), payment terms, expense categories, invoice template
- User sees a confirmation screen: "Based on your business type, we've set up your finances. You can customise later."
- Do NOT show the full chart of accounts during setup. It's terrifying to non-accountants.
- 3 questions maximum: business type (already answered), VAT registered (yes/no), base currency (GBP/USD)

### Decision 5.2: First win = send an invoice or record an expense

**Precedent:** If users don't feel the core value within 60 seconds, they leave. FreshBooks wins because users can send their first invoice within minutes.

**Implementation:**
- After financial setup, prompt: "Send your first invoice" or "Record your first expense"
- One-click demo data option: creates a sample customer and pre-fills an invoice for the user to send
- Skip opening balances entirely in initial setup — add later when the accountant gets involved
- Bank connection is NOT required to start — it's a later progressive step

### Decision 5.3: Progressive disclosure, not feature bombardment

**Precedent:** Progressive disclosure reduces support tickets by 35%. Each additional setup step increases abandonment by 10-20%.

**Implementation:**
- Initial setup: 3 steps (confirm business type → confirm tax status → choose base currency)
- Week 1 prompts: "Connect your bank account", "Add your first supplier"
- Month 1 prompts: "Set up recurring invoices", "Review your first month's P&L"
- Advanced features (POs, asset register, multi-currency) discoverable but not promoted until the business signals need

---

## 6. Multi-Currency: Per-Transaction, Transparent, Inclusive

### Decision 6.1: Multiple currencies per customer/supplier

**Precedent:** QuickBooks' one-currency-per-customer model is universally hated. "Customer A - GBP" and "Customer A - USD" as separate profiles is absurd. Xero's per-contact default currency with per-transaction override is cleaner.

**Implementation:**
- Each customer/supplier has a default currency
- Every individual invoice/bill can use any currency regardless of the customer default
- No duplicate customer records needed for different currencies
- Cross-currency payments handled natively — no dummy clearing accounts required

### Decision 6.2: FX calculations are fully transparent and auditable

**Precedent:** Xero's FX gains/losses are described as "not documented and doesn't appear to be applied consistently." Users and accountants need to verify the math.

**Implementation:**
- Every payment shows: invoice currency, payment currency, exchange rate used, base currency equivalent
- Realised FX gain/loss calculated and displayed on each payment allocation
- Unrealised FX gain/loss on period-end revaluation with full line-by-line detail
- Exchange rate source and timestamp shown on every transaction
- FX gain/loss summary report with drill-down to individual transactions

### Decision 6.3: Multi-currency is not a premium feature

**Precedent:** Businesses trading in GBP and USD is baseline for any UK business with US clients. Gating multi-currency behind premium tiers feels like an artificial restriction.

**Implementation:**
- Multi-currency available to all users
- Auto-fetch daily exchange rates (ECB, or configurable source)
- Manual override per transaction (bank rates differ from market rates)
- Base currency set during onboarding, changeable later (with migration)

---

## 7. Expense Management: Mobile-First Capture, Web-First Management

### Decision 7.1: Phone-camera receipt capture is the primary input

**Precedent:** Expensify SmartScan and Dext prove that mobile receipt capture is non-negotiable. The card-based model (Pleo) is transformative but requires payment infrastructure we don't have yet.

**Implementation:**
- Mobile-optimised expense submission: take photo → auto-extract amount, date, vendor, category
- Show original receipt image alongside extracted data for verification
- Learn from corrections to improve future extraction for same vendor
- Fallback: manual entry for expenses without receipts (e.g., mileage)

### Decision 7.2: Approval routing by amount and department

**Precedent:** Configurable approval rules are essential once past 5 employees. But they must be simple — not a workflow engine.

**Implementation:**
- Default: all expenses require manager approval
- Configurable thresholds: under £25 auto-approved, £25-£500 manager, £500+ director
- Approvers get email with expense summary + receipt image + approve/reject buttons
- No login required for simple approve/reject (secure token link, same pattern as bill approval)

### Decision 7.3: Built-in expense management, not a standalone add-on

**Precedent:** Built-in accounting tool expense features are adequate for businesses under 20 employees. Standalone tools (Expensify, Pleo) win for larger teams because accounting tools treat expenses as an afterthought.

**Implementation:**
- Expense management is built-in, not a separate product
- Employee-facing via the employee portal (not the accounting UI)
- Approved expenses flow directly to the ledger — no manual re-entry
- Reimbursement included in payment runs (same system as supplier payments)

---

## 8. Integration & API: Don't Make the Xero/QuickBooks Mistakes

### Decision 8.1: Comprehensive webhooks with full payloads

**Precedent:** Xero webhooks only cover Contacts and Invoices. Events don't include record details. QuickBooks webhook delivery is unreliable. These gaps force developers to poll APIs, hitting rate limits.

**Implementation:**
- Webhooks for ALL entity types: invoices, payments, bills, suppliers, bank transactions, expenses, recurring schedules
- Full record data in webhook payloads (not just "something changed" notifications)
- Retry logic with exponential backoff
- Dead-letter queue visibility for failed deliveries
- Webhook event log accessible via admin UI

### Decision 8.2: Native Stripe integration for payment reconciliation

**Precedent:** Stripe/Xero native reconciliation is broken — missing fees, mismatched data, lump-sum payouts that don't tie to invoices. A2X/Synder exist because the native integrations are inadequate.

**Implementation:**
- Native Stripe Connect integration handling:
  - Per-invoice payment capture
  - Fee separation (gross amount, Stripe fee, net amount)
  - Payout reconciliation (match Stripe payouts to bank deposits)
  - Refund handling
- No middleware required for the Stripe happy path
- Extends EP-FINANCE-001 item 12 (payment-to-ledger automation)

---

## 9. What NOT to Build (Anti-Patterns from Research)

### Decision 9.1: No credit limit management in V1

**Precedent:** "Almost no SMB sets or enforces customer credit limits in their accounting software, even when the feature exists." Investment should go to automated reminders instead.

**Action:** Remove credit limit enforcement from Phase D. Keep aging analysis and dunning. Credit limits can be added later if demand materialises.

### Decision 9.2: No 3-way PO matching in V1

**Precedent:** Most SMBs under 20 employees don't do formal PO matching. It's valuable for growing businesses but premature for the initial release.

**Action:** Phase B delivers PO-to-bill conversion (2-way). 3-way matching (PO → goods receipt → bill) deferred to a future enhancement.

### Decision 9.3: No custom report builder

**Precedent:** Complex custom reports are built but never used by SMBs. Investment in a report builder has poor ROI compared to getting the standard reports right.

**Action:** Phase F delivers the standard report set (P&L, balance sheet, aged debtors/creditors, cash flow, budget vs actual). Custom report builder is out of scope indefinitely.

### Decision 9.4: No full subscription billing engine

**Precedent:** Proration, mid-cycle upgrades/downgrades, usage-based billing, trial periods, and plan changes all require dedicated platforms (Stripe Billing, Chargebee). Building half a solution is worse than integrating.

**Action:** Our recurring billing handles fixed-amount retainer/membership invoicing. Subscription management (plan changes, proration, card retry/dunning) integrates with Stripe Billing.

### Decision 9.5: No forced UI migrations

**Precedent:** QuickBooks' October 2025 invoice redesign ("A 1-minute process now takes 5 minutes") is a case study in how to alienate an entire user base. Forced changes to workflows break muscle memory.

**Action:** Any future UI changes offer a transition period with old/new toggle. Never remove functionality without a migration path.

---

## 10. Archetype-Specific Defaults Summary

Based on the research, here are the financial defaults per archetype category:

| Archetype | Default Terms | Reminders | POs | Recurring | Invoice Style |
|-----------|--------------|-----------|-----|-----------|--------------|
| Healthcare/Wellness | Due on receipt | Standard | Off | Memberships on | Clean/medical |
| Trades/Construction | Net 14 / COD | Aggressive (+3/+7/+14/+30) | On | Maintenance contracts | Practical/job-ref |
| Professional Services | Net 30 | Standard | Off | Retainers on | Corporate |
| Retail | Due on receipt | Gentle | Off | Off | Receipt-style |
| Education/Training | 50% deposit | Standard | Off | Course subs on | Academic |
| Nonprofit | Donation receipt | Off | Off | Recurring giving on | Warm/mission |
| Food/Hospitality | Due on receipt | Off | On (suppliers) | Off | Casual |
| Fitness/Recreation | Monthly DD | Standard | Off | Memberships on | Energetic |
| Beauty/Personal | Due on receipt | Gentle | Off | Package deals on | Elegant |
| Pet Services | Due on receipt | Standard | Off | Pet plans on | Friendly |

---

## Decision Log

| # | Decision | Precedent Source | Status |
|---|----------|-----------------|--------|
| 1.1 | Invoice creation < 60 seconds | FreshBooks UX, QuickBooks 2025 redesign backlash | Approved |
| 1.2 | Pay Now button on every invoice | Stripe conversion data (40% same-day payment) | Approved |
| 1.3 | View tracking + auto follow-up | FreshBooks, Xero, QuickBooks all do this | Approved |
| 1.4 | Smart default dunning, pre-due reminder | UK late payment data (62.6% late), emotional barrier research | Approved |
| 1.5 | Recurring invoicing as core feature | FreshBooks premium gate backlash | Approved |
| 1.6 | Predictable PDF filenames, inline customisation | QuickBooks random filename backlash, Xero settings-page complaints | Approved |
| 2.1 | Bill capture via email + OCR | Dext success (99.9% claimed, ~85% real) | Approved |
| 2.2 | Multi-step approval routing | ApprovalMax (19K businesses), Xero/QB gap | Approved |
| 2.3 | POs optional, archetype-driven | SMB adoption research, construction/trades need | Approved |
| 2.4 | Batch payment runs with consolidation | Xero gap (can't consolidate per-supplier) | Approved |
| 3.1 | Code-as-you-go reconciliation | Xero model success vs QB monthly friction | Approved |
| 3.2 | Bank rules from day one | Xero bank rules ROI, FreshBooks lack as weakness | Approved |
| 3.3 | AI-assisted matching | Xero JAX (80%+ auto-match, 7hrs→30min) | Approved |
| 3.4 | CSV import first, Open Banking later | Bank feed reliability issues (Yodlee, Wave) | Approved |
| 4.1 | Four-widget default dashboard | SMB dashboard research, cash position primacy | Approved |
| 4.2 | Plain language, accountant mode toggle | Non-accountant owner research | Approved |
| 4.3 | Aged debtors as actionable dashboard widget | Credit control usage research | Approved |
| 5.1 | Auto-generate financial setup from archetype | 85% setup abandonment, Xero COA auto-generation | Approved |
| 5.2 | First win = send invoice or record expense | 60-second value perception research | Approved |
| 5.3 | Progressive disclosure, 3-step setup | 35% support reduction, 10-20% abandonment per step | Approved |
| 6.1 | Multiple currencies per customer | QuickBooks one-currency-per-customer backlash | Approved |
| 6.2 | Transparent, auditable FX calculations | Xero FX opacity complaints | Approved |
| 6.3 | Multi-currency not premium-gated | Artificial restriction backlash | Approved |
| 7.1 | Phone camera receipt capture as primary input | Expensify/Dext success | Approved |
| 7.2 | Amount/department approval routing | 5-employee threshold research | Approved |
| 7.3 | Built-in expense management | Standalone vs built-in adequacy research | Approved |
| 8.1 | Comprehensive webhooks with full payloads | Xero webhook gaps, QB delivery issues | Approved |
| 8.2 | Native Stripe payment reconciliation | A2X/Synder existence proves gap in all platforms | Approved |
| 9.1 | No credit limits in V1 | SMBs don't use them | Approved |
| 9.2 | No 3-way PO matching in V1 | Premature for target market | Approved |
| 9.3 | No custom report builder | Never used by SMBs | Approved |
| 9.4 | No full subscription billing engine | Integrate with Stripe Billing | Approved |
| 9.5 | No forced UI migrations | QuickBooks 2025 case study | Approved |
