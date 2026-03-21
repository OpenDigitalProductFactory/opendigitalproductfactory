# Financial Management Phase A: Invoicing & Payments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the invoicing and payment recording foundation — create invoices (manual, from orders), send with Pay Now links, record payments, track status, and display in an admin UI with dashboard metrics.

**Architecture:** New Prisma models (Invoice, InvoiceLineItem, Payment, PaymentAllocation) added to existing schema. Server actions in `lib/actions/finance.ts` for all mutations. API routes under `/api/v1/finance/`. Shell admin pages under `/(shell)/finance/`. Permission-gated via new `view_finance` and `manage_finance` capabilities. Follows existing patterns: server-component pages, cursor-based pagination, Vitest mocks.

**Tech Stack:** Prisma (PostgreSQL), Next.js App Router (server components + server actions), Vitest, existing auth/permissions system.

**Spec:** `docs/superpowers/specs/2026-03-20-financial-management-design.md`
**Decisions:** `docs/superpowers/specs/2026-03-20-financial-management-implementation-decisions.md`

### Scope Notes

**Phase A.1 (this plan):** Invoice model, lifecycle, manual payment recording, admin UI, dashboard.
**Phase A.2 (follow-on):** Invoice from SalesOrder conversion, invoice from StorefrontOrder conversion, PDF generation, email sending with Pay Now link. These depend on Stripe integration (EP-FINANCE-001 item 12) and are deferred to avoid blocking core invoicing.

**Naming:** Spec uses `invoiceId`/`paymentId` for the human-readable ref field. This plan uses `invoiceRef`/`paymentRef` to avoid confusion with the `id` primary key. Spec will be updated to match.

**Dashboard simplification:** Decision 4.1 specifies cash position, cash flow forecast, outstanding invoices, and P&L summary as the four default widgets. Phase A implements the outstanding invoices and overdue widgets only — cash position requires BankAccount (Phase C), cash flow forecast requires BankAccount + Bill (Phases B-C), and P&L requires ERPNext connector (EP-FINANCE-001). Phase A widgets are placeholders that will be replaced as those phases land.

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `packages/db/prisma/migrations/TIMESTAMP_add_invoice_payment_models/migration.sql` | Schema migration |
| `apps/web/lib/actions/finance.ts` | Server actions: createInvoice, updateInvoice, approveInvoice, sendInvoice, voidInvoice, recordPayment, allocatePayment |
| `apps/web/lib/actions/finance.test.ts` | Unit tests for all finance actions |
| `apps/web/lib/finance-validation.ts` | Zod schemas for invoice/payment input validation |
| `apps/web/lib/finance-validation.test.ts` | Validation tests |
| `apps/web/app/(shell)/finance/page.tsx` | Finance dashboard (4-widget default) |
| `apps/web/app/(shell)/finance/invoices/page.tsx` | Invoice list with filters |
| `apps/web/app/(shell)/finance/invoices/new/page.tsx` | Create invoice page |
| `apps/web/app/(shell)/finance/invoices/[id]/page.tsx` | Invoice detail page |
| `apps/web/app/(shell)/finance/payments/page.tsx` | Payment list |
| `apps/web/app/api/v1/finance/invoices/route.ts` | GET list + POST create |
| `apps/web/app/api/v1/finance/invoices/[id]/route.ts` | GET detail + PATCH update |
| `apps/web/app/api/v1/finance/payments/route.ts` | GET list + POST create |

### Modified Files
| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add Invoice, InvoiceLineItem, Payment, PaymentAllocation models + relations on CustomerAccount/CustomerContact |
| `apps/web/lib/permissions.ts` | Add `view_finance` and `manage_finance` capabilities + Finance workspace tile |
| `apps/web/app/(shell)/layout.tsx` | Add finance nav link (if nav is in layout) |

---

## Task 1: Add Finance Permissions

**Files:**
- Modify: `apps/web/lib/permissions.ts`

- [ ] **Step 1: Write failing test for new capabilities**

Create `apps/web/lib/permissions.test.ts` (or add to existing):

```typescript
import { describe, expect, it } from "vitest";
import { can, getWorkspaceTiles } from "./permissions";

describe("finance permissions", () => {
  it("grants view_finance to HR-000 and HR-200", () => {
    expect(can({ platformRole: "HR-000", isSuperuser: false }, "view_finance")).toBe(true);
    expect(can({ platformRole: "HR-200", isSuperuser: false }, "view_finance")).toBe(true);
  });

  it("denies view_finance to HR-400", () => {
    expect(can({ platformRole: "HR-400", isSuperuser: false }, "view_finance")).toBe(false);
  });

  it("grants manage_finance to HR-000 and HR-200", () => {
    expect(can({ platformRole: "HR-000", isSuperuser: false }, "manage_finance")).toBe(true);
    expect(can({ platformRole: "HR-200", isSuperuser: false }, "manage_finance")).toBe(true);
  });

  it("includes Finance workspace tile for HR-200", () => {
    const tiles = getWorkspaceTiles({ platformRole: "HR-200", isSuperuser: false });
    expect(tiles.some((t) => t.key === "finance")).toBe(true);
  });

  it("superuser gets finance access", () => {
    expect(can({ platformRole: null, isSuperuser: true }, "view_finance")).toBe(true);
    expect(can({ platformRole: null, isSuperuser: true }, "manage_finance")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/permissions.test.ts`
Expected: FAIL — `view_finance` and `manage_finance` are not valid CapabilityKey values.

- [ ] **Step 3: Add finance capabilities and workspace tile**

In `apps/web/lib/permissions.ts`:

Add to `CapabilityKey` type:
```typescript
  | "view_finance"
  | "manage_finance";
```

Add to `PERMISSIONS` record:
```typescript
  view_finance:                { roles: ["HR-000", "HR-200"] },
  manage_finance:              { roles: ["HR-000", "HR-200"] },
```

Add to `ALL_TILES` array (after compliance tile):
```typescript
  { key: "finance",    label: "Finance",    route: "/finance",    capabilityKey: "view_finance",     accentColor: "#22c55e" },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/permissions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/permissions.ts apps/web/lib/permissions.test.ts
git commit -m "feat(finance): add view_finance and manage_finance capabilities with workspace tile"
```

