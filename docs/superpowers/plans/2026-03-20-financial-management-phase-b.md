# Financial Management Phase B: Accounts Payable

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver supplier management, bill capture and approval workflows, purchase orders (archetype-driven), and batch payment runs — enabling businesses to manage money going out.

**Architecture:** New Prisma models (Supplier, Bill, BillLineItem, PurchaseOrder, PurchaseOrderLineItem, ApprovalRule, BillApproval) extend the existing finance schema. Server actions in `lib/actions/ap.ts` (accounts payable — separate from `finance.ts` to keep files focused). API routes under `/api/v1/finance/`. Shell pages under `/(shell)/finance/`. Bill approval uses the same secure-token-link pattern as invoice Pay Now (no login required for approvers). OCR is deferred to Phase B.2 — this phase delivers manual bill entry, approval routing, PO workflow, and payment runs.

**Tech Stack:** Prisma (PostgreSQL), Next.js App Router, Vitest, nanoid, existing auth/permissions/email infrastructure from Phase A.

**Spec:** `docs/superpowers/specs/2026-03-20-financial-management-design.md` (items 6-8)
**Decisions:** `docs/superpowers/specs/2026-03-20-financial-management-implementation-decisions.md` (Decisions 2.1-2.4)

### Phase B Scope

**Phase B.1 (this plan):** Supplier model, Bill CRUD with approval workflow, PO workflow with PO-to-bill conversion, payment runs.
**Phase B.2 (follow-on):** OCR bill capture from email inbox, side-by-side correction UX, learn-from-corrections per supplier. OCR requires third-party integration (Dext-style) or an AI extraction pipeline — deferred to avoid blocking core AP.

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `apps/web/lib/actions/ap.ts` | Server actions: supplier CRUD, bill CRUD, approval workflow, PO CRUD, payment runs |
| `apps/web/lib/actions/ap.test.ts` | Unit tests for AP actions |
| `apps/web/lib/ap-validation.ts` | Zod schemas for supplier, bill, PO, payment run inputs |
| `apps/web/lib/ap-validation.test.ts` | Validation tests |
| `apps/web/app/(shell)/finance/suppliers/page.tsx` | Supplier list |
| `apps/web/app/(shell)/finance/suppliers/[id]/page.tsx` | Supplier detail |
| `apps/web/app/(shell)/finance/bills/page.tsx` | Bill list with status filters |
| `apps/web/app/(shell)/finance/bills/new/page.tsx` | Create bill page |
| `apps/web/app/(shell)/finance/bills/[id]/page.tsx` | Bill detail with approval status |
| `apps/web/app/(shell)/finance/purchase-orders/page.tsx` | PO list |
| `apps/web/app/(shell)/finance/purchase-orders/new/page.tsx` | Create PO page |
| `apps/web/app/(shell)/finance/purchase-orders/[id]/page.tsx` | PO detail |
| `apps/web/app/(shell)/finance/payment-runs/page.tsx` | Payment run list + create |
| `apps/web/app/(storefront)/s/approve/[token]/page.tsx` | Public bill approval page (no auth) |
| `apps/web/components/finance/CreateBillForm.tsx` | Client component for bill creation |
| `apps/web/components/finance/CreatePOForm.tsx` | Client component for PO creation |
| `apps/web/components/finance/PaymentRunBuilder.tsx` | Client component for payment run creation |
| `apps/web/app/api/v1/finance/suppliers/route.ts` | GET list + POST create |
| `apps/web/app/api/v1/finance/bills/route.ts` | GET list + POST create |
| `apps/web/app/api/v1/finance/bills/[id]/route.ts` | GET detail + PATCH update |
| `apps/web/app/api/v1/finance/purchase-orders/route.ts` | GET list + POST create |
| `apps/web/app/api/v1/finance/payment-runs/route.ts` | GET list + POST create |

### Modified Files
| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add Supplier, Bill, BillLineItem, PurchaseOrder, PurchaseOrderLineItem, ApprovalRule, BillApproval models |
| `apps/web/app/(shell)/finance/page.tsx` | Add payables widget and bills/suppliers/POs to quick actions |
| `apps/web/lib/actions/finance.ts` | Add `billId` support to PaymentAllocation for AP payment recording |

