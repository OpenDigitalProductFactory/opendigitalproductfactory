# Financial Management Phase F: Financial Reporting

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the core financial reports (P&L summary, cash flow, VAT/tax summary, revenue by customer, outstanding invoices) with plain-language dashboard, accountant mode toggle, and CSV/PDF export. Per Decision 4.3: no custom report builder — ship the standard set that covers 90% of SMB needs.

**Architecture:** Report computations as server actions in `lib/actions/reports.ts` — pure query functions aggregating data from existing Invoice, Bill, Payment, BankAccount models. No new Prisma models needed. Report pages under `/(shell)/finance/reports/`. Each report has date range filters, a one-sentence plain-language summary at top (Decision 4.2), and CSV export.

**Tech Stack:** Prisma aggregations, Next.js server components, existing finance models, CSV generation via string concatenation (no library needed).

**Spec:** `docs/superpowers/specs/2026-03-20-financial-management-design.md` (item 16)
**Decisions:** `docs/superpowers/specs/2026-03-20-financial-management-implementation-decisions.md` (Decisions 4.1, 4.2, 4.3)

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `apps/web/lib/actions/reports.ts` | Report computation functions |
| `apps/web/lib/actions/reports.test.ts` | Tests |
| `apps/web/app/(shell)/finance/reports/page.tsx` | Reports index page |
| `apps/web/app/(shell)/finance/reports/profit-loss/page.tsx` | P&L report |
| `apps/web/app/(shell)/finance/reports/cash-flow/page.tsx` | Cash flow report |
| `apps/web/app/(shell)/finance/reports/vat-summary/page.tsx` | VAT/tax summary |
| `apps/web/app/(shell)/finance/reports/revenue-by-customer/page.tsx` | Revenue by customer |
| `apps/web/app/(shell)/finance/reports/outstanding/page.tsx` | Outstanding invoices report |
| `apps/web/app/api/v1/finance/reports/[report]/route.ts` | GET report data + CSV export |

### Modified Files
| File | Change |
|------|--------|
| `apps/web/app/(shell)/finance/page.tsx` | Add reports section to navigation |

---

## Task 1: Report Computation Functions

Create `apps/web/lib/actions/reports.ts` and `apps/web/lib/actions/reports.test.ts`.

**Functions:**

`getProfitAndLoss(startDate: Date, endDate: Date)` — returns:
```typescript
{
  revenue: number;       // sum of paid invoice totalAmount in period
  costOfSales: number;   // sum of paid bills totalAmount in period (category-filtered if available)
  grossProfit: number;   // revenue - costOfSales
  expenses: number;      // sum of paid expense claims in period
  netProfit: number;     // grossProfit - expenses
  invoiceCount: number;
  billCount: number;
  expenseCount: number;
  summary: string;       // "You made £X profit this month, up/down Y% from last period"
}
```
Query: invoices where status="paid" and paidAt in range, bills where status="paid" in range, expense claims where status="paid" in range.

`getCashFlowReport(startDate: Date, endDate: Date)` — returns:
```typescript
{
  openingBalance: number;    // sum of bank account balances at start (approximate: currentBalance - net transactions in period)
  moneyIn: number;           // inbound payments in period
  moneyOut: number;          // outbound payments + expense reimbursements in period
  netCashFlow: number;       // moneyIn - moneyOut
  closingBalance: number;    // sum of current bank balances
  inboundBreakdown: Array<{ method: string; total: number }>;
  outboundBreakdown: Array<{ method: string; total: number }>;
  summary: string;
}
```

`getVatSummary(startDate: Date, endDate: Date)` — returns:
```typescript
{
  outputVat: number;     // sum of taxAmount from paid invoices in period (VAT collected)
  inputVat: number;      // sum of taxAmount from paid bills in period (VAT paid)
  netVat: number;        // outputVat - inputVat (positive = owe HMRC)
  invoiceCount: number;
  billCount: number;
  summary: string;
}
```

`getRevenueByCustomer(startDate: Date, endDate: Date)` — returns:
```typescript
Array<{
  accountId: string;
  accountName: string;
  invoiceCount: number;
  totalRevenue: number;
  totalPaid: number;
  totalOutstanding: number;
}>
```
Group invoices by accountId, sum amounts.

`getOutstandingInvoicesReport()` — returns all unpaid invoices with customer, amount, due date, days overdue. Sorted by days overdue desc (worst first).

`exportReportToCsv(headers: string[], rows: string[][])` — pure function, returns CSV string.

**Tests:**
- getProfitAndLoss: correct aggregation from mocked data, calculates summary string with percentage
- getCashFlowReport: separates inbound/outbound, calculates net
- getVatSummary: correct output/input VAT calculation
- getRevenueByCustomer: groups by customer correctly
- exportReportToCsv: correct CSV formatting, handles commas in values