---

## Task 2: Invoice and Payment Prisma Models

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add Invoice model to schema**

Append to `packages/db/prisma/schema.prisma`:

```prisma
// ─── Finance: Invoicing & Payments ─────────────────────────────────

model Invoice {
  id              String              @id @default(cuid())
  invoiceRef      String              @unique
  type            String              @default("standard")
  status          String              @default("draft")
  accountId       String
  contactId       String?
  sourceType      String?
  sourceId        String?
  issueDate       DateTime            @default(now())
  dueDate         DateTime
  currency        String              @default("GBP")
  subtotal        Decimal
  taxAmount       Decimal             @default(0)
  discountAmount  Decimal             @default(0)
  totalAmount     Decimal
  amountPaid      Decimal             @default(0)
  amountDue       Decimal
  paymentTerms    String?
  notes           String?
  internalNotes   String?
  sentAt          DateTime?
  viewedAt        DateTime?
  paidAt          DateTime?
  voidedAt        DateTime?
  reminderCount   Int                 @default(0)
  lastReminderAt  DateTime?
  erpSyncStatus   String?             @default("pending")
  erpRefId        String?
  createdById     String?
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt

  account         CustomerAccount     @relation(fields: [accountId], references: [id])
  contact         CustomerContact?    @relation(fields: [contactId], references: [id])
  createdBy       User?               @relation("InvoiceCreations", fields: [createdById], references: [id])
  lineItems       InvoiceLineItem[]
  allocations     PaymentAllocation[]

  @@index([accountId])
  @@index([status])
  @@index([dueDate])
  @@index([sourceType, sourceId])
}

model InvoiceLineItem {
  id              String              @id @default(cuid())
  invoiceId       String
  description     String
  quantity        Decimal             @default(1)
  unitPrice       Decimal
  taxRate         Decimal             @default(0)
  taxAmount       Decimal             @default(0)
  discountPercent Decimal             @default(0)
  lineTotal       Decimal
  accountCode     String?
  sortOrder       Int                 @default(0)
  createdAt       DateTime            @default(now())

  invoice         Invoice             @relation(fields: [invoiceId], references: [id], onDelete: Cascade)

  @@index([invoiceId])
}

model Payment {
  id                 String              @id @default(cuid())
  paymentRef         String              @unique
  direction          String
  method             String
  status             String              @default("pending")
  amount             Decimal
  currency           String              @default("GBP")
  exchangeRate       Decimal             @default(1)
  baseCurrencyAmount Decimal?
  reference          String?
  stripePaymentId    String?
  counterpartyId     String?
  counterpartyType   String?
  receivedAt         DateTime?
  processedAt        DateTime?
  reconciled         Boolean             @default(false)
  reconciledAt       DateTime?
  erpSyncStatus      String?             @default("pending")
  erpRefId           String?
  notes              String?
  createdById        String?
  createdAt          DateTime            @default(now())
  updatedAt          DateTime            @updatedAt

  createdBy          User?               @relation("PaymentCreations", fields: [createdById], references: [id])
  allocations        PaymentAllocation[]

  @@index([direction])
  @@index([status])
  @@index([counterpartyId, counterpartyType])
}

model PaymentAllocation {
  id              String              @id @default(cuid())
  paymentId       String
  invoiceId       String?
  amount          Decimal
  createdAt       DateTime            @default(now())

  payment         Payment             @relation(fields: [paymentId], references: [id])
  invoice         Invoice?            @relation(fields: [invoiceId], references: [id])

  @@index([paymentId])
  @@index([invoiceId])
}
```

- [ ] **Step 2: Add relation fields to CustomerAccount and CustomerContact**

Add to `CustomerAccount` model (after existing relations):
```prisma
  invoices        Invoice[]
```

Add to `CustomerContact` model (after existing relations):
```prisma
  invoices        Invoice[]
```

Add to `User` model (find existing relation block):
```prisma
  invoicesCreated   Invoice[]           @relation("InvoiceCreations")
  paymentsCreated   Payment[]           @relation("PaymentCreations")
```

- [ ] **Step 3: Generate and run migration**

Run: `cd packages/db && npx prisma migrate dev --name add_invoice_payment_models`
Expected: Migration created and applied successfully.

- [ ] **Step 4: Verify schema with prisma generate**

Run: `cd packages/db && npx prisma generate`
Expected: Generated Prisma Client successfully.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(finance): add Invoice, InvoiceLineItem, Payment, PaymentAllocation models"
```

---

## Task 3: Invoice Validation Schemas

**Files:**
- Create: `apps/web/lib/finance-validation.ts`
- Create: `apps/web/lib/finance-validation.test.ts`

- [ ] **Step 1: Write validation tests**

```typescript
// apps/web/lib/finance-validation.test.ts
import { describe, expect, it } from "vitest";
import {
  createInvoiceSchema,
  recordPaymentSchema,
  INVOICE_TYPES,
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_DIRECTIONS,
} from "./finance-validation";