---

## Task 1: Supplier, Bill, and PO Prisma Models

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add Supplier model**

```prisma
// ─── Finance: Accounts Payable ─────────────────────────────────────

model Supplier {
  id              String              @id @default(cuid())
  supplierId      String              @unique
  name            String
  contactName     String?
  email           String?
  phone           String?
  address         Json?
  taxId           String?
  paymentTerms    String?             @default("Net 30")
  defaultCurrency String              @default("GBP")
  status          String              @default("active")
  bankDetails     Json?
  notes           String?
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt

  bills           Bill[]
  purchaseOrders  PurchaseOrder[]

  @@index([status])
}

model Bill {
  id              String              @id @default(cuid())
  billRef         String              @unique
  supplierId      String
  status          String              @default("draft")
  invoiceRef      String?
  issueDate       DateTime
  dueDate         DateTime
  currency        String              @default("GBP")
  subtotal        Decimal
  taxAmount       Decimal             @default(0)
  totalAmount     Decimal
  amountPaid      Decimal             @default(0)
  amountDue       Decimal
  purchaseOrderId String?
  approvalToken   String?             @unique
  notes           String?
  createdById     String?
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt

  supplier        Supplier            @relation(fields: [supplierId], references: [id])
  purchaseOrder   PurchaseOrder?      @relation(fields: [purchaseOrderId], references: [id])
  createdBy       User?               @relation("BillCreations", fields: [createdById], references: [id])
  lineItems       BillLineItem[]
  allocations     PaymentAllocation[]
  approvals       BillApproval[]

  @@index([supplierId])
  @@index([status])
  @@index([dueDate])
}

model BillLineItem {
  id              String              @id @default(cuid())
  billId          String
  description     String
  quantity        Decimal             @default(1)
  unitPrice       Decimal
  taxRate         Decimal             @default(0)
  taxAmount       Decimal             @default(0)
  lineTotal       Decimal
  accountCode     String?
  sortOrder       Int                 @default(0)
  createdAt       DateTime            @default(now())

  bill            Bill                @relation(fields: [billId], references: [id], onDelete: Cascade)

  @@index([billId])
}

model PurchaseOrder {
  id              String              @id @default(cuid())
  poNumber        String              @unique
  supplierId      String
  status          String              @default("draft")
  currency        String              @default("GBP")
  subtotal        Decimal
  taxAmount       Decimal             @default(0)
  totalAmount     Decimal
  deliveryDate    DateTime?
  terms           String?
  notes           String?
  sentAt          DateTime?
  createdById     String?
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt

  supplier        Supplier            @relation(fields: [supplierId], references: [id])
  createdBy       User?               @relation("PurchaseOrderCreations", fields: [createdById], references: [id])
  lineItems       PurchaseOrderLineItem[]
  bills           Bill[]

  @@index([supplierId])
  @@index([status])
}

model PurchaseOrderLineItem {
  id              String              @id @default(cuid())
  purchaseOrderId String
  description     String
  quantity        Decimal             @default(1)
  unitPrice       Decimal
  taxRate         Decimal             @default(0)
  taxAmount       Decimal             @default(0)
  lineTotal       Decimal
  sortOrder       Int                 @default(0)
  createdAt       DateTime            @default(now())

  purchaseOrder   PurchaseOrder       @relation(fields: [purchaseOrderId], references: [id], onDelete: Cascade)

  @@index([purchaseOrderId])
}

model ApprovalRule {
  id              String              @id @default(cuid())
  name            String
  minAmount       Decimal             @default(0)
  maxAmount       Decimal?
  approverId      String
  isActive        Boolean             @default(true)
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt

  approver        User                @relation("ApprovalRuleApprover", fields: [approverId], references: [id])
}

model BillApproval {
  id              String              @id @default(cuid())
  billId          String
  approverId      String
  status          String              @default("pending")
  token           String              @unique
  respondedAt     DateTime?
  comments        String?
  createdAt       DateTime            @default(now())

  bill            Bill                @relation(fields: [billId], references: [id])
  approver        User                @relation("BillApprovalResponses", fields: [approverId], references: [id])

  @@index([billId])
  @@index([token])
}
```

