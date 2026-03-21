# Financial Management Phase D: Recurring Billing & Credit Control

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver recurring invoice schedules (memberships, retainers, subscriptions), smart default dunning sequences with pre-due reminders, aging analysis as an actionable dashboard widget, and customer statement generation.

**Architecture:** New Prisma models (RecurringSchedule, RecurringLineItem, DunningSequence, DunningStep, DunningLog) extend the finance schema. Server actions in `lib/actions/recurring.ts` for recurring billing and `lib/actions/dunning.ts` for credit control. Dunning runs as a scheduled check (API endpoint callable by cron). Aging analysis computed on-demand from Invoice data.

**Tech Stack:** Prisma, Next.js, Vitest, existing email infrastructure, existing invoice creation pipeline.

**Spec:** `docs/superpowers/specs/2026-03-20-financial-management-design.md` (items 12-14)
**Decisions:** `docs/superpowers/specs/2026-03-20-financial-management-implementation-decisions.md` (Decisions 1.4, 1.5)

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `apps/web/lib/actions/recurring.ts` | Recurring schedule CRUD, invoice generation |
| `apps/web/lib/actions/recurring.test.ts` | Tests |
| `apps/web/lib/actions/dunning.ts` | Dunning engine, reminder sending, aging analysis |
| `apps/web/lib/actions/dunning.test.ts` | Tests |
| `apps/web/lib/recurring-validation.ts` | Zod schemas |
| `apps/web/lib/recurring-validation.test.ts` | Tests |
| `apps/web/app/(shell)/finance/recurring/page.tsx` | Recurring schedule list |
| `apps/web/app/(shell)/finance/recurring/new/page.tsx` | Create schedule |
| `apps/web/app/(shell)/finance/recurring/[id]/page.tsx` | Schedule detail |
| `apps/web/components/finance/CreateRecurringForm.tsx` | Client form |
| `apps/web/app/(shell)/finance/reports/aged-debtors/page.tsx` | Aged debtors report |
| `apps/web/app/(shell)/finance/reports/aged-creditors/page.tsx` | Aged creditors report |
| `apps/web/app/(shell)/finance/settings/dunning/page.tsx` | Dunning config |
| `apps/web/app/api/v1/finance/recurring/route.ts` | GET list + POST create |
| `apps/web/app/api/v1/finance/recurring/generate/route.ts` | POST trigger invoice generation |
| `apps/web/app/api/v1/finance/dunning/run/route.ts` | POST trigger dunning run |

### Modified Files
| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add RecurringSchedule, RecurringLineItem, DunningSequence, DunningStep, DunningLog |
| `apps/web/app/(shell)/finance/page.tsx` | Add recurring and aging widgets |
| `apps/web/lib/email.ts` | Add composeDunningEmail |

---

## Task 1: Prisma Models

- [ ] **Add models to schema**

```prisma
// ─── Finance: Recurring Billing ────────────────────────────────────

model RecurringSchedule {
  id              String              @id @default(cuid())
  scheduleId      String              @unique
  accountId       String
  name            String
  frequency       String
  amount          Decimal
  currency        String              @default("GBP")
  startDate       DateTime
  endDate         DateTime?
  nextInvoiceDate DateTime
  lastInvoicedAt  DateTime?
  status          String              @default("active")
  autoSend        Boolean             @default(true)
  templateNotes   String?
  createdById     String?
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt

  account         CustomerAccount     @relation(fields: [accountId], references: [id])
  createdBy       User?               @relation("RecurringScheduleCreations", fields: [createdById], references: [id])
  lineItems       RecurringLineItem[]

  @@index([accountId])
  @@index([status])
  @@index([nextInvoiceDate])
}

model RecurringLineItem {
  id              String              @id @default(cuid())
  scheduleId      String
  description     String
  quantity        Decimal             @default(1)
  unitPrice       Decimal
  taxRate         Decimal             @default(0)
  sortOrder       Int                 @default(0)
  createdAt       DateTime            @default(now())

  schedule        RecurringSchedule   @relation(fields: [scheduleId], references: [id], onDelete: Cascade)

  @@index([scheduleId])
}

// ─── Finance: Credit Control ───────────────────────────────────────

model DunningSequence {
  id              String              @id @default(cuid())
  name            String
  isDefault       Boolean             @default(false)
  isActive        Boolean             @default(true)
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt

  steps           DunningStep[]
}

model DunningStep {
  id              String              @id @default(cuid())
  sequenceId      String
  dayOffset       Int
  subject         String
  emailTemplate   String
  severity        String              @default("friendly")
  sortOrder       Int                 @default(0)
  createdAt       DateTime            @default(now())

  sequence        DunningSequence     @relation(fields: [sequenceId], references: [id], onDelete: Cascade)

  @@index([sequenceId])
}

model DunningLog {
  id              String              @id @default(cuid())
  invoiceId       String
  stepId          String?
  action          String
  sentAt          DateTime            @default(now())
  emailTo         String?
  notes           String?

  invoice         Invoice             @relation(fields: [invoiceId], references: [id])

  @@index([invoiceId])
  @@index([sentAt])
}
```