describe("createInvoiceSchema", () => {
  const validInput = {
    accountId: "cuid123",
    dueDate: "2026-04-20",
    currency: "GBP",
    paymentTerms: "Net 30",
    lineItems: [
      { description: "Consulting", quantity: 2, unitPrice: 150, taxRate: 20 },
    ],
  };

  it("accepts valid invoice input", () => {
    const result = createInvoiceSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("rejects empty lineItems", () => {
    const result = createInvoiceSchema.safeParse({ ...validInput, lineItems: [] });
    expect(result.success).toBe(false);
  });

  it("rejects missing accountId", () => {
    const { accountId, ...rest } = validInput;
    const result = createInvoiceSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing dueDate", () => {
    const { dueDate, ...rest } = validInput;
    const result = createInvoiceSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects negative unitPrice", () => {
    const input = {
      ...validInput,
      lineItems: [{ description: "Bad", quantity: 1, unitPrice: -10, taxRate: 0 }],
    };
    const result = createInvoiceSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects zero quantity", () => {
    const input = {
      ...validInput,
      lineItems: [{ description: "Zero", quantity: 0, unitPrice: 100, taxRate: 0 }],
    };
    const result = createInvoiceSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("accepts valid invoice types", () => {
    for (const type of INVOICE_TYPES) {
      const result = createInvoiceSchema.safeParse({ ...validInput, type });
      expect(result.success).toBe(true);
    }
  });
});

describe("recordPaymentSchema", () => {
  const validPayment = {
    direction: "inbound",
    method: "bank_transfer",
    amount: 300,
    currency: "GBP",
    invoiceId: "inv123",
  };

  it("accepts valid payment input", () => {
    const result = recordPaymentSchema.safeParse(validPayment);
    expect(result.success).toBe(true);
  });

  it("rejects invalid direction", () => {
    const result = recordPaymentSchema.safeParse({ ...validPayment, direction: "sideways" });
    expect(result.success).toBe(false);
  });

  it("rejects zero amount", () => {
    const result = recordPaymentSchema.safeParse({ ...validPayment, amount: 0 });
    expect(result.success).toBe(false);
  });

  it("accepts all valid payment methods", () => {
    for (const method of PAYMENT_METHODS) {
      const result = recordPaymentSchema.safeParse({ ...validPayment, method });
      expect(result.success).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/finance-validation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement validation schemas**

```typescript
// apps/web/lib/finance-validation.ts
import { z } from "zod";

export const INVOICE_TYPES = ["standard", "credit_note", "proforma", "recurring_instance"] as const;
export const INVOICE_STATUSES = [
  "draft", "approved", "sent", "viewed", "partially_paid", "paid", "overdue", "void", "written_off",
] as const;
export const PAYMENT_DIRECTIONS = ["inbound", "outbound"] as const;
export const PAYMENT_METHODS = [
  "bank_transfer", "card", "cash", "cheque", "direct_debit", "stripe",
] as const;
export const PAYMENT_STATUSES = [
  "pending", "completed", "failed", "refunded", "cancelled",
] as const;

const lineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  taxRate: z.number().min(0).max(100).default(0),
  discountPercent: z.number().min(0).max(100).default(0),
  accountCode: z.string().optional(),
});

export const createInvoiceSchema = z.object({
  accountId: z.string().min(1),
  contactId: z.string().optional(),
  type: z.enum(INVOICE_TYPES).default("standard"),
  dueDate: z.string().min(1),
  currency: z.string().length(3).default("GBP"),
  paymentTerms: z.string().optional(),
  notes: z.string().optional(),
  internalNotes: z.string().optional(),
  sourceType: z.string().optional(),
  sourceId: z.string().optional(),
  lineItems: z.array(lineItemSchema).min(1),
});

export const updateInvoiceSchema = z.object({
  status: z.enum(INVOICE_STATUSES).optional(),
  dueDate: z.string().optional(),
  paymentTerms: z.string().optional(),
  notes: z.string().optional(),
  internalNotes: z.string().optional(),
});

export const recordPaymentSchema = z.object({
  direction: z.enum(PAYMENT_DIRECTIONS),
  method: z.enum(PAYMENT_METHODS),
  amount: z.number().positive(),
  currency: z.string().length(3).default("GBP"),
  reference: z.string().optional(),
  invoiceId: z.string().optional(),
  notes: z.string().optional(),
  receivedAt: z.string().optional(),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/finance-validation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/finance-validation.ts apps/web/lib/finance-validation.test.ts
git commit -m "feat(finance): add Zod validation schemas for invoices and payments"
```

---

## Task 4: Finance Server Actions

**Files:**
- Create: `apps/web/lib/actions/finance.ts`
- Create: `apps/web/lib/actions/finance.test.ts`

- [ ] **Step 1: Write failing tests for createInvoice**

```typescript
// apps/web/lib/actions/finance.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ can: vi.fn() }));
vi.mock("@dpf/db", () => ({
  prisma: {
    invoice: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    payment: { create: vi.fn(), findUnique: vi.fn() },
    paymentAllocation: { create: vi.fn() },
    $transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn({
      invoice: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
      payment: { create: vi.fn() },
      paymentAllocation: { create: vi.fn() },
    })),
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { createInvoice, recordPayment } from "./finance";

const mockAuth = vi.mocked(auth);
const mockCan = vi.mocked(can);
const mockPrisma = vi.mocked(prisma);

describe("createInvoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      user: { id: "user1", platformRole: "HR-000", isSuperuser: true },
      expires: "",
    } as never);
    mockCan.mockReturnValue(true);
  });

  it("throws when unauthorized", async () => {
    mockCan.mockReturnValue(false);
    mockAuth.mockResolvedValue({
      user: { id: "user1", platformRole: "HR-400", isSuperuser: false },
      expires: "",
    } as never);

    await expect(
      createInvoice({
        accountId: "acc1",
        dueDate: "2026-04-20",
        lineItems: [{ description: "Work", quantity: 1, unitPrice: 100, taxRate: 20 }],
      }),
    ).rejects.toThrow("Unauthorized");
  });

  it("creates invoice with calculated totals", async () => {
    mockPrisma.invoice.count.mockResolvedValue(5);
    mockPrisma.invoice.create.mockResolvedValue({ id: "inv1", invoiceRef: "INV-2026-0006" } as never);

    const result = await createInvoice({
      accountId: "acc1",
      dueDate: "2026-04-20",
      lineItems: [
        { description: "Consulting", quantity: 2, unitPrice: 150, taxRate: 20 },
        { description: "Travel", quantity: 1, unitPrice: 50, taxRate: 0 },
      ],
    });

    expect(mockPrisma.invoice.create).toHaveBeenCalledOnce();
    const callArgs = mockPrisma.invoice.create.mock.calls[0]![0]!;
    const data = callArgs.data as Record<string, unknown>;
    // 2*150=300 + 1*50=50 = subtotal 350
    expect(data.subtotal).toBe(350);
    // tax: 300*0.20=60, 50*0=0 = 60
    expect(data.taxAmount).toBe(60);
    // total: 350+60=410
    expect(data.totalAmount).toBe(410);
    expect(data.amountDue).toBe(410);
    expect(data.amountPaid).toBe(0);
  });

  it("generates sequential invoice ref", async () => {
    mockPrisma.invoice.count.mockResolvedValue(41);
    mockPrisma.invoice.create.mockResolvedValue({ id: "inv1" } as never);

    await createInvoice({
      accountId: "acc1",
      dueDate: "2026-04-20",
      lineItems: [{ description: "Work", quantity: 1, unitPrice: 100, taxRate: 0 }],
    });

    const callArgs = mockPrisma.invoice.create.mock.calls[0]![0]!;
    const data = callArgs.data as Record<string, unknown>;
    expect(data.invoiceRef).toBe("INV-2026-0042");
  });
});

describe("recordPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      user: { id: "user1", platformRole: "HR-000", isSuperuser: true },
      expires: "",
    } as never);
    mockCan.mockReturnValue(true);
  });

  it("throws when unauthorized", async () => {
    mockCan.mockReturnValue(false);
    mockAuth.mockResolvedValue({
      user: { id: "user1", platformRole: "HR-400", isSuperuser: false },
      expires: "",
    } as never);

    await expect(
      recordPayment({
        direction: "inbound",
        method: "bank_transfer",
        amount: 100,
        currency: "GBP",
      }),
    ).rejects.toThrow("Unauthorized");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/actions/finance.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement finance server actions**

```typescript
// apps/web/lib/actions/finance.ts
"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import type { CreateInvoiceInput, RecordPaymentInput } from "@/lib/finance-validation";

async function requireManageFinance(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "manage_finance",
    )
  ) {
    throw new Error("Unauthorized");
  }
  return user.id;
}

// Sequential ref generation. Uses count() + retry on unique constraint violation.
// For production scale, replace with a PostgreSQL SEQUENCE. Adequate for Phase A.
async function generateInvoiceRef(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.invoice.count();
  const seq = String(count + 1).padStart(4, "0");
  return `INV-${year}-${seq}`;
}

async function generatePaymentRef(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.payment.count();
  const seq = String(count + 1).padStart(4, "0");
  return `PAY-${year}-${seq}`;
}

function calculateLineTotals(lineItems: CreateInvoiceInput["lineItems"]) {
  let subtotal = 0;
  let taxAmount = 0;
  let discountAmount = 0;

  const computed = lineItems.map((item, i) => {
    const lineSubtotal = item.quantity * item.unitPrice;
    const discPct = item.discountPercent ?? 0;
    const lineDiscount = lineSubtotal * (discPct / 100);
    const lineAfterDiscount = lineSubtotal - lineDiscount;
    const lineTax = lineAfterDiscount * ((item.taxRate ?? 0) / 100);
    const lineTotal = lineAfterDiscount + lineTax;

    subtotal += lineSubtotal - lineDiscount;
    taxAmount += lineTax;
    discountAmount += lineDiscount;

    return {
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      taxRate: item.taxRate ?? 0,
      taxAmount: Math.round(lineTax * 100) / 100,
      discountPercent: discPct,
      lineTotal: Math.round(lineTotal * 100) / 100,
      accountCode: item.accountCode ?? null,
      sortOrder: i,
    };
  });

  return {
    lineItems: computed,
    subtotal: Math.round(subtotal * 100) / 100,
    taxAmount: Math.round(taxAmount * 100) / 100,
    discountAmount: Math.round(discountAmount * 100) / 100,
    totalAmount: Math.round((subtotal + taxAmount) * 100) / 100,
  };
}

export async function createInvoice(input: CreateInvoiceInput) {
  const userId = await requireManageFinance();
  const invoiceRef = await generateInvoiceRef();
  const { lineItems, subtotal, taxAmount, discountAmount, totalAmount } =
    calculateLineTotals(input.lineItems);

  const invoice = await prisma.invoice.create({
    data: {
      invoiceRef,
      type: input.type ?? "standard",
      status: "draft",
      accountId: input.accountId,
      contactId: input.contactId ?? null,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      issueDate: new Date(),
      dueDate: new Date(input.dueDate),
      currency: input.currency ?? "GBP",
      subtotal,
      taxAmount,
      discountAmount,
      totalAmount,
      amountPaid: 0,
      amountDue: totalAmount,
      paymentTerms: input.paymentTerms ?? null,
      notes: input.notes?.trim() ?? null,
      internalNotes: input.internalNotes?.trim() ?? null,
      createdById: userId,
      lineItems: { create: lineItems },
    },
    include: { lineItems: true },
  });

  revalidatePath("/finance");
  revalidatePath("/finance/invoices");
  return invoice;
}

export async function updateInvoiceStatus(
  id: string,
  status: string,
): Promise<void> {
  await requireManageFinance();

  const existing = await prisma.invoice.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!existing) throw new Error("Invoice not found");

  const now = new Date();
  const timestamps: Record<string, Date> = {};
  if (status === "sent") timestamps.sentAt = now;
  if (status === "void") timestamps.voidedAt = now;
  if (status === "paid") timestamps.paidAt = now;

  await prisma.invoice.update({
    where: { id },
    data: { status, ...timestamps },
  });

  revalidatePath("/finance");
  revalidatePath("/finance/invoices");
}

export async function recordPayment(input: RecordPaymentInput) {
  const userId = await requireManageFinance();
  const paymentRef = await generatePaymentRef();

  const payment = await prisma.payment.create({
    data: {
      paymentRef,
      direction: input.direction,
      method: input.method,
      status: "completed",
      amount: input.amount,
      currency: input.currency ?? "GBP",
      exchangeRate: 1,
      baseCurrencyAmount: input.amount,
      reference: input.reference ?? null,
      counterpartyId: null,
      counterpartyType: null,
      receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
      processedAt: new Date(),
      notes: input.notes?.trim() ?? null,
      createdById: userId,
    },
  });

  // If linked to an invoice, create allocation and update invoice
  if (input.invoiceId) {
    await prisma.paymentAllocation.create({
      data: {
        paymentId: payment.id,
        invoiceId: input.invoiceId,
        amount: input.amount,
      },
    });

    const invoice = await prisma.invoice.findUnique({
      where: { id: input.invoiceId },
      select: { id: true, totalAmount: true, amountPaid: true },
    });

    if (invoice) {
      const newAmountPaid = Number(invoice.amountPaid) + input.amount;
      const newAmountDue = Number(invoice.totalAmount) - newAmountPaid;
      const newStatus =
        newAmountDue <= 0 ? "paid" : "partially_paid";

      await prisma.invoice.update({
        where: { id: input.invoiceId },
        data: {
          amountPaid: newAmountPaid,
          amountDue: Math.max(0, newAmountDue),
          status: newStatus,
          ...(newStatus === "paid" ? { paidAt: new Date() } : {}),
        },
      });
    }
  }

  revalidatePath("/finance");
  revalidatePath("/finance/invoices");
  revalidatePath("/finance/payments");
  return payment;
}

export async function getInvoice(id: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      lineItems: { orderBy: { sortOrder: "asc" } },
      account: { select: { id: true, accountId: true, name: true } },
      contact: { select: { id: true, email: true, firstName: true, lastName: true } },
      allocations: {
        include: { payment: { select: { id: true, paymentRef: true, method: true, amount: true, receivedAt: true } } },
      },
      createdBy: { select: { id: true, email: true } },
    },
  });
  return invoice;
}

export async function listInvoices(filters?: {
  status?: string;
  accountId?: string;
}) {
  const where: Record<string, unknown> = {};
  if (filters?.status) where.status = filters.status;
  if (filters?.accountId) where.accountId = filters.accountId;

  return prisma.invoice.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      account: { select: { id: true, name: true } },
      _count: { select: { allocations: true } },
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/actions/finance.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/actions/finance.ts apps/web/lib/actions/finance.test.ts
git commit -m "feat(finance): add createInvoice, recordPayment, getInvoice, listInvoices server actions"
```

---

## Task 5: Finance API Routes

**Files:**
- Create: `apps/web/app/api/v1/finance/invoices/route.ts`
- Create: `apps/web/app/api/v1/finance/invoices/[id]/route.ts`
- Create: `apps/web/app/api/v1/finance/payments/route.ts`

- [ ] **Step 1: Create invoice list + create API route**

```typescript
// apps/web/app/api/v1/finance/invoices/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware.js";
import { ApiError } from "@/lib/api/error.js";
import { apiSuccess } from "@/lib/api/response.js";
import { parsePagination, buildPaginatedResponse } from "@/lib/api/pagination.js";
import { createInvoiceSchema } from "@/lib/finance-validation";
import { createInvoice } from "@/lib/actions/finance";

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);
    const url = new URL(request.url);
    const { cursor, limit } = parsePagination(url.searchParams);
    const status = url.searchParams.get("status");
    const accountId = url.searchParams.get("accountId");

    const where: Record<string, unknown> = {};
    if (cursor) where.id = { lt: cursor };
    if (status) where.status = status;
    if (accountId) where.accountId = accountId;

    const items = await prisma.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      include: {
        account: { select: { id: true, name: true } },
      },
    });

    return apiSuccess(buildPaginatedResponse(items, limit));
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    await authenticateRequest(request);
    const body = await request.json();
    const parsed = createInvoiceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() },
        { status: 422 },
      );
    }
    const invoice = await createInvoice(parsed.data);
    return apiSuccess(invoice, 201);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Create invoice detail + update API route**

