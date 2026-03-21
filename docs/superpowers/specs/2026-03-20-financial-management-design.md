# EP-FINMGMT-001: Financial Management Suite

**Date:** 2026-03-20
**Status:** Draft
**Author:** Mark Bodman (CEO) + Claude (COO/design partner)
**Epic:** EP-FINMGMT-001

**Companion document:** [Implementation Decisions](2026-03-20-financial-management-implementation-decisions.md) — binding design decisions based on public discourse analysis of Xero, QuickBooks, FreshBooks, Wave, Zoho, Expensify, Dext, Pleo, ApprovalMax, Float, and SMB practitioner feedback.

**Prerequisites:**
- EP-STORE-001 — Storefront Foundation (defines business type/archetype, order capture)
- EP-FINANCE-001 — Financial Primitives (ERPNext deployment, connector platform)

**Related:**
- EP-FINANCE-001 — ERPNext integration, AP/AR basics, payroll connectors, cart-to-ledger
- EP-CRM-SALES-001 — Quoting, sales orders, lead-to-opportunity pipeline
- EP-STORE-001 — Storefront orders, bookings, donations, inquiries
- CRM Core — Customer account lifecycle
- GRC Suite — Compliance controls, audit trail, policy framework

---

## Problem Statement

The platform has **ERPNext integration planned** (EP-FINANCE-001) and a **sales pipeline** (EP-CRM-SALES-001), but there is no coherent end-to-end financial management experience for the business operator. A customer who deploys this platform to run their business needs to:

1. **Send invoices and get paid.** No invoice model exists. Orders and sales orders have no invoicing workflow — no generation, no sending, no tracking, no reminders, no aging.

2. **Pay suppliers and manage expenses.** EP-FINANCE-001 item 2 covers AP at an ERPNext level, but there is no purchase order workflow, no expense claim system for employees, and no receipt capture.

3. **Reconcile their bank.** No bank feed integration, no reconciliation workflow, no cash position visibility. Businesses cannot trust their books without reconciliation.

4. **Manage recurring billing.** Many storefront archetypes (training, consulting, SaaS, fitness memberships) depend on subscriptions and recurring invoices. This is completely absent.

5. **See their financial position.** No P&L, balance sheet, cash flow statement, trial balance, or management dashboard. EP-FINANCE-001 item 14 mentions "P&L summaries" but there is no design for how these reach the business operator.

6. **Handle multi-currency.** The platform targets US and UK businesses. GBP/USD handling, exchange rates, and foreign currency gains/losses are not addressed.

7. **Get archetype-appropriate financial setup.** A plumber's financial needs differ from a training company's. The storefront archetype should seed appropriate chart of accounts, tax codes, payment terms, and invoice templates — not force every business through generic setup.

8. **Track employee expenses and reimbursements.** No employee self-service for expense submission, approval, or reimbursement.

9. **Manage fixed assets.** Businesses own equipment, vehicles, and property. No asset register, depreciation, or disposal tracking.

10. **Handle credit control.** No customer credit limits, payment terms enforcement, aging analysis, or automated dunning.

---

## Goals

1. **Invoicing workflow** — create, send, track, remind, and collect on invoices from multiple sources (sales orders, storefront orders, recurring schedules, manual).

2. **Purchase-to-pay** — purchase orders, goods receipt, supplier invoice matching, payment approval, and payment execution.

3. **Expense management** — employee expense submission with receipt capture, approval workflows, and reimbursement processing.

4. **Bank reconciliation** — bank feed import (manual CSV + future Open Banking), matching engine, and reconciliation status dashboard.

5. **Recurring billing** — subscription plans, recurring invoice generation, payment retry, and dunning sequences.

6. **Financial reporting** — P&L, balance sheet, cash flow, trial balance, aged debtors/creditors, and budget vs actual — role-appropriate and archetype-aware.

7. **Archetype-driven financial setup** — chart of accounts templates, tax code defaults, payment terms, and invoice templates seeded from the storefront archetype.

8. **Multi-currency** — transaction currency, base currency, exchange rate management, and realized/unrealized FX gains/losses.

9. **Credit control** — customer credit limits, payment terms, aging analysis, automated payment reminders, and escalation workflows.

10. **Fixed asset management** — asset register, depreciation schedules (straight-line, reducing balance), disposal, and integration with GL.