**Mock setup:**
```typescript
vi.mock("@dpf/db", () => ({
  prisma: {
    invoice: { aggregate: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
    bill: { aggregate: vi.fn(), findMany: vi.fn() },
    expenseClaim: { aggregate: vi.fn() },
    payment: { aggregate: vi.fn(), groupBy: vi.fn() },
    bankAccount: { aggregate: vi.fn() },
  },
}));
```

TDD: tests first, implement, verify.

Commit: `feat(finance): add financial report computation functions`

---

## Task 2: Report API Route

Create `apps/web/app/api/v1/finance/reports/[report]/route.ts` — single dynamic route handling all reports.

```typescript
// GET /api/v1/finance/reports/profit-loss?start=2026-01-01&end=2026-03-31
// GET /api/v1/finance/reports/profit-loss?start=2026-01-01&end=2026-03-31&format=csv
```

Supported report names: `profit-loss`, `cash-flow`, `vat-summary`, `revenue-by-customer`, `outstanding`.

If `format=csv` query param, return CSV with appropriate Content-Type and Content-Disposition headers.

Use `.js` extensions on API imports. authenticateRequest.

Commit: `feat(finance): add financial reports API with CSV export`

---

## Task 3: Reports Index Page

Create `apps/web/app/(shell)/finance/reports/page.tsx` — server component.

Card grid of available reports:
- Profit & Loss — "See your revenue, costs, and profit for any period"
- Cash Flow — "Track money in vs money out"
- VAT Summary — "Output VAT collected vs input VAT paid"
- Revenue by Customer — "See which customers generate the most revenue"
- Outstanding Invoices — "All unpaid invoices sorted by urgency"
- Aged Debtors — (link to existing page from Phase D)
- Aged Creditors — (link to existing page from Phase D)

Each card links to the respective report page.

Commit: `feat(finance): add reports index page`

---

## Task 4: P&L Report Page

Create `apps/web/app/(shell)/finance/reports/profit-loss/page.tsx`.

- Date range selector (default: current month). Use searchParams `start` and `end`.
- **Plain-language summary at top** (Decision 4.2): "You made £12,400 profit this month, up 8% from last month" (large text, prominent)
- **Accountant mode note**: Label says "Money In" not "Revenue" by default. Add small toggle "Show accounting terms" that switches labels.
- Table: Revenue (invoice income), Cost of Sales (bill payments), Gross Profit, Expenses (expense claims), Net Profit
- Each row: label, amount, percentage of revenue
- Compare to previous period (show +/- percentage)
- "Export CSV" link → `/api/v1/finance/reports/profit-loss?start=X&end=Y&format=csv`

Commit: `feat(finance): add profit and loss report page`

---

## Task 5: Cash Flow Report Page

Create `apps/web/app/(shell)/finance/reports/cash-flow/page.tsx`.

- Date range selector
- Summary: "£X came in, £Y went out. Net: +/- £Z"
- Opening balance, Money In (with method breakdown), Money Out (with method breakdown), Net, Closing balance
- Method breakdown: bank_transfer, card, cash, cheque, etc. as sub-rows
- "Export CSV" link

Commit: `feat(finance): add cash flow report page`

---

## Task 6: VAT Summary + Revenue by Customer + Outstanding Pages

Create 3 pages:

**`apps/web/app/(shell)/finance/reports/vat-summary/page.tsx`**
- Output VAT (collected on invoices), Input VAT (paid on bills), Net VAT liability
- Summary: "You owe £X in VAT this quarter" or "You're owed £X VAT refund"

**`apps/web/app/(shell)/finance/reports/revenue-by-customer/page.tsx`**
- Table: customer name, invoice count, total revenue, total paid, total outstanding
- Sorted by total revenue desc (biggest customers first)

**`apps/web/app/(shell)/finance/reports/outstanding/page.tsx`**
- All unpaid invoices: invoiceRef, customer, amount due, due date, days overdue, status
- Sorted by days overdue desc (worst first)
- "Send Reminder" link per row

Commit: `feat(finance): add VAT summary, revenue by customer, and outstanding invoices reports`

---

## Task 7: Dashboard + Navigation Update

Modify `apps/web/app/(shell)/finance/page.tsx`:
- Ensure Reports section in navigation includes all report links
- Add "P&L This Month" as a mini-widget if not already present (show net profit figure)

Run all tests. Fix any issues.

Commit: `feat(finance): update dashboard with reports navigation`

---

## Summary

| Task | What It Delivers |
|------|-----------------|
| 1 | Report computation functions (P&L, cash flow, VAT, revenue, outstanding) with tests |
| 2 | Reports API with CSV export |
| 3 | Reports index page |
| 4 | P&L report with plain-language summary |
| 5 | Cash flow report with method breakdown |
| 6 | VAT summary, revenue by customer, outstanding invoices |
| 7 | Dashboard navigation update + verification |