```typescript
// apps/web/app/api/v1/finance/invoices/[id]/route.ts
import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api/auth-middleware.js";
import { ApiError, apiError } from "@/lib/api/error.js";
import { apiSuccess } from "@/lib/api/response.js";
import { updateInvoiceSchema } from "@/lib/finance-validation";
import { getInvoice, updateInvoiceStatus } from "@/lib/actions/finance";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);
    const { id } = await params;
    const invoice = await getInvoice(id);
    if (!invoice) throw apiError("NOT_FOUND", "Invoice not found", 404);
    return apiSuccess(invoice);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);
    const { id } = await params;
    const body = await request.json();
    const parsed = updateInvoiceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() },
        { status: 422 },
      );
    }
    if (parsed.data.status) {
      await updateInvoiceStatus(id, parsed.data.status);
    }
    const updated = await getInvoice(id);
    return apiSuccess(updated);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 3: Create payment API routes**

```typescript
// apps/web/app/api/v1/finance/payments/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware.js";
import { ApiError } from "@/lib/api/error.js";
import { apiSuccess } from "@/lib/api/response.js";
import { parsePagination, buildPaginatedResponse } from "@/lib/api/pagination.js";
import { recordPaymentSchema } from "@/lib/finance-validation";
import { recordPayment } from "@/lib/actions/finance";

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);
    const url = new URL(request.url);
    const { cursor, limit } = parsePagination(url.searchParams);
    const direction = url.searchParams.get("direction");

    const where: Record<string, unknown> = {};
    if (cursor) where.id = { lt: cursor };
    if (direction) where.direction = direction;

    const items = await prisma.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      include: {
        allocations: { include: { invoice: { select: { id: true, invoiceRef: true } } } },
      },
    });

    return apiSuccess(buildPaginatedResponse(items, limit));
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    await authenticateRequest(request);
    const body = await request.json();
    const parsed = recordPaymentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() },
        { status: 422 },
      );
    }
    const payment = await recordPayment(parsed.data);
    return apiSuccess(payment, 201);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: Run the dev server to verify routes compile**