- [ ] **Step 2: Add reverse relation fields to existing models**

Add to `User` model:
```prisma
  billsCreated       Bill[]              @relation("BillCreations")
  posCreated         PurchaseOrder[]     @relation("PurchaseOrderCreations")
  approvalRules      ApprovalRule[]      @relation("ApprovalRuleApprover")
  billApprovals      BillApproval[]      @relation("BillApprovalResponses")
```

Add `billId` field to existing `PaymentAllocation` model:
```prisma
  billId          String?
  bill            Bill?               @relation(fields: [billId], references: [id])

  @@index([billId])
```

- [ ] **Step 3: Generate and run migration**

Run: `cd packages/db && npx prisma migrate dev --name add_ap_models`
If drift/reset prompt: consent granted for dev database.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(finance): add Supplier, Bill, PurchaseOrder, ApprovalRule, BillApproval models"
```

---

## Task 2: AP Validation Schemas

**Files:**
- Create: `apps/web/lib/ap-validation.ts`
- Create: `apps/web/lib/ap-validation.test.ts`

- [ ] **Step 1: Write tests for supplier, bill, PO, and payment run validation**

Test cases:
- createSupplierSchema: accepts valid input, rejects empty name
- createBillSchema: accepts valid input with line items, rejects empty line items, rejects missing supplierId, rejects missing dueDate
- createPOSchema: accepts valid input, rejects empty line items
- createPaymentRunSchema: accepts valid bill IDs array, rejects empty array

- [ ] **Step 2: Implement schemas**

```typescript
// Supplier
export const createSupplierSchema = z.object({
  name: z.string().min(1),
  contactName: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  taxId: z.string().optional(),
  paymentTerms: z.string().default("Net 30"),
  defaultCurrency: z.string().length(3).default("GBP"),
  notes: z.string().optional(),
});

// Bill
const billLineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  taxRate: z.number().min(0).max(100).default(0),
  accountCode: z.string().optional(),
});

export const createBillSchema = z.object({
  supplierId: z.string().min(1),
  invoiceRef: z.string().optional(),
  issueDate: z.string().min(1),
  dueDate: z.string().min(1),
  currency: z.string().length(3).default("GBP"),
  purchaseOrderId: z.string().optional(),
  notes: z.string().optional(),
  lineItems: z.array(billLineItemSchema).min(1),
});

// Purchase Order
const poLineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  taxRate: z.number().min(0).max(100).default(0),
});

export const createPOSchema = z.object({
  supplierId: z.string().min(1),
  currency: z.string().length(3).default("GBP"),
  deliveryDate: z.string().optional(),
  terms: z.string().optional(),
  notes: z.string().optional(),
  lineItems: z.array(poLineItemSchema).min(1),
});

// Payment Run
export const createPaymentRunSchema = z.object({
  billIds: z.array(z.string().min(1)).min(1),
  consolidatePerSupplier: z.boolean().default(true),
});

// Bill status update
export const BILL_STATUSES = ["draft", "awaiting_approval", "approved", "partially_paid", "paid", "void"] as const;
export const updateBillSchema = z.object({
  status: z.enum(BILL_STATUSES).optional(),
  notes: z.string().optional(),
});
```

- [ ] **Step 3: Run tests, verify pass**
- [ ] **Step 4: Commit**

```bash
git commit -m "feat(finance): add Zod validation schemas for suppliers, bills, POs, and payment runs"
```

---

## Task 3: Supplier CRUD Actions

**Files:**
- Create: `apps/web/lib/actions/ap.ts`
- Create: `apps/web/lib/actions/ap.test.ts`

- [ ] **Step 1: Write failing tests**

Test: createSupplier (auth check, creates with SUP-{nanoid} ref), getSupplier, listSuppliers.

- [ ] **Step 2: Implement**

```typescript
"use server";

import { nanoid } from "nanoid";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import type { CreateSupplierInput } from "@/lib/ap-validation";