11. **Employee financial self-service** — payslip visibility, expense submission, reimbursement tracking via the employee portal.

12. **Financial dashboard** — cash position, outstanding receivables/payables, overdue items, monthly trend, and key ratios as workspace tiles.

---

## Non-Goals

- **Replacing ERPNext** — ERPNext remains the accounting system of record per the Finance Hub Architecture spec. This epic defines the DPF-native experience layer and the data flows.
- **Full payroll engine** — payroll execution remains with regional providers (EP-FINANCE-001 items 4, 8). This epic covers payslip visibility only.
- **Tax return filing** — tax calculation is in scope; automated filing with HMRC/IRS is future work.
- **Payment gateway implementation** — Stripe integration is EP-FINANCE-001 item 12. This epic defines the invoice/billing workflow that triggers payments.
- **Quoting** — handled by EP-CRM-SALES-001. This epic picks up from the accepted quote / sales order.
- **Inventory/stock costing** — future epic for product-based businesses.

---

## Design

### 1. Archetype-Driven Financial Profiles

The storefront archetype (selected during setup) determines the financial profile. Each archetype maps to a financial profile that seeds:

| Component | What It Seeds |
|-----------|--------------|
| Chart of accounts template | Industry-appropriate account categories and defaults |
| Tax configuration | VAT-registered vs not, standard/reduced rates, US sales tax zones |
| Payment terms | Net 30, due on receipt, 50% deposit, etc. based on industry norms |
| Invoice template | Professional vs trade vs nonprofit styling |
| Recurring billing | Whether subscription/membership features are enabled by default |
| Expense categories | Industry-relevant expense types |

**Financial Profile Mapping (representative):**

| Archetype Category | CoA Template | Default Terms | Recurring | Typical Invoice |
|-------------------|-------------|---------------|-----------|----------------|
| Healthcare/Wellness | Services + clinical | Due on receipt | Memberships | Appointment-linked |
| Trades | Job costing + materials | Net 14 / COD | Maintenance contracts | Job/quote-linked |
| Professional Services | Time & materials | Net 30 | Retainers | Time-based |
| Retail | Cost of goods + inventory | Due on receipt | N/A | POS receipt |
| Education/Training | Course revenue + materials | 50% deposit | Course subscriptions | Enrollment-linked |
| Nonprofit | Fund accounting | Donation receipt | Recurring giving | Donation receipt |
| Food/Hospitality | F&B costing | Due on receipt | N/A | Table/order receipt |
| Fitness/Recreation | Membership + services | Monthly DD | Memberships | Monthly statement |
| Beauty/Personal | Services + products | Due on receipt | Package deals | Appointment-linked |
| Pet Services | Services + boarding | Due on receipt | Pet plans | Visit-linked |

### 2. Data Model

All models are DPF-native (Prisma). ERPNext sync is event-driven — DPF is the experience layer, ERPNext is the ledger of record.

#### 2.1 Invoice

```prisma
model Invoice {
  id              String           @id @default(cuid())
  invoiceId       String           @unique  // INV-2026-0001 (sequential)
  type            String           @default("standard")
  // standard | credit_note | proforma | recurring_instance
  status          String           @default("draft")
  // draft | approved | sent | viewed | partially_paid | paid | overdue | void | written_off
  accountId       String                    // FK to CustomerAccount
  contactId       String?                   // FK to CustomerContact
  sourceType      String?                   // sales_order | storefront_order | recurring | manual
  sourceId        String?                   // FK to originating record
  issueDate       DateTime         @default(now())
  dueDate         DateTime
  currency        String           @default("GBP")
  subtotal        Decimal
  taxAmount       Decimal          @default(0)
  discountAmount  Decimal          @default(0)
  totalAmount     Decimal
  amountPaid      Decimal          @default(0)
  amountDue       Decimal                   // computed: totalAmount - amountPaid
  paymentTerms    String?                   // "Net 30", "Due on receipt", etc.
  notes           String?
  internalNotes   String?
  sentAt          DateTime?
  viewedAt        DateTime?
  paidAt          DateTime?
  voidedAt        DateTime?
  reminderCount   Int              @default(0)
  lastReminderAt  DateTime?
  erpSyncStatus   String?          @default("pending")
  // pending | synced | error
  erpRefId        String?                   // ERPNext invoice reference
  createdById     String?
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  account         CustomerAccount  @relation(fields: [accountId], references: [id])
  contact         CustomerContact? @relation(fields: [contactId], references: [id])
  createdBy       User?            @relation("InvoiceCreations", fields: [createdById], references: [id])
  lineItems       InvoiceLineItem[]
  payments        PaymentAllocation[]

  @@index([accountId])
  @@index([status])
  @@index([dueDate])
  @@index([sourceType, sourceId])
}

model InvoiceLineItem {
  id              String           @id @default(cuid())
  invoiceId       String
  description     String
  quantity        Decimal          @default(1)
  unitPrice       Decimal
  taxRate         Decimal          @default(0)  // percentage
  taxAmount       Decimal          @default(0)
  discountPercent Decimal          @default(0)
  lineTotal       Decimal
  accountCode     String?                   // GL account code
  sortOrder       Int              @default(0)
  createdAt       DateTime         @default(now())

  invoice         Invoice          @relation(fields: [invoiceId], references: [id], onDelete: Cascade)

  @@index([invoiceId])
}
```

