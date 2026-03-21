# Financial Management Phase E: Expense Management

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver employee expense claims with receipt capture, approval workflows by amount threshold, and reimbursement via the existing payment run system.

**Architecture:** New Prisma models (ExpenseClaim, ExpenseItem) extend the finance schema. Server actions in `lib/actions/expenses.ts`. Approval uses the same token-based email pattern as bill approval (Decision 7.2). Receipt upload stores files via existing upload infrastructure or base64 in DB for MVP. Employee-facing portal page at `/portal/expenses`. Manager review at `/finance/expense-claims`. Approved claims feed into payment runs alongside supplier bills.

**Tech Stack:** Prisma, Next.js, Vitest, existing email/auth infrastructure.

**Spec:** `docs/superpowers/specs/2026-03-20-financial-management-design.md` (item 15)
**Decisions:** `docs/superpowers/specs/2026-03-20-financial-management-implementation-decisions.md` (Decisions 7.1-7.3)

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `apps/web/lib/actions/expenses.ts` | Server actions: claim CRUD, submit, approve, reject, reimburse |
| `apps/web/lib/actions/expenses.test.ts` | Tests |
| `apps/web/lib/expense-validation.ts` | Zod schemas |
| `apps/web/lib/expense-validation.test.ts` | Tests |
| `apps/web/app/(shell)/finance/expense-claims/page.tsx` | Manager view: all claims |
| `apps/web/app/(shell)/finance/expense-claims/[id]/page.tsx` | Claim detail with approve/reject |
| `apps/web/app/(shell)/portal/expenses/page.tsx` | Employee portal: my expenses |
| `apps/web/app/(shell)/portal/expenses/new/page.tsx` | Submit new claim |
| `apps/web/components/finance/CreateExpenseForm.tsx` | Client form for expense submission |
| `apps/web/app/(storefront)/s/expense-approve/[token]/page.tsx` | Public approval page |
| `apps/web/app/api/v1/finance/expense-claims/route.ts` | GET list + POST create |
| `apps/web/app/api/v1/finance/expense-claims/[id]/route.ts` | GET detail + PATCH update |

### Modified Files
| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add ExpenseClaim, ExpenseItem models |
| `apps/web/app/(shell)/finance/page.tsx` | Add expense claims widget |
| `apps/web/lib/email.ts` | Add composeExpenseApprovalEmail |

---

## Task 1: Prisma Models

Append to schema:

```prisma
// ─── Finance: Expense Management ───────────────────────────────────

model ExpenseClaim {
  id              String              @id @default(cuid())
  claimId         String              @unique
  employeeId      String
  status          String              @default("draft")
  title           String
  totalAmount     Decimal
  currency        String              @default("GBP")
  submittedAt     DateTime?
  approvedById    String?
  approvedAt      DateTime?
  rejectedReason  String?
  paidAt          DateTime?
  approvalToken   String?             @unique
  notes           String?
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt

  employee        EmployeeProfile     @relation("ExpenseClaims", fields: [employeeId], references: [id])
  approvedBy      User?               @relation("ExpenseApprovals", fields: [approvedById], references: [id])
  items           ExpenseItem[]

  @@index([employeeId])
  @@index([status])
}

model ExpenseItem {
  id              String              @id @default(cuid())
  claimId         String
  date            DateTime
  category        String
  description     String
  amount          Decimal
  currency        String              @default("GBP")
  receiptUrl      String?
  taxReclaimable  Boolean             @default(false)
  taxAmount       Decimal             @default(0)
  accountCode     String?
  sortOrder       Int                 @default(0)
  createdAt       DateTime            @default(now())

  claim           ExpenseClaim        @relation(fields: [claimId], references: [id], onDelete: Cascade)

  @@index([claimId])
}
```

Add reverse relations:
- `EmployeeProfile`: `expenseClaims ExpenseClaim[] @relation("ExpenseClaims")`
- `User`: `expenseApprovals ExpenseClaim[] @relation("ExpenseApprovals")`

Run migration, generate, commit: `feat(finance): add ExpenseClaim and ExpenseItem models`

---

## Task 2: Validation Schemas