async function requireManageFinance(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_finance")) {
    throw new Error("Unauthorized");
  }
  return user.id;
}

export async function createSupplier(input: CreateSupplierInput) {
  await requireManageFinance();
  const supplier = await prisma.supplier.create({
    data: {
      supplierId: `SUP-${nanoid(8)}`,
      name: input.name.trim(),
      contactName: input.contactName?.trim() ?? null,
      email: input.email?.trim() ?? null,
      phone: input.phone?.trim() ?? null,
      taxId: input.taxId?.trim() ?? null,
      paymentTerms: input.paymentTerms ?? "Net 30",
      defaultCurrency: input.defaultCurrency ?? "GBP",
      notes: input.notes?.trim() ?? null,
    },
  });
  revalidatePath("/finance/suppliers");
  return supplier;
}

export async function getSupplier(id: string) { /* findUnique with bills and POs */ }
export async function listSuppliers() { /* findMany ordered by name */ }
```

- [ ] **Step 3: Run tests, verify pass**
- [ ] **Step 4: Commit**

```bash
git commit -m "feat(finance): add supplier CRUD server actions"
```

---

## Task 4: Bill CRUD and Approval Actions

**Files:**
- Modify: `apps/web/lib/actions/ap.ts`
- Modify: `apps/web/lib/actions/ap.test.ts`

- [ ] **Step 1: Write failing tests**

Tests for:
- `createBill`: auth, total calculation, sequential ref (BILL-2026-XXXX)
- `submitBillForApproval`: finds matching ApprovalRule by amount, creates BillApproval with token, sends approval email
- `respondToBillApproval`: approves/rejects via token (no auth — public), updates bill status when all approvals complete
- `getBill`: returns bill with line items, supplier, approvals, allocations
- `listBills`: with status filter

- [ ] **Step 2: Implement**

Key functions:
```typescript
export async function createBill(input: CreateBillInput) {
  const userId = await requireManageFinance();
  const billRef = await generateBillRef(); // BILL-{year}-{seq}
  // Calculate totals same as invoice
  // If totalAmount < auto-approve threshold (from ApprovalRule where minAmount=0), auto-approve
  // Otherwise set status to "draft"
}

export async function submitBillForApproval(billId: string) {
  // Find matching approval rules by bill amount
  // Create BillApproval records with secure tokens
  // Send approval emails using composeApprovalEmail (similar to invoice email)
  // Set bill status to "awaiting_approval"
}

export async function respondToBillApproval(token: string, approved: boolean, comments?: string) {
  // No auth — public token-based
  // Update BillApproval status
  // If all approvals for this bill are approved, set bill status to "approved"
  // If any rejected, set bill status to "draft" (back to sender)
}

export async function getBillByApprovalToken(token: string) {
  // For public approval page
}
```

- [ ] **Step 3: Run tests, verify pass**
- [ ] **Step 4: Commit**

```bash
git commit -m "feat(finance): add bill CRUD with multi-step approval workflow"
```

---

## Task 5: Purchase Order Actions

**Files:**
- Modify: `apps/web/lib/actions/ap.ts`
- Modify: `apps/web/lib/actions/ap.test.ts`

- [ ] **Step 1: Write failing tests**

Tests for: createPO (auth, sequential PO-2026-XXXX ref, total calculation), sendPO (marks as sent), convertPOToBill (creates bill from PO line items, links via purchaseOrderId, idempotent).

- [ ] **Step 2: Implement**

```typescript
export async function createPurchaseOrder(input: CreatePOInput) {
  // Sequential ref: PO-{year}-{seq}
  // Calculate totals
}

export async function sendPurchaseOrder(poId: string) {
  // Update status to "sent", set sentAt
}