#### 2.2 Payment

```prisma
model Payment {
  id              String           @id @default(cuid())
  paymentId       String           @unique  // PAY-2026-0001 (sequential)
  direction       String           // inbound | outbound
  method          String           // bank_transfer | card | cash | cheque | direct_debit | stripe
  status          String           @default("pending")
  // pending | completed | failed | refunded | cancelled
  amount          Decimal
  currency        String           @default("GBP")
  exchangeRate    Decimal          @default(1)
  baseCurrencyAmount Decimal?               // amount in org base currency
  reference       String?                   // bank reference / cheque number
  stripePaymentId String?                   // Stripe payment intent ID
  accountId       String?                   // CustomerAccount (inbound) or supplierId (outbound)
  receivedAt      DateTime?
  processedAt     DateTime?
  reconciled      Boolean          @default(false)
  reconciledAt    DateTime?
  bankAccountId   String?                   // FK to BankAccount
  erpSyncStatus   String?          @default("pending")
  erpRefId        String?
  notes           String?
  createdById     String?
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  bankAccount     BankAccount?     @relation(fields: [bankAccountId], references: [id])
  createdBy       User?            @relation("PaymentCreations", fields: [createdById], references: [id])
  allocations     PaymentAllocation[]

  @@index([direction])
  @@index([status])
  @@index([accountId])
  @@index([bankAccountId])
}

model PaymentAllocation {
  id              String           @id @default(cuid())
  paymentId       String
  invoiceId       String?          // FK to Invoice (AR allocation)
  billId          String?          // FK to Bill (AP allocation)
  amount          Decimal
  createdAt       DateTime         @default(now())

  payment         Payment          @relation(fields: [paymentId], references: [id])
  invoice         Invoice?         @relation(fields: [invoiceId], references: [id])
  bill            Bill?            @relation(fields: [billId], references: [id])

  @@index([paymentId])
  @@index([invoiceId])
  @@index([billId])
}
```

#### 2.3 Bill (Supplier Invoice / AP)

```prisma
model Supplier {
  id              String           @id @default(cuid())
  supplierId      String           @unique  // SUP-<uuid>
  name            String
  contactName     String?
  email           String?
  phone           String?
  address         Json?
  taxId           String?                   // VAT number / EIN
  paymentTerms    String?          @default("Net 30")
  defaultCurrency String           @default("GBP")
  status          String           @default("active")
  // active | inactive | blocked
  bankDetails     Json?                     // { sortCode, accountNumber, iban, swift }
  erpSyncStatus   String?          @default("pending")
  erpRefId        String?
  notes           String?
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  bills           Bill[]
  purchaseOrders  PurchaseOrder[]

  @@index([status])
}

model Bill {
  id              String           @id @default(cuid())
  billId          String           @unique  // BILL-2026-0001 (sequential)
  supplierId      String
  status          String           @default("draft")
  // draft | awaiting_approval | approved | partially_paid | paid | void
  invoiceRef      String?                   // supplier's invoice number
  issueDate       DateTime
  dueDate         DateTime
  currency        String           @default("GBP")
  subtotal        Decimal
  taxAmount       Decimal          @default(0)
  totalAmount     Decimal
  amountPaid      Decimal          @default(0)
  amountDue       Decimal
  purchaseOrderId String?                   // FK to PurchaseOrder
  notes           String?
  erpSyncStatus   String?          @default("pending")
  erpRefId        String?
  createdById     String?
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  supplier        Supplier         @relation(fields: [supplierId], references: [id])
  purchaseOrder   PurchaseOrder?   @relation(fields: [purchaseOrderId], references: [id])
  createdBy       User?            @relation("BillCreations", fields: [createdById], references: [id])
  lineItems       BillLineItem[]
  allocations     PaymentAllocation[]

  @@index([supplierId])
  @@index([status])
  @@index([dueDate])
}

model BillLineItem {
  id              String           @id @default(cuid())
  billId          String
  description     String
  quantity        Decimal          @default(1)
  unitPrice       Decimal
  taxRate         Decimal          @default(0)
  taxAmount       Decimal          @default(0)
  lineTotal       Decimal
  accountCode     String?
  sortOrder       Int              @default(0)
  createdAt       DateTime         @default(now())

  bill            Bill             @relation(fields: [billId], references: [id], onDelete: Cascade)

  @@index([billId])
}
```