```typescript
export const EXPENSE_CATEGORIES = ["travel", "meals", "accommodation", "supplies", "mileage", "other"] as const;
export const CLAIM_STATUSES = ["draft", "submitted", "approved", "rejected", "paid"] as const;

const expenseItemSchema = z.object({
  date: z.string().min(1),
  category: z.enum(EXPENSE_CATEGORIES),
  description: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().length(3).default("GBP"),
  receiptUrl: z.string().optional(),
  taxReclaimable: z.boolean().default(false),
  taxAmount: z.number().min(0).default(0),
  accountCode: z.string().optional(),
});

export const createExpenseClaimSchema = z.object({
  title: z.string().min(1),
  currency: z.string().length(3).default("GBP"),
  notes: z.string().optional(),
  items: z.array(expenseItemSchema).min(1),
});
```

TDD. Commit: `feat(finance): add validation schemas for expense claims`

---

## Task 3: Expense Server Actions

Create `apps/web/lib/actions/expenses.ts` and tests.

**Functions:**
- `createExpenseClaim(input)` — generate EXP-{year}-{seq}, calculate totalAmount from items, create with nested items. Auth: any authenticated user can create (not just manage_finance — employees submit their own). Use `auth()` to get current user, look up their EmployeeProfile.
- `getExpenseClaim(id)` — with items, employee name, approver
- `listExpenseClaims(filters?)` — for managers: all claims, filter by status. For employees: only their own claims.
- `submitExpenseClaim(id)` — set status="submitted", submittedAt=now, generate approvalToken, find approver (manager of employee or configurable), send approval email
- `respondToExpenseApproval(token, approved, reason?)` — token-based (no auth). Approve: set status="approved", approvedAt, approvedById. Reject: set status="draft" (back to employee), rejectedReason.
- `getExpenseClaimByApprovalToken(token)` — for public approval page
- `markExpenseReimbursed(id)` — set status="paid", paidAt

Also add `composeExpenseApprovalEmail` to `apps/web/lib/email.ts`.

**Tests:** createExpenseClaim (total calculation, sequential ref), submitExpenseClaim (generates token, sends email), respondToExpenseApproval (approve/reject), listExpenseClaims (filters by employee for non-managers).

Commit: `feat(finance): add expense claim actions with approval workflow`

---

## Task 4: API Routes

Create:
- `apps/web/app/api/v1/finance/expense-claims/route.ts` — GET list + POST create
- `apps/web/app/api/v1/finance/expense-claims/[id]/route.ts` — GET detail + PATCH (submit/approve/reject)

All with `.js` import extensions. Commit: `feat(finance): add expense claim API endpoints`

---

## Task 5: Manager Expense Claims Pages

**`apps/web/app/(shell)/finance/expense-claims/page.tsx`** — list all claims: claimId (mono), employee name, title, status badge, total amount, submitted date. Status filters. "Pending Approval" count at top.

**`apps/web/app/(shell)/finance/expense-claims/[id]/page.tsx`** — claim detail: metadata (employee, title, status, dates), expense items table (date, category, description, amount, receipt link), totals, approve/reject buttons (for managers), payment status.

Commit: `feat(finance): add expense claims manager pages`

---

## Task 6: Employee Portal Expenses Pages

**`apps/web/app/(shell)/portal/expenses/page.tsx`** — employee's own claims: list with status, total, dates. "New Expense Claim" button.

**`apps/web/app/(shell)/portal/expenses/new/page.tsx`** + **`apps/web/components/finance/CreateExpenseForm.tsx`** — client form: title, dynamic expense items (date picker, category dropdown, description, amount, receipt upload placeholder), notes. Live total. "Save as Draft" and "Submit for Approval" buttons.

Commit: `feat(finance): add employee expense portal pages`

---

## Task 7: Public Expense Approval Page

**`apps/web/app/(storefront)/s/expense-approve/[token]/page.tsx`** — public page (no auth). Shows claim summary, expense items, total. Large Approve (green) / Reject (red) buttons with optional comments. Same pattern as bill approval page.

Commit: `feat(finance): add public expense approval page`

---

## Task 8: Dashboard Update + Verification

Modify `apps/web/app/(shell)/finance/page.tsx`:
- Add "Expense Claims" widget: pending approval count
- Add links to Expense Claims (manager) and Portal Expenses (employee) in navigation

Run all tests. Fix issues.

Commit: `feat(finance): add expense claims widget to dashboard`

---

## Summary

| Task | What It Delivers |
|------|-----------------|
| 1 | Prisma models: ExpenseClaim, ExpenseItem |
| 2 | Validation schemas |
| 3 | Expense claim actions with approval workflow |
| 4 | API endpoints |
| 5 | Manager expense claims pages |
| 6 | Employee portal expense pages |
| 7 | Public expense approval page |
| 8 | Dashboard update + verification |