export async function convertPOToBill(poId: string) {
  // Idempotent: skip if bill already exists for this PO
  // Create bill from PO line items
  // Link bill.purchaseOrderId = poId
  // Catch pricing discrepancies between PO and bill
}
```

- [ ] **Step 3: Run tests, verify pass**
- [ ] **Step 4: Commit**

```bash
git commit -m "feat(finance): add purchase order CRUD with PO-to-bill conversion"
```

---

## Task 6: Payment Run Actions

**Files:**
- Modify: `apps/web/lib/actions/ap.ts`
- Modify: `apps/web/lib/actions/ap.test.ts`

- [ ] **Step 1: Write failing tests**

Tests for: createPaymentRun (selects approved bills, groups by supplier, creates outbound payments, allocates to bills, updates bill amountPaid/amountDue/status), consolidation per supplier.

- [ ] **Step 2: Implement**

```typescript
export async function createPaymentRun(input: { billIds: string[]; consolidatePerSupplier: boolean }) {
  const userId = await requireManageFinance();

  // Load all bills, verify they're all "approved" status
  const bills = await prisma.bill.findMany({
    where: { id: { in: input.billIds }, status: "approved" },
    include: { supplier: true },
  });

  if (bills.length !== input.billIds.length) {
    throw new Error("Some bills are not in approved status");
  }

  // Group by supplier if consolidating
  const groups = input.consolidatePerSupplier
    ? groupBy(bills, (b) => b.supplierId)
    : bills.map((b) => [b.supplierId, [b]] as const);

  // For each group: create one outbound Payment, create PaymentAllocations for each bill
  const payments = [];
  for (const [supplierId, groupBills] of groups) {
    const totalAmount = groupBills.reduce((sum, b) => sum + Number(b.amountDue), 0);
    const paymentRef = await generatePaymentRef(); // reuse from finance.ts

    const payment = await prisma.payment.create({
      data: {
        paymentRef,
        direction: "outbound",
        method: "bank_transfer",
        status: "pending", // pending until bank confirms
        amount: totalAmount,
        currency: groupBills[0].currency,
        counterpartyId: supplierId,
        counterpartyType: "supplier",
        createdById: userId,
      },
    });

    // Create allocations and update bills
    for (const bill of groupBills) {
      await prisma.paymentAllocation.create({
        data: { paymentId: payment.id, billId: bill.id, amount: Number(bill.amountDue) },
      });
      await prisma.bill.update({
        where: { id: bill.id },
        data: { amountPaid: Number(bill.totalAmount), amountDue: 0, status: "paid" },
      });
    }

    payments.push(payment);
  }

  revalidatePath("/finance");
  return { payments, billCount: bills.length };
}
```

- [ ] **Step 3: Run tests, verify pass**
- [ ] **Step 4: Commit**

```bash
git commit -m "feat(finance): add payment run with supplier consolidation"
```

---

## Task 7: AP API Routes

**Files:**
- Create: `apps/web/app/api/v1/finance/suppliers/route.ts`
- Create: `apps/web/app/api/v1/finance/bills/route.ts`
- Create: `apps/web/app/api/v1/finance/bills/[id]/route.ts`
- Create: `apps/web/app/api/v1/finance/purchase-orders/route.ts`
- Create: `apps/web/app/api/v1/finance/payment-runs/route.ts`

- [ ] **Step 1: Create all routes following existing finance API patterns**

All routes use `.js` extensions on `@/lib/api/` imports. All routes start with `authenticateRequest(request)`. POST routes validate with Zod `.safeParse()`. GET list routes use cursor pagination.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(finance): add supplier, bill, PO, and payment run API endpoints"
```

---

## Task 8: Supplier List and Detail Pages

**Files:**
- Create: `apps/web/app/(shell)/finance/suppliers/page.tsx`
- Create: `apps/web/app/(shell)/finance/suppliers/[id]/page.tsx`