#### 2.4 Purchase Order

```prisma
model PurchaseOrder {
  id              String           @id @default(cuid())
  poNumber        String           @unique  // PO-2026-0001 (sequential)
  supplierId      String
  status          String           @default("draft")
  // draft | sent | acknowledged | partially_received | received | cancelled
  currency        String           @default("GBP")
  subtotal        Decimal
  taxAmount       Decimal          @default(0)
  totalAmount     Decimal
  deliveryDate    DateTime?
  deliveryAddress Json?
  terms           String?
  notes           String?
  sentAt          DateTime?
  createdById     String?
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  supplier        Supplier         @relation(fields: [supplierId], references: [id])
  createdBy       User?            @relation("PurchaseOrderCreations", fields: [createdById], references: [id])
  lineItems       PurchaseOrderLineItem[]
  bills           Bill[]

  @@index([supplierId])
  @@index([status])
}

model PurchaseOrderLineItem {
  id              String           @id @default(cuid())
  purchaseOrderId String
  description     String
  quantity        Decimal          @default(1)
  unitPrice       Decimal
  taxRate         Decimal          @default(0)
  taxAmount       Decimal          @default(0)
  lineTotal       Decimal
  sortOrder       Int              @default(0)
  createdAt       DateTime         @default(now())

  purchaseOrder   PurchaseOrder    @relation(fields: [purchaseOrderId], references: [id], onDelete: Cascade)

  @@index([purchaseOrderId])
}
```

#### 2.5 Bank Account & Reconciliation

```prisma
model BankAccount {
  id              String           @id @default(cuid())
  bankAccountId   String           @unique  // BA-<uuid>
  name            String                    // "Business Current Account"
  bankName        String?
  accountNumber   String?
  sortCode        String?
  iban            String?
  swift           String?
  currency        String           @default("GBP")
  accountType     String           @default("current")
  // current | savings | credit_card | loan | merchant
  isDefault       Boolean          @default(false)
  openingBalance  Decimal          @default(0)
  currentBalance  Decimal          @default(0)
  lastReconciledAt DateTime?
  status          String           @default("active")
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  payments        Payment[]
  bankTransactions BankTransaction[]

  @@index([status])
}

model BankTransaction {
  id              String           @id @default(cuid())
  bankAccountId   String
  transactionDate DateTime
  description     String
  amount          Decimal                   // positive = credit, negative = debit
  balance         Decimal?                  // running balance if provided by bank
  reference       String?
  category        String?                   // auto-categorized or manual
  matchStatus     String           @default("unmatched")
  // unmatched | matched | manually_matched | excluded
  matchedPaymentId String?
  importBatchId   String?                   // which CSV import batch
  createdAt       DateTime         @default(now())

  bankAccount     BankAccount      @relation(fields: [bankAccountId], references: [id])

  @@index([bankAccountId])
  @@index([matchStatus])
  @@index([transactionDate])
}
```

#### 2.6 Recurring Billing