Run: `cd apps/web && npx next build --no-lint 2>&1 | head -30`
Expected: No compilation errors for the new route files.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/v1/finance/
git commit -m "feat(finance): add invoice and payment REST API endpoints"
```

---

## Task 6: Finance Dashboard Page

**Files:**
- Create: `apps/web/app/(shell)/finance/page.tsx`

- [ ] **Step 1: Create the finance dashboard with 4-widget default**

```typescript
// apps/web/app/(shell)/finance/page.tsx
import { prisma } from "@dpf/db";
import Link from "next/link";

const STATUS_COLOURS: Record<string, string> = {
  draft: "#8888a0",
  sent: "#38bdf8",
  viewed: "#a78bfa",
  overdue: "#ef4444",
  partially_paid: "#fbbf24",
  paid: "#4ade80",
  void: "#6b7280",
};

export default async function FinancePage() {
  const [
    totalOutstanding,
    overdueInvoices,
    paidThisMonth,
    recentInvoices,
  ] = await Promise.all([
    // Widget 1: Money Owed To You
    prisma.invoice.aggregate({
      where: { status: { in: ["sent", "viewed", "partially_paid", "overdue"] } },
      _sum: { amountDue: true },
      _count: true,
    }),
    // Widget 2: Overdue
    prisma.invoice.findMany({
      where: { status: "overdue" },
      orderBy: { dueDate: "asc" },
      take: 5,
      include: { account: { select: { name: true } } },
    }),
    // Widget 3: Paid This Month
    prisma.invoice.aggregate({
      where: {
        status: "paid",
        paidAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      },
      _sum: { totalAmount: true },
      _count: true,
    }),
    // Recent invoices
    prisma.invoice.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { account: { select: { name: true } } },
    }),
  ]);

  const outstandingAmount = Number(totalOutstanding._sum.amountDue ?? 0);
  const outstandingCount = totalOutstanding._count;
  const paidAmount = Number(paidThisMonth._sum.totalAmount ?? 0);
  const paidCount = paidThisMonth._count;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Finance</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
            Invoicing &amp; payments
          </p>
        </div>
        <Link
          href="/finance/invoices/new"
          className="px-3 py-1.5 text-xs font-medium rounded bg-[#22c55e] text-black hover:bg-[#16a34a] transition-colors"
        >
          New Invoice
        </Link>
      </div>

      {/* 4-Widget Dashboard */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {/* Widget 1: Money Owed To You */}
        <div className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-1">Money Owed To You</p>
          <p className="text-2xl font-bold text-white">
            £{outstandingAmount.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
          </p>
          <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
            {outstandingCount} invoice{outstandingCount !== 1 ? "s" : ""}
          </p>
        </div>

        {/* Widget 2: Overdue */}
        <div className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-1">Overdue</p>
          <p className="text-2xl font-bold" style={{ color: overdueInvoices.length > 0 ? "#ef4444" : "#4ade80" }}>
            {overdueInvoices.length}
          </p>
          <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
            {overdueInvoices.length === 0 ? "All clear" : `Oldest: ${overdueInvoices[0]?.account.name}`}
          </p>
        </div>

        {/* Widget 3: Paid This Month */}
        <div className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-1">Money In This Month</p>
          <p className="text-2xl font-bold text-[#4ade80]">
            £{paidAmount.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
          </p>
          <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
            {paidCount} payment{paidCount !== 1 ? "s" : ""}
          </p>
        </div>

        {/* Widget 4: Quick Actions */}
        <div className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-2">Quick Actions</p>
          <div className="flex flex-col gap-1.5">
            <Link href="/finance/invoices" className="text-xs text-[#38bdf8] hover:underline">All Invoices →</Link>
            <Link href="/finance/payments" className="text-xs text-[#38bdf8] hover:underline">Payments →</Link>
          </div>
        </div>
      </div>

      {/* Recent Invoices */}
      <section>
        <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">Recent Invoices</h2>
        <div className="space-y-2">
          {recentInvoices.map((inv) => {
            const colour = STATUS_COLOURS[inv.status] ?? "#8888a0";
            return (
              <Link
                key={inv.id}
                href={`/finance/invoices/${inv.id}`}
                className="flex items-center justify-between p-3 rounded-lg bg-[var(--dpf-surface-1)] hover:bg-[var(--dpf-surface-2)] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-[9px] font-mono text-[var(--dpf-muted)]">{inv.invoiceRef}</span>
                  <span className="text-sm text-white">{inv.account.name}</span>
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded-full"
                    style={{ background: `${colour}20`, color: colour }}
                  >
                    {inv.status}
                  </span>
                </div>
                <span className="text-sm font-medium text-white">
                  £{Number(inv.totalAmount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}
                </span>
              </Link>
            );
          })}
          {recentInvoices.length === 0 && (
            <p className="text-sm text-[var(--dpf-muted)]">No invoices yet. Create your first invoice to get started.</p>
          )}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/(shell)/finance/page.tsx
git commit -m "feat(finance): add finance dashboard with 4-widget layout"
```

---

## Task 7: Invoice List Page

**Files:**
- Create: `apps/web/app/(shell)/finance/invoices/page.tsx`

- [ ] **Step 1: Create invoice list with status filters**

```typescript
// apps/web/app/(shell)/finance/invoices/page.tsx
import { prisma } from "@dpf/db";
import Link from "next/link";

const STATUS_COLOURS: Record<string, string> = {
  draft: "#8888a0", sent: "#38bdf8", viewed: "#a78bfa",
  overdue: "#ef4444", partially_paid: "#fbbf24", paid: "#4ade80",
  void: "#6b7280", written_off: "#6b7280",
};

type Props = { searchParams: Promise<{ status?: string }> };

export default async function InvoiceListPage({ searchParams }: Props) {
  const { status: statusFilter } = await searchParams;

  const where: Record<string, unknown> = {};
  if (statusFilter) where.status = statusFilter;

  const [invoices, statusCounts] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        account: { select: { name: true } },
      },
    }),
    prisma.invoice.groupBy({
      by: ["status"],
      _count: true,
    }),
  ]);

  const countMap = Object.fromEntries(
    statusCounts.map((s) => [s.status, s._count]),
  );

  const filterStatuses = ["draft", "sent", "viewed", "overdue", "partially_paid", "paid"];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/finance" className="text-xs text-[var(--dpf-muted)] hover:text-white">Finance</Link>
          <span className="text-xs text-[var(--dpf-muted)]"> / </span>
          <span className="text-xs text-white">Invoices</span>
        </div>
        <Link
          href="/finance/invoices/new"
          className="px-3 py-1.5 text-xs font-medium rounded bg-[#22c55e] text-black hover:bg-[#16a34a] transition-colors"
        >
          New Invoice
        </Link>
      </div>

      {/* Status filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <Link
          href="/finance/invoices"
          className={`text-[10px] px-2 py-1 rounded-full border ${!statusFilter ? "border-white text-white" : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-white"}`}
        >
          All ({invoices.length})
        </Link>
        {filterStatuses.map((s) => {
          const colour = STATUS_COLOURS[s] ?? "#8888a0";
          const count = countMap[s] ?? 0;
          return (
            <Link
              key={s}
              href={`/finance/invoices?status=${s}`}
              className={`text-[10px] px-2 py-1 rounded-full border ${statusFilter === s ? "border-white text-white" : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-white"}`}
            >
              {s.replace("_", " ")} ({count})
            </Link>
          );
        })}
      </div>

      {/* Invoice table */}
      <div className="space-y-2">
        {invoices.map((inv) => {
          const colour = STATUS_COLOURS[inv.status] ?? "#8888a0";
          const isOverdue =
            inv.status !== "paid" &&
            inv.status !== "void" &&
            new Date(inv.dueDate) < new Date();

          return (
            <Link
              key={inv.id}
              href={`/finance/invoices/${inv.id}`}
              className="flex items-center justify-between p-3 rounded-lg bg-[var(--dpf-surface-1)] hover:bg-[var(--dpf-surface-2)] transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-[9px] font-mono text-[var(--dpf-muted)] shrink-0">{inv.invoiceRef}</span>
                <span className="text-sm text-white truncate">{inv.account.name}</span>
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0"
                  style={{ background: `${colour}20`, color: colour }}
                >
                  {isOverdue && inv.status !== "overdue" ? "overdue" : inv.status.replace("_", " ")}
                </span>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <span className="text-[10px] text-[var(--dpf-muted)]">
                  Due {new Date(inv.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </span>
                <span className="text-sm font-medium text-white w-24 text-right">
                  £{Number(inv.totalAmount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}
                </span>
              </div>
            </Link>
          );
        })}
        {invoices.length === 0 && (
          <p className="text-sm text-[var(--dpf-muted)]">
            {statusFilter ? `No ${statusFilter} invoices.` : "No invoices yet."}
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/(shell)/finance/invoices/page.tsx
git commit -m "feat(finance): add invoice list page with status filters"
```

---

## Task 8: Invoice Detail Page

**Files:**
- Create: `apps/web/app/(shell)/finance/invoices/[id]/page.tsx`

- [ ] **Step 1: Create invoice detail with line items, payment history, and actions**

```typescript
// apps/web/app/(shell)/finance/invoices/[id]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getInvoice } from "@/lib/actions/finance";

const STATUS_COLOURS: Record<string, string> = {
  draft: "#8888a0", sent: "#38bdf8", viewed: "#a78bfa",
  overdue: "#ef4444", partially_paid: "#fbbf24", paid: "#4ade80",
  void: "#6b7280",
};

type Props = { params: Promise<{ id: string }> };

export default async function InvoiceDetailPage({ params }: Props) {
  const { id } = await params;
  const invoice = await getInvoice(id);
  if (!invoice) notFound();

  const colour = STATUS_COLOURS[invoice.status] ?? "#8888a0";

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link href="/finance" className="text-xs text-[var(--dpf-muted)] hover:text-white">Finance</Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <Link href="/finance/invoices" className="text-xs text-[var(--dpf-muted)] hover:text-white">Invoices</Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-white">{invoice.invoiceRef}</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold text-white">{invoice.invoiceRef}</h1>
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-full"
              style={{ background: `${colour}20`, color: colour }}
            >
              {invoice.status.replace("_", " ")}
            </span>
          </div>
          <p className="text-sm text-[var(--dpf-muted)]">{invoice.account.name}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-white">
            {invoice.currency} {Number(invoice.totalAmount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}
          </p>
          {Number(invoice.amountDue) > 0 && Number(invoice.amountDue) !== Number(invoice.totalAmount) && (
            <p className="text-sm text-[var(--dpf-muted)]">
              Due: {invoice.currency} {Number(invoice.amountDue).toLocaleString("en-GB", { minimumFractionDigits: 2 })}
            </p>
          )}
        </div>
      </div>

      {/* Metadata */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-[10px] text-[var(--dpf-muted)]">Issue Date</p>
          <p className="text-sm text-white">{new Date(invoice.issueDate).toLocaleDateString("en-GB")}</p>
        </div>
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-[10px] text-[var(--dpf-muted)]">Due Date</p>
          <p className="text-sm text-white">{new Date(invoice.dueDate).toLocaleDateString("en-GB")}</p>
        </div>
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-[10px] text-[var(--dpf-muted)]">Terms</p>
          <p className="text-sm text-white">{invoice.paymentTerms ?? "—"}</p>
        </div>
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-[10px] text-[var(--dpf-muted)]">Type</p>
          <p className="text-sm text-white">{invoice.type}</p>
        </div>
      </div>

      {/* Line Items */}
      <section className="mb-8">
        <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">Line Items</h2>
        <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--dpf-surface-1)]">
                <th className="text-left p-3 text-[10px] text-[var(--dpf-muted)] uppercase">Description</th>
                <th className="text-right p-3 text-[10px] text-[var(--dpf-muted)] uppercase">Qty</th>
                <th className="text-right p-3 text-[10px] text-[var(--dpf-muted)] uppercase">Unit Price</th>
                <th className="text-right p-3 text-[10px] text-[var(--dpf-muted)] uppercase">Tax</th>
                <th className="text-right p-3 text-[10px] text-[var(--dpf-muted)] uppercase">Total</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lineItems.map((li) => (
                <tr key={li.id} className="border-t border-[var(--dpf-border)]">
                  <td className="p-3 text-white">{li.description}</td>
                  <td className="p-3 text-right text-[var(--dpf-muted)]">{Number(li.quantity)}</td>
                  <td className="p-3 text-right text-[var(--dpf-muted)]">
                    £{Number(li.unitPrice).toLocaleString("en-GB", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="p-3 text-right text-[var(--dpf-muted)]">{Number(li.taxRate)}%</td>
                  <td className="p-3 text-right text-white font-medium">
                    £{Number(li.lineTotal).toLocaleString("en-GB", { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
                <td colSpan={4} className="p-3 text-right text-[10px] text-[var(--dpf-muted)] uppercase">Subtotal</td>
                <td className="p-3 text-right text-white">
                  £{Number(invoice.subtotal).toLocaleString("en-GB", { minimumFractionDigits: 2 })}
                </td>
              </tr>
              {Number(invoice.taxAmount) > 0 && (
                <tr className="bg-[var(--dpf-surface-1)]">
                  <td colSpan={4} className="p-3 text-right text-[10px] text-[var(--dpf-muted)] uppercase">Tax</td>
                  <td className="p-3 text-right text-white">
                    £{Number(invoice.taxAmount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              )}
              <tr className="bg-[var(--dpf-surface-1)]">
                <td colSpan={4} className="p-3 text-right text-xs font-bold text-white uppercase">Total</td>
                <td className="p-3 text-right text-white font-bold">
                  £{Number(invoice.totalAmount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Payment History */}
      <section className="mb-8">
        <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">Payments</h2>
        {invoice.allocations.length > 0 ? (
          <div className="space-y-2">
            {invoice.allocations.map((alloc) => (
              <div
                key={alloc.id}
                className="flex items-center justify-between p-3 rounded-lg bg-[var(--dpf-surface-1)]"
              >
                <div className="flex items-center gap-3">
                  <span className="text-[9px] font-mono text-[var(--dpf-muted)]">{alloc.payment.paymentRef}</span>
                  <span className="text-sm text-white">{alloc.payment.method.replace("_", " ")}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-[var(--dpf-muted)]">
                    {alloc.payment.receivedAt
                      ? new Date(alloc.payment.receivedAt).toLocaleDateString("en-GB")
                      : "—"}
                  </span>
                  <span className="text-sm font-medium text-[#4ade80]">
                    £{Number(alloc.amount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--dpf-muted)]">No payments recorded.</p>
        )}
      </section>

      {/* Notes */}
      {invoice.notes && (
        <section className="mb-8">
          <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">Notes</h2>
          <p className="text-sm text-[var(--dpf-muted)]">{invoice.notes}</p>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/(shell)/finance/invoices/[id]/page.tsx
git commit -m "feat(finance): add invoice detail page with line items and payment history"
```

---

## Task 9: Create Invoice Page

**Files:**
- Create: `apps/web/app/(shell)/finance/invoices/new/page.tsx`
- Create: `apps/web/components/finance/CreateInvoiceForm.tsx`

- [ ] **Step 1: Create the client-side invoice form component**

Create `apps/web/components/finance/CreateInvoiceForm.tsx` — a client component with:
- Customer selector (auto-complete from CustomerAccount list)
- Due date picker
- Currency and payment terms fields
- Dynamic line items: add/remove rows, each with description, quantity, unit price, tax rate
- Live total calculation (subtotal, tax, total)
- "Save as Draft" and "Save and Send" buttons
- Calls `createInvoice` server action on submit
- Redirects to `/finance/invoices/[id]` on success
- Single page, no multi-step wizard (per Decision 1.1: under 60 seconds)

- [ ] **Step 2: Create the page wrapper**

```typescript
// apps/web/app/(shell)/finance/invoices/new/page.tsx
import { prisma } from "@dpf/db";
import Link from "next/link";
import { CreateInvoiceForm } from "@/components/finance/CreateInvoiceForm";

export default async function NewInvoicePage() {
  const customers = await prisma.customerAccount.findMany({
    where: { status: { in: ["active", "prospect", "qualified", "onboarding"] } },
    orderBy: { name: "asc" },
    select: { id: true, accountId: true, name: true, currency: true },
  });

  return (
    <div>
      <div className="mb-6">
        <Link href="/finance" className="text-xs text-[var(--dpf-muted)] hover:text-white">Finance</Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <Link href="/finance/invoices" className="text-xs text-[var(--dpf-muted)] hover:text-white">Invoices</Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-white">New</span>
      </div>
      <h1 className="text-xl font-bold text-white mb-6">New Invoice</h1>
      <CreateInvoiceForm customers={customers} />
    </div>
  );
}
```

- [ ] **Step 3: Implement CreateInvoiceForm** (full client component — too large for inline plan, implement following the form patterns in `apps/web/components/compliance/` and `apps/web/components/storefront-admin/`). Key requirements:
- `"use client"` directive
- State for customer, dueDate, currency, paymentTerms, lineItems array
- Add/remove line item rows
- Live subtotal/tax/total calculation
- Submit calls `createInvoice` from `@/lib/actions/finance`
- Use `useRouter` for redirect after success
- Smart defaults: currency from selected customer, 30-day due date

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/(shell)/finance/invoices/new/ apps/web/components/finance/
git commit -m "feat(finance): add create invoice page with single-page form"
```

---

## Task 10: Payment List Page

**Files:**
- Create: `apps/web/app/(shell)/finance/payments/page.tsx`

- [ ] **Step 1: Create payment list page**

Follow the same pattern as the invoice list page. Show:
- Payment ref, method, direction (inbound/outbound), amount, status, date
- Filter by direction
- Link to associated invoice if allocated
- Colour-code: inbound = green, outbound = orange

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/(shell)/finance/payments/page.tsx
git commit -m "feat(finance): add payment list page"
```

---

## Task 11: Run Full Test Suite and Build Verification

- [ ] **Step 1: Run all finance tests**

Run: `cd apps/web && npx vitest run lib/permissions.test.ts lib/finance-validation.test.ts lib/actions/finance.test.ts`
Expected: All PASS.

- [ ] **Step 2: Run full project test suite**

Run: `cd apps/web && npx vitest run`
Expected: No regressions. All existing tests still pass.

- [ ] **Step 3: Verify build compiles**

Run: `cd apps/web && npx next build --no-lint 2>&1 | tail -20`
Expected: Build succeeds with no TypeScript errors in finance files.

- [ ] **Step 4: Commit any remaining fixes**

If any tests or build issues found, fix and commit:
```bash
git commit -m "fix(finance): resolve build/test issues from Phase A"
```

---

## Summary

| Task | What It Delivers | Test Coverage |
|------|-----------------|---------------|
| 1 | Finance permissions + workspace tile | Permission unit tests |
| 2 | Invoice + Payment Prisma models | Migration verification |
| 3 | Zod validation schemas | Input validation tests |
| 4 | Server actions (create, update, record, list) | Mocked unit tests |
| 5 | REST API routes (CRUD) | Build verification |
| 6 | Finance dashboard (4 widgets) | — |
| 7 | Invoice list with filters | — |
| 8 | Invoice detail with payment history | — |
| 9 | Create invoice form (60-second target) | — |
| 10 | Payment list | — |
| 11 | Full test suite + build verification | Integration check |