Add reverse relations:
- `CustomerAccount`: `recurringSchedules RecurringSchedule[]`
- `User`: `recurringSchedulesCreated RecurringSchedule[] @relation("RecurringScheduleCreations")`
- `Invoice`: `dunningLogs DunningLog[]`

- [ ] **Run migration, generate, commit**

```bash
git commit -m "feat(finance): add RecurringSchedule, DunningSequence, DunningLog models"
```

---

## Task 2: Validation Schemas

Create `apps/web/lib/recurring-validation.ts` and tests.

```typescript
export const FREQUENCIES = ["weekly", "fortnightly", "monthly", "quarterly", "annually"] as const;
export const SCHEDULE_STATUSES = ["active", "paused", "cancelled", "completed"] as const;
export const SEVERITIES = ["friendly", "firm", "final", "escalation"] as const;

export const createRecurringScheduleSchema = z.object({
  accountId: z.string().min(1),
  name: z.string().min(1),
  frequency: z.enum(FREQUENCIES),
  startDate: z.string().min(1),
  endDate: z.string().optional(),
  autoSend: z.boolean().default(true),
  templateNotes: z.string().optional(),
  currency: z.string().length(3).default("GBP"),
  lineItems: z.array(z.object({
    description: z.string().min(1),
    quantity: z.number().positive(),
    unitPrice: z.number().nonnegative(),
    taxRate: z.number().min(0).max(100).default(0),
  })).min(1),
});

export const createDunningSequenceSchema = z.object({
  name: z.string().min(1),
  isDefault: z.boolean().default(false),
  steps: z.array(z.object({
    dayOffset: z.number().int(),
    subject: z.string().min(1),
    emailTemplate: z.string().min(1),
    severity: z.enum(SEVERITIES),
  })).min(1),
});
```

TDD. Commit: `feat(finance): add validation schemas for recurring billing and dunning`

---

## Task 3: Recurring Billing Actions

Create `apps/web/lib/actions/recurring.ts` and tests.

**Functions:**
- `createRecurringSchedule(input)` — generate REC-{nanoid(8)}, calculate amount from line items, set nextInvoiceDate = startDate
- `getRecurringSchedule(id)` — with lineItems, account, recent generated invoices (via sourceType="recurring")
- `listRecurringSchedules(filters?)` — status filter
- `updateScheduleStatus(id, status)` — pause/cancel/reactivate
- `generateDueInvoices()` — find all active schedules where nextInvoiceDate <= now, for each: create invoice via `createInvoice` with sourceType="recurring" + sourceId=scheduleId, advance nextInvoiceDate by frequency, update lastInvoicedAt. If autoSend=true, call `sendInvoice`. Return count of generated invoices. IDEMPOTENT — check if invoice already exists for this schedule + period.
- `calculateNextDate(currentDate: Date, frequency: string): Date` — pure function: weekly +7d, fortnightly +14d, monthly +1mo, quarterly +3mo, annually +1yr

**Tests:** createRecurringSchedule (auth, ref, amount calc), generateDueInvoices (creates invoices for due schedules, advances nextInvoiceDate, skips paused, idempotent), calculateNextDate (all frequencies).

Commit: `feat(finance): add recurring billing with auto-invoice generation`

---

## Task 4: Dunning and Credit Control Actions

Create `apps/web/lib/actions/dunning.ts` and tests.