```prisma
model RecurringSchedule {
  id              String           @id @default(cuid())
  scheduleId      String           @unique  // REC-<uuid>
  accountId       String                    // FK to CustomerAccount
  name            String                    // "Monthly Membership - Gold"
  frequency       String                    // weekly | fortnightly | monthly | quarterly | annually
  amount          Decimal
  currency        String           @default("GBP")
  startDate       DateTime
  endDate         DateTime?                 // null = indefinite
  nextInvoiceDate DateTime
  lastInvoicedAt  DateTime?
  status          String           @default("active")
  // active | paused | cancelled | completed
  autoSend        Boolean          @default(true)
  templateNotes   String?                   // notes included on each invoice
  createdById     String?
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  account         CustomerAccount  @relation(fields: [accountId], references: [id])
  createdBy       User?            @relation("RecurringScheduleCreations", fields: [createdById], references: [id])
  lineItems       RecurringLineItem[]

  @@index([accountId])
  @@index([status])
  @@index([nextInvoiceDate])
}

model RecurringLineItem {
  id              String           @id @default(cuid())
  scheduleId      String
  description     String
  quantity        Decimal          @default(1)
  unitPrice       Decimal
  taxRate         Decimal          @default(0)
  sortOrder       Int              @default(0)
  createdAt       DateTime         @default(now())

  schedule        RecurringSchedule @relation(fields: [scheduleId], references: [id], onDelete: Cascade)

  @@index([scheduleId])
}
```

#### 2.7 Expense Claims

```prisma
model ExpenseClaim {
  id              String           @id @default(cuid())
  claimId         String           @unique  // EXP-2026-0001 (sequential)
  employeeId      String                    // FK to EmployeeProfile
  status          String           @default("draft")
  // draft | submitted | approved | rejected | paid
  title           String                    // "March client travel"
  totalAmount     Decimal
  currency        String           @default("GBP")
  submittedAt     DateTime?
  approvedById    String?
  approvedAt      DateTime?
  rejectedReason  String?
  paidAt          DateTime?
  notes           String?
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  employee        EmployeeProfile  @relation("ExpenseClaims", fields: [employeeId], references: [id])
  approvedBy      User?            @relation("ExpenseApprovals", fields: [approvedById], references: [id])
  items           ExpenseItem[]

  @@index([employeeId])
  @@index([status])
}

model ExpenseItem {
  id              String           @id @default(cuid())
  claimId         String
  date            DateTime
  category        String                    // travel | meals | accommodation | supplies | mileage | other
  description     String
  amount          Decimal
  currency        String           @default("GBP")
  receiptUrl      String?                   // uploaded receipt image/PDF
  taxReclaimable  Boolean          @default(false)
  taxAmount       Decimal          @default(0)
  accountCode     String?
  sortOrder       Int              @default(0)
  createdAt       DateTime         @default(now())

  claim           ExpenseClaim     @relation(fields: [claimId], references: [id], onDelete: Cascade)

  @@index([claimId])
}
```

#### 2.8 Fixed Assets

```prisma
model FixedAsset {
  id              String           @id @default(cuid())
  assetId         String           @unique  // FA-<uuid>
  name            String
  category        String                    // equipment | vehicle | furniture | IT | property | other
  purchaseDate    DateTime
  purchaseCost    Decimal
  currency        String           @default("GBP")
  depreciationMethod String        @default("straight_line")
  // straight_line | reducing_balance
  usefulLifeMonths Int
  residualValue   Decimal          @default(0)
  currentBookValue Decimal
  accumulatedDepreciation Decimal  @default(0)
  status          String           @default("active")
  // active | disposed | written_off
  disposedAt      DateTime?
  disposalAmount  Decimal?
  location        String?
  assignedToId    String?                   // FK to EmployeeProfile
  serialNumber    String?
  notes           String?
  erpSyncStatus   String?          @default("pending")
  erpRefId        String?
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  @@index([status])
  @@index([category])
}
```

### 3. Financial Reporting Views

DPF provides the experience layer. Reports pull data from both DPF models (invoices, bills, payments) and ERPNext (GL balances, journal entries) via the connector.

| Report | Source | Audience |
|--------|--------|----------|
| Aged Debtors | DPF Invoice + Payment | Finance / Owner |
| Aged Creditors | DPF Bill + Payment | Finance / Owner |
| Cash Flow Forecast | DPF Invoice + Bill + BankAccount | Finance / Owner |
| Profit & Loss | ERPNext GL via connector | Finance / Owner |
| Balance Sheet | ERPNext GL via connector | Finance / Owner |
| Trial Balance | ERPNext GL via connector | Finance |
| Budget vs Actual | DPF Budget + ERPNext GL | Owner / Manager |
| VAT/Tax Summary | DPF Invoice + Bill tax amounts | Finance |
| Expense Report | DPF ExpenseClaim | Manager / HR |
| Bank Reconciliation | DPF BankTransaction + Payment | Finance |
| Revenue by Customer | DPF Invoice | Owner / Sales |
| Outstanding Invoices | DPF Invoice (status != paid) | Owner / Finance |