- [ ] **Step 1: Supplier list** — name, status badge, contact, payment terms, bill count
- [ ] **Step 2: Supplier detail** — metadata, bills list, PO list, "New Bill" and "New PO" buttons
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(finance): add supplier list and detail pages"
```

---

## Task 9: Bill List, Detail, and Create Pages

**Files:**
- Create: `apps/web/app/(shell)/finance/bills/page.tsx`
- Create: `apps/web/app/(shell)/finance/bills/[id]/page.tsx`
- Create: `apps/web/app/(shell)/finance/bills/new/page.tsx`
- Create: `apps/web/components/finance/CreateBillForm.tsx`

- [ ] **Step 1: Bill list** — billRef, supplier, status (with approval badges), due date, amount. Status filters.
- [ ] **Step 2: Bill detail** — line items table, approval timeline (who approved/rejected/pending), payment allocations, "Submit for Approval" button
- [ ] **Step 3: Create bill form** — supplier selector, line items, due date, optional PO link (auto-populates from PO)
- [ ] **Step 4: Commit**

```bash
git commit -m "feat(finance): add bill list, detail, and create pages with approval tracking"
```

---

## Task 10: Purchase Order Pages

**Files:**
- Create: `apps/web/app/(shell)/finance/purchase-orders/page.tsx`
- Create: `apps/web/app/(shell)/finance/purchase-orders/[id]/page.tsx`
- Create: `apps/web/app/(shell)/finance/purchase-orders/new/page.tsx`
- Create: `apps/web/components/finance/CreatePOForm.tsx`

- [ ] **Step 1: PO list** — poNumber, supplier, status, total, delivery date
- [ ] **Step 2: PO detail** — line items, status, "Send to Supplier" button, "Convert to Bill" button
- [ ] **Step 3: Create PO form** — supplier selector, line items, delivery date. Under 2 minutes per Decision 2.3.
- [ ] **Step 4: Commit**

```bash
git commit -m "feat(finance): add purchase order list, detail, and create pages"
```

---

## Task 11: Public Bill Approval Page

**Files:**
- Create: `apps/web/app/(storefront)/s/approve/[token]/page.tsx`

- [ ] **Step 1: Create public approval page**

Same pattern as Pay Now page — no auth, under `/s/` for storefront middleware. Shows:
- Bill summary (supplier, amount, due date, line items)
- Original document (if uploaded — future)
- Large "Approve" (green) and "Reject" (red) buttons
- Optional comments field
- Calls `respondToBillApproval(token, approved, comments)` server action

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(finance): add public bill approval page with token-based access"
```

---

## Task 12: Payment Run Page

**Files:**
- Create: `apps/web/app/(shell)/finance/payment-runs/page.tsx`
- Create: `apps/web/components/finance/PaymentRunBuilder.tsx`

- [ ] **Step 1: Payment run page** — list of past payment runs with date, bill count, total amount, status
- [ ] **Step 2: Payment run builder** (client component) — shows approved bills ready for payment, checkbox selection, "Consolidate per supplier" toggle, total amount preview, "Execute Payment Run" button with confirmation
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(finance): add payment run page with builder UI"
```

---

## Task 13: Update Finance Dashboard

**Files:**
- Modify: `apps/web/app/(shell)/finance/page.tsx`

- [ ] **Step 1: Add payables widget and AP links**

Add to the dashboard:
- "Money You Owe" widget — aggregate amountDue from bills with status in ["approved", "partially_paid"]
- "Awaiting Approval" widget — count of bills with status "awaiting_approval"
- Quick actions: add links to Suppliers, Bills, Purchase Orders, Payment Runs

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(finance): add payables widgets and AP links to finance dashboard"
```

---

## Task 14: Full Test Suite Verification

- [ ] **Step 1: Run all finance + AP tests**
- [ ] **Step 2: Verify no regressions in full test suite**
- [ ] **Step 3: Fix any issues**

---

## Summary

| Task | What It Delivers |
|------|-----------------|
| 1 | Prisma models: Supplier, Bill, PO, ApprovalRule, BillApproval |
| 2 | Zod validation schemas |
| 3 | Supplier CRUD actions |
| 4 | Bill CRUD with multi-step approval workflow |
| 5 | Purchase order CRUD with PO-to-bill conversion |
| 6 | Payment run with supplier consolidation |
| 7 | REST API endpoints for all AP entities |
| 8 | Supplier list and detail pages |
| 9 | Bill list, detail, create with approval tracking |
| 10 | Purchase order list, detail, create pages |
| 11 | Public bill approval page (token-based, no login) |
| 12 | Payment run page with builder UI |
| 13 | Finance dashboard updated with payables |
| 14 | Full test suite verification |