**Functions:**
- `createDunningSequence(input)` — create with steps, seed default if none exists
- `getDefaultDunningSequence()` — return the default sequence with steps
- `seedDefaultDunningSequence()` — create the smart default (Decision 1.4): Day -3 friendly pre-due, Day +7 first overdue, Day +14 firm, Day +30 final + flag, Day +45 escalation
- `runDunning()` — find overdue invoices (sent/viewed/partially_paid where dueDate < now), for each: find applicable dunning step based on days overdue, check DunningLog to avoid duplicate sends, send reminder email with payment link, create DunningLog entry, increment invoice.reminderCount. Return count of reminders sent.
- `getAgedDebtors()` — group invoices by customer, bucket by age: current (not overdue), 1-30d, 31-60d, 61-90d, 90d+. Return per-customer totals and grand totals.
- `getAgedCreditors()` — same for bills (from AP)
- `generateCustomerStatement(accountId: string)` — list all invoices + payments for a customer, calculate running balance

Also add `composeDunningEmail` to `apps/web/lib/email.ts`:
```typescript
export function composeDunningEmail(params: {
  to: string;
  invoiceRef: string;
  accountName: string;
  amountDue: string;
  currency: string;
  daysPastDue: number;
  severity: string;
  payUrl: string;
}) { /* Subject varies by severity. Always includes Pay Now link. */ }
```

**Tests:** seedDefaultDunningSequence (creates 5 steps), runDunning (sends reminders for overdue, skips already-sent, respects step timing), getAgedDebtors (correct bucketing).

Commit: `feat(finance): add dunning engine with smart defaults and aging analysis`

---

## Task 5: API Routes

Create:
- `apps/web/app/api/v1/finance/recurring/route.ts` — GET list + POST create
- `apps/web/app/api/v1/finance/recurring/generate/route.ts` — POST trigger generateDueInvoices (for cron)
- `apps/web/app/api/v1/finance/dunning/run/route.ts` — POST trigger runDunning (for cron)

All with `.js` import extensions, authenticateRequest.

Commit: `feat(finance): add recurring billing and dunning API endpoints`

---

## Task 6: Recurring Schedule UI Pages

Create:
- `apps/web/app/(shell)/finance/recurring/page.tsx` — list with status filter (active/paused/cancelled), name, customer, frequency, amount, next invoice date, "New Schedule" button
- `apps/web/app/(shell)/finance/recurring/new/page.tsx` + `apps/web/components/finance/CreateRecurringForm.tsx` — customer selector, name, frequency dropdown, start date, end date (optional), auto-send toggle, line items, live total
- `apps/web/app/(shell)/finance/recurring/[id]/page.tsx` — detail with line items, status, next invoice date, history of generated invoices, pause/cancel buttons

Commit: `feat(finance): add recurring schedule list, detail, and create pages`

---

## Task 7: Aged Debtors/Creditors Report Pages

Create:
- `apps/web/app/(shell)/finance/reports/aged-debtors/page.tsx` — table: customer name, current, 1-30d, 31-60d, 61-90d, 90d+ columns, total row. Each customer row clickable → "Send Reminder" action. Grand totals at bottom.
- `apps/web/app/(shell)/finance/reports/aged-creditors/page.tsx` — same format for supplier bills

Call `getAgedDebtors()` and `getAgedCreditors()`.

Commit: `feat(finance): add aged debtors and aged creditors report pages`

---

## Task 8: Dunning Settings Page

Create `apps/web/app/(shell)/finance/settings/dunning/page.tsx`:
- Shows current dunning sequence with steps in timeline format
- Each step: day offset (e.g., "3 days before due", "7 days after due"), severity badge, subject line
- "Seed Default Sequence" button if no sequence exists
- Edit capability (future — show read-only for now)

Commit: `feat(finance): add dunning settings page`

---

## Task 9: Update Dashboard + Verification

Modify `apps/web/app/(shell)/finance/page.tsx`:
- Add "Active Recurring" count widget
- Add link to Recurring Schedules and Reports in navigation
- Add aged debtors summary as widget (total overdue > 30 days)

Run all tests. Fix issues.

Commit: `feat(finance): add recurring and aging widgets to dashboard`

---

## Summary

| Task | What It Delivers |
|------|-----------------|
| 1 | Prisma models for recurring, dunning |
| 2 | Validation schemas |
| 3 | Recurring billing engine with auto-invoice generation |
| 4 | Dunning engine with smart defaults, aging analysis, statements |
| 5 | API endpoints (incl. cron-callable generate + dunning) |
| 6 | Recurring schedule UI (list, create, detail) |
| 7 | Aged debtors/creditors reports |
| 8 | Dunning settings page |
| 9 | Dashboard update + verification |