### 4. Integration Architecture

```
                    ┌─────────────────┐
                    │   DPF Platform   │
                    │  (Experience)    │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
    ┌─────────▼──────┐ ┌────▼─────┐ ┌─────▼────────┐
    │  Stripe        │ │ ERPNext  │ │ Bank Feeds   │
    │  (Payments)    │ │ (Ledger) │ │ (CSV/OB)     │
    └────────────────┘ └──────────┘ └──────────────┘
```

**Event flow:**
1. DPF creates Invoice → publishes `invoice.created` event
2. ERPNext connector picks up event → creates Sales Invoice in ERPNext
3. Stripe processes payment → webhook → DPF creates Payment record
4. DPF allocates Payment to Invoice → publishes `payment.allocated` event
5. ERPNext connector posts payment entry
6. Bank feed imported → DPF matching engine suggests matches → user confirms
7. Reconciliation status updated across all systems

### 5. Dunning / Credit Control Sequences

Automated payment chasing, configurable per business:

| Day | Action |
|-----|--------|
| Due date | Invoice marked overdue |
| +3 days | Friendly reminder email |
| +14 days | Firm reminder email |
| +30 days | Final notice + account flagged |
| +45 days | Escalation to owner / collection |

Sequences are configurable. Nonprofit and donation archetypes have dunning disabled by default.

---

## Relationship to EP-FINANCE-001

EP-FINANCE-001 covers the **infrastructure and integration layer**: ERPNext deployment, connectors, ledger posting, payroll providers, tax engine, and CRM-to-finance bridges.

EP-FINMGMT-001 covers the **business operator experience**: the invoices they send, the bills they pay, the bank they reconcile, the expenses their team submits, the reports they review, and the financial setup that matches their business type.

These epics are complementary. EP-FINANCE-001 items 1-3 (ERPNext deployment, AP processing, AR processing) are prerequisites for the sync layer used by this epic. Items 11-16 (checkout integration, payment-to-ledger, governance) overlap and should be cross-referenced during execution.

---

## Phased Delivery

### Phase A: Invoicing & Payments (Foundation)
- Invoice model, line items, sequential numbering
- Invoice lifecycle (draft → sent → paid)
- Manual payment recording
- Invoice from sales order conversion
- Invoice from storefront order conversion
- Basic invoice PDF/email sending

### Phase B: Accounts Payable
- Supplier model
- Bill capture and lifecycle
- Purchase order workflow
- Payment runs (batch outbound payments)
- 3-way matching (PO → receipt → bill)

### Phase C: Banking & Reconciliation
- Bank account model
- CSV bank feed import
- Auto-matching engine
- Manual matching UI
- Cash position dashboard

### Phase D: Recurring Billing & Credit Control
- Recurring schedule model
- Automatic invoice generation
- Dunning sequences
- Customer credit limits
- Aging analysis

### Phase E: Expense Management
- Expense claim model
- Employee submission UI (employee portal)
- Receipt upload
- Approval workflow
- Reimbursement processing

### Phase F: Financial Reporting
- Aged debtors/creditors reports
- Cash flow forecast
- P&L and balance sheet (via ERPNext connector)
- Budget vs actual
- Financial dashboard workspace tile

### Phase G: Asset Management & Multi-Currency
- Fixed asset register
- Depreciation schedules
- Multi-currency transactions
- Exchange rate management
- FX gain/loss posting

### Phase H: Archetype-Driven Setup
- Financial profile templates per archetype
- Chart of accounts seeding
- Tax configuration defaults
- Payment terms defaults
- Invoice template selection

---

## Out of Scope (Future Epics)

- **Inventory/stock management** — stock levels, reorder points, COGS
- **Point of sale** — in-person payment terminal integration
- **Payroll execution** — handled by EP-FINANCE-001 via regional providers
- **Tax return filing** — MTD, IRS e-filing
- **Open Banking API** — real-time bank feeds (Phase C starts with CSV)
- **AI-assisted bookkeeping** — auto-categorization, anomaly detection
- **Multi-entity consolidation** — group-level financial reporting across entities
- **Audit trail blockchain** — immutable financial event log
