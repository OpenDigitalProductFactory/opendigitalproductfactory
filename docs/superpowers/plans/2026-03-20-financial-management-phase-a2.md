# Financial Management Phase A.2: Order Conversion, PDF, Email & Pay Now

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-generate invoices from SalesOrder and StorefrontOrder, generate branded PDF invoices, send via email with a Pay Now link, and provide a public payment page where customers can view and mark invoices as paid (Stripe integration deferred).

**Architecture:** New server actions extend `lib/actions/finance.ts`. Invoice-to-PDF rendering via `@react-pdf/renderer` (server-side, no browser needed). Email via Nodemailer with SMTP (works in dev with Mailpit/Ethereal, production with any SMTP provider). Public payment page under `(storefront)` route group using a secure token (nanoid) stored on Invoice. No Stripe in this phase — the Pay Now page shows bank transfer details and a "Mark as Paid" action for now; Stripe checkout will be added by EP-FINANCE-001 item 12.

**Tech Stack:** @react-pdf/renderer (PDF), Nodemailer (email), nanoid (secure tokens), Next.js server actions + route handlers, existing Prisma models.

**Spec:** `docs/superpowers/specs/2026-03-20-financial-management-design.md` (Phase A items 3-4)
**Decisions:** `docs/superpowers/specs/2026-03-20-financial-management-implementation-decisions.md` (Decisions 1.2, 1.3, 1.6)

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `apps/web/lib/invoice-pdf.ts` | PDF generation using @react-pdf/renderer |
| `apps/web/lib/invoice-pdf.test.ts` | Tests for PDF generation (returns buffer) |
| `apps/web/lib/email.ts` | Email sending via Nodemailer |
| `apps/web/lib/email.test.ts` | Tests for email composition |
| `apps/web/app/api/v1/finance/invoices/[id]/pdf/route.ts` | GET endpoint returning invoice PDF |
| `apps/web/app/api/v1/finance/invoices/[id]/send/route.ts` | POST endpoint to send invoice via email |
| `apps/web/app/(storefront)/s/pay/[token]/page.tsx` | Public Pay Now page (no auth required — must be under /s/ for storefront middleware to allow unauthenticated access) |

### Modified Files
| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add `payToken` field to Invoice model |
| `apps/web/lib/actions/finance.ts` | Add `generateInvoiceFromSalesOrder`, `generateInvoiceFromStorefrontOrder`, `sendInvoice`, `getInvoiceByPayToken` |
| `apps/web/lib/actions/finance.test.ts` | Tests for new actions |
| `apps/web/lib/actions/crm.ts` | After `acceptQuote` creates SalesOrder, call invoice generation |
| `apps/web/lib/storefront-actions.ts` | After `submitOrder`, call invoice generation |
| `apps/web/app/(shell)/finance/invoices/[id]/page.tsx` | Add "Send Invoice" and "Download PDF" action buttons |
| `apps/web/package.json` | Add @react-pdf/renderer, nodemailer, @types/nodemailer |

---

## Task 1: Add payToken Field to Invoice Model

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add payToken to Invoice model**

Add after `erpRefId` in the Invoice model:
```prisma
  payToken        String?             @unique
```

- [ ] **Step 2: Generate and run migration**

Run: `cd packages/db && npx prisma migrate dev --name add_invoice_pay_token`

- [ ] **Step 3: Verify with prisma generate**

Run: `cd packages/db && npx prisma generate`

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(finance): add payToken field to Invoice for secure payment links"
```

---

## Task 2: Install PDF and Email Dependencies

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Install dependencies**

Note: `nanoid` is already a dependency (used in `storefront-actions.ts`).

Run: `cd apps/web && pnpm add @react-pdf/renderer nodemailer && pnpm add -D @types/nodemailer`

- [ ] **Step 2: Verify installation**

Run: `cd apps/web && node -e "require('@react-pdf/renderer'); require('nodemailer'); console.log('OK')"`

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore(finance): add @react-pdf/renderer and nodemailer dependencies"
```

---

## Task 3: Invoice PDF Generation

**Files:**
- Create: `apps/web/lib/invoice-pdf.ts`
- Create: `apps/web/lib/invoice-pdf.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/web/lib/invoice-pdf.test.ts
import { describe, expect, it } from "vitest";
import { generateInvoicePdf } from "./invoice-pdf";

const mockInvoice = {
  invoiceRef: "INV-2026-0001",
  type: "standard",
  status: "sent",
  issueDate: new Date("2026-03-20"),
  dueDate: new Date("2026-04-20"),
  currency: "GBP",
  subtotal: 300,
  taxAmount: 60,
  discountAmount: 0,
  totalAmount: 360,
  amountPaid: 0,
  amountDue: 360,
  paymentTerms: "Net 30",
  notes: "Thank you for your business",
  account: { name: "Acme Corp" },
  contact: { firstName: "Jane", lastName: "Doe", email: "jane@acme.com" },
  lineItems: [
    { description: "Consulting", quantity: 2, unitPrice: 150, taxRate: 20, taxAmount: 60, lineTotal: 360, sortOrder: 0 },
  ],
};

describe("generateInvoicePdf", () => {
  it("returns a Buffer", async () => {
    const result = await generateInvoicePdf(mockInvoice as never);
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it("returns a non-empty Buffer", async () => {
    const result = await generateInvoicePdf(mockInvoice as never);
    expect(result.length).toBeGreaterThan(100);
  });

  it("generates valid PDF (starts with %PDF)", async () => {
    const result = await generateInvoicePdf(mockInvoice as never);
    const header = result.subarray(0, 5).toString("ascii");
    expect(header).toBe("%PDF-");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/invoice-pdf.test.ts`

- [ ] **Step 3: Implement PDF generation**

Create `apps/web/lib/invoice-pdf.ts`. Use `@react-pdf/renderer` with `renderToBuffer`. Define a `InvoiceDocument` React component that renders:
- Header: company name (or "Invoice" title), invoice ref, issue date, due date
- Customer: account name, contact name, contact email
- Line items table: description, qty, unit price, tax rate, line total
- Totals: subtotal, tax, total, amount due
- Payment terms and notes at bottom
- Filename helper: `getInvoicePdfFilename(invoiceRef, accountName)` → `Invoice-INV-2026-0001-AcmeCorp.pdf` (per Decision 1.6)

Export:
```typescript
export async function generateInvoicePdf(invoice: InvoiceForPdf): Promise<Buffer>
export function getInvoicePdfFilename(invoiceRef: string, accountName: string): string
```

The `InvoiceForPdf` type should match the shape returned by `getInvoice()` from `lib/actions/finance.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/invoice-pdf.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/invoice-pdf.ts apps/web/lib/invoice-pdf.test.ts
git commit -m "feat(finance): add invoice PDF generation with @react-pdf/renderer"
```

---

## Task 4: Email Sending Infrastructure

**Files:**
- Create: `apps/web/lib/email.ts`
- Create: `apps/web/lib/email.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/web/lib/email.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("nodemailer", () => ({
  createTransport: vi.fn(() => ({
    sendMail: vi.fn().mockResolvedValue({ messageId: "test-123" }),
  })),
}));

import { sendEmail, composeInvoiceEmail } from "./email";

describe("composeInvoiceEmail", () => {
  it("composes email with correct subject", () => {
    const result = composeInvoiceEmail({
      to: "jane@acme.com",
      invoiceRef: "INV-2026-0001",
      accountName: "Acme Corp",
      totalAmount: "360.00",
      currency: "GBP",
      dueDate: "20 April 2026",
      payUrl: "https://example.com/pay/abc123",
    });
    expect(result.subject).toBe("Invoice INV-2026-0001 from your provider");
    expect(result.to).toBe("jane@acme.com");
  });

  it("includes pay URL in html body", () => {
    const result = composeInvoiceEmail({
      to: "jane@acme.com",
      invoiceRef: "INV-2026-0001",
      accountName: "Acme Corp",
      totalAmount: "360.00",
      currency: "GBP",
      dueDate: "20 April 2026",
      payUrl: "https://example.com/pay/abc123",
    });
    expect(result.html).toContain("https://example.com/pay/abc123");
    expect(result.html).toContain("Pay Now");
  });

  it("includes invoice ref in text body", () => {
    const result = composeInvoiceEmail({
      to: "jane@acme.com",
      invoiceRef: "INV-2026-0001",
      accountName: "Acme Corp",
      totalAmount: "360.00",
      currency: "GBP",
      dueDate: "20 April 2026",
      payUrl: "https://example.com/pay/abc123",
    });
    expect(result.text).toContain("INV-2026-0001");
  });
});

describe("sendEmail", () => {
  it("calls transport.sendMail and returns messageId", async () => {
    const result = await sendEmail({
      to: "test@example.com",
      subject: "Test",
      text: "Hello",
      html: "<p>Hello</p>",
    });
    expect(result.messageId).toBe("test-123");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/email.test.ts`

- [ ] **Step 3: Implement email module**

Create `apps/web/lib/email.ts`:
- `sendEmail({ to, subject, text, html, attachments? })` — uses Nodemailer with SMTP config from env vars (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`). Falls back to console.log in dev if no SMTP configured.
- `composeInvoiceEmail({ to, invoiceRef, accountName, totalAmount, currency, dueDate, payUrl })` — returns `{ to, subject, text, html }`. Subject: "Invoice {ref} from your provider". HTML body: professional email with large "Pay Now" button linking to payUrl, invoice summary (ref, amount, due date), plain text fallback.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/email.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/email.ts apps/web/lib/email.test.ts
git commit -m "feat(finance): add email infrastructure with Nodemailer and invoice email composer"
```

---

## Task 5: Order-to-Invoice Conversion Actions

**Files:**
- Modify: `apps/web/lib/actions/finance.ts`
- Modify: `apps/web/lib/actions/finance.test.ts`

- [ ] **Step 1: Write failing tests for order conversion**

Add to `apps/web/lib/actions/finance.test.ts`:

Tests for `generateInvoiceFromSalesOrder`:
- Creates invoice with correct accountId, sourceType="sales_order", sourceId=salesOrder.id
- Maps SalesOrder totalAmount correctly
- Skips if invoice already exists for same sourceType+sourceId (idempotent)

Tests for `generateInvoiceFromStorefrontOrder`:
- Creates invoice with sourceType="storefront_order"
- Maps StorefrontOrder items to invoice line items
- Skips if invoice already exists (idempotent)

Test for `sendInvoice`:
- Generates payToken if not present
- Updates status to "sent" and sets sentAt
- Returns payToken for URL construction

Test for `getInvoiceByPayToken`:
- Returns invoice when token valid
- Returns null when token invalid

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/actions/finance.test.ts`

- [ ] **Step 3: Implement order conversion actions**

Add to `apps/web/lib/actions/finance.ts`:

```typescript
export async function generateInvoiceFromSalesOrder(salesOrderId: string) {
  // Check idempotency: skip if invoice exists for this source
  const existing = await prisma.invoice.findFirst({
    where: { sourceType: "sales_order", sourceId: salesOrderId },
  });
  if (existing) return existing;

  const order = await prisma.salesOrder.findUnique({
    where: { id: salesOrderId },
    include: { quote: { include: { lineItems: true } }, account: true },
  });
  if (!order) throw new Error("Sales order not found");

  // Map quote line items to invoice line items
  const lineItems = order.quote.lineItems.map((li, i) => ({
    description: li.description,
    quantity: Number(li.quantity),
    unitPrice: Number(li.unitPrice),
    taxRate: Number(li.taxPercent),
    discountPercent: Number(li.discountPercent),
  }));

  return createInvoice({
    accountId: order.accountId,
    dueDate: /* 30 days from now */,
    currency: order.currency,
    sourceType: "sales_order",
    sourceId: salesOrderId,
    lineItems,
  });
}

export async function generateInvoiceFromStorefrontOrder(orderId: string) {
  // Check idempotency
  const existing = await prisma.invoice.findFirst({
    where: { sourceType: "storefront_order", sourceId: orderId },
  });
  if (existing) return existing;

  const order = await prisma.storefrontOrder.findUnique({ where: { id: orderId } });
  if (!order) throw new Error("Storefront order not found");

  // StorefrontOrder has no accountId — find or create CustomerAccount from customerEmail
  let contact = await prisma.customerContact.findUnique({
    where: { email: order.customerEmail },
    include: { account: true },
  });
  if (!contact) {
    // Create minimal CustomerAccount + CustomerContact for this customer
    const account = await prisma.customerAccount.create({
      data: {
        accountId: `CA-${nanoid(8)}`,
        name: order.customerEmail.split("@")[0] ?? "Customer",
        status: "prospect",
      },
    });
    contact = await prisma.customerContact.create({
      data: { email: order.customerEmail, accountId: account.id },
      include: { account: true },
    });
  }

  // Map JSON items to invoice line items
  const items = order.items as Array<{ name: string; qty: number; unitPrice: number }>;
  const lineItems = items.map((item) => ({
    description: item.name,
    quantity: item.qty,
    unitPrice: item.unitPrice,
    taxRate: 0, // StorefrontOrder does not carry tax info — default to 0
  }));

  return createInvoice({
    accountId: contact.account.id,
    contactId: contact.id,
    dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0]!,
    currency: order.currency,
    sourceType: "storefront_order",
    sourceId: orderId,
    lineItems,
  });
}

export async function sendInvoice(invoiceId: string): Promise<{ payToken: string }> {
  const userId = await requireManageFinance();
  const invoice = await getInvoice(invoiceId);
  if (!invoice) throw new Error("Invoice not found");

  // Generate payToken if not present
  let payToken = invoice.payToken;
  if (!payToken) {
    payToken = nanoid(32);
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { payToken },
    });
  }

  // Update status to sent
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: "sent", sentAt: new Date() },
  });

  revalidatePath("/finance");
  revalidatePath("/finance/invoices");
  return { payToken };
}

export async function getInvoiceByPayToken(token: string) {
  return prisma.invoice.findUnique({
    where: { payToken: token },
    include: {
      lineItems: { orderBy: { sortOrder: "asc" } },
      account: { select: { name: true } },
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/actions/finance.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/actions/finance.ts apps/web/lib/actions/finance.test.ts
git commit -m "feat(finance): add order-to-invoice conversion and sendInvoice with payToken"
```

---

## Task 6: PDF Download and Send Invoice API Routes

**Files:**
- Create: `apps/web/app/api/v1/finance/invoices/[id]/pdf/route.ts`
- Create: `apps/web/app/api/v1/finance/invoices/[id]/send/route.ts`

- [ ] **Step 1: Create PDF download route**

```typescript
// GET /api/v1/finance/invoices/[id]/pdf — returns PDF binary
import { authenticateRequest } from "@/lib/api/auth-middleware.js";
import { ApiError, apiError } from "@/lib/api/error.js";
import { getInvoice } from "@/lib/actions/finance";
import { generateInvoicePdf, getInvoicePdfFilename } from "@/lib/invoice-pdf";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);
    const { id } = await params;
    const invoice = await getInvoice(id);
    if (!invoice) throw apiError("NOT_FOUND", "Invoice not found", 404);

    const pdf = await generateInvoicePdf(invoice);
    const filename = getInvoicePdfFilename(invoice.invoiceRef, invoice.account.name);

    const pdfBuffer = await generateInvoicePdf(invoice);
    return new Response(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json({ code: "INTERNAL_ERROR", message: "An unexpected error occurred" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create send invoice route**

```typescript
// POST /api/v1/finance/invoices/[id]/send — sends invoice via email, returns payToken
import { authenticateRequest } from "@/lib/api/auth-middleware.js";
import { ApiError, apiError } from "@/lib/api/error.js";
import { apiSuccess } from "@/lib/api/response.js";
import { getInvoice, sendInvoice } from "@/lib/actions/finance";
import { generateInvoicePdf, getInvoicePdfFilename } from "@/lib/invoice-pdf";
import { sendEmail, composeInvoiceEmail } from "@/lib/email";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);
    const { id } = await params;
    const invoice = await getInvoice(id);
    if (!invoice) throw apiError("NOT_FOUND", "Invoice not found", 404);
    if (!invoice.contact?.email) throw apiError("VALIDATION_ERROR", "Invoice has no contact email", 422);

    // Generate payToken and mark as sent
    const { payToken } = await sendInvoice(id);

    // Build pay URL
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || request.headers.get("origin") || "http://localhost:3000";
    const payUrl = `${baseUrl}/s/pay/${payToken}`;

    // Generate PDF attachment
    const pdf = await generateInvoicePdf(invoice);
    const filename = getInvoicePdfFilename(invoice.invoiceRef, invoice.account.name);

    // Compose and send email
    const email = composeInvoiceEmail({
      to: invoice.contact.email,
      invoiceRef: invoice.invoiceRef,
      accountName: invoice.account.name,
      totalAmount: Number(invoice.totalAmount).toLocaleString("en-GB", { minimumFractionDigits: 2 }),
      currency: invoice.currency,
      dueDate: new Date(invoice.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
      payUrl,
    });

    await sendEmail({
      ...email,
      attachments: [{ filename, content: pdf, contentType: "application/pdf" }],
    });

    return apiSuccess({ sent: true, payToken, payUrl });
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json({ code: "INTERNAL_ERROR", message: "An unexpected error occurred" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/v1/finance/invoices/[id]/pdf/ apps/web/app/api/v1/finance/invoices/[id]/send/
git commit -m "feat(finance): add PDF download and send invoice API endpoints"
```

---

## Task 7: Public Pay Now Page

**Files:**
- Create: `apps/web/app/(storefront)/s/pay/[token]/page.tsx`

- [ ] **Step 1: Create the public payment page**

This is a **public page** (no auth required) under the storefront route group. It:

1. Looks up invoice by `payToken` using `getInvoiceByPayToken(token)`
2. If not found, shows "Invoice not found" message
3. If found, shows:
   - Invoice summary: ref, account name, issue date, due date
   - Line items table (same format as admin detail page)
   - Total amount due (large, prominent)
   - Payment status (if already paid, show "This invoice has been paid")
   - Payment instructions: bank transfer details (placeholder text for now)
   - Large green "Pay Now" button (placeholder — will connect to Stripe in EP-FINANCE-001)
4. Updates `viewedAt` on first view (if not already set)
5. Styling: clean, professional, light theme for customer-facing (not the dark admin theme)

Page type: `{ params: Promise<{ token: string }> }`

Use minimal styling — white background, clean typography, green accent for CTA. The page should feel like a professional invoice portal, not the admin shell.

**IMPORTANT:** This page must NOT require authentication. It's accessed by customers via the link in their email.

- [ ] **Step 2: Update viewedAt tracking via server action**

Add `markInvoiceViewed(invoiceId: string)` to `apps/web/lib/actions/finance.ts` (no auth guard — this is called from a public page):
```typescript
export async function markInvoiceViewed(invoiceId: string): Promise<void> {
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { viewedAt: new Date(), status: "viewed" },
  });
}
```

Call this from the Pay Now page when `viewedAt` is null and status is "sent":
```typescript
if (!invoice.viewedAt && invoice.status === "sent") {
  await markInvoiceViewed(invoice.id);
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/(storefront)/s/pay/ apps/web/lib/actions/finance.ts
git commit -m "feat(finance): add public Pay Now page with invoice view tracking"
```

---

## Task 8: Wire Order Conversion into CRM and Storefront Flows

**Files:**
- Modify: `apps/web/lib/actions/crm.ts`
- Modify: `apps/web/lib/storefront-actions.ts`

- [ ] **Step 1: Add invoice generation after SalesOrder creation in CRM**

In `apps/web/lib/actions/crm.ts`, in the `acceptQuote` function, after the SalesOrder is created and the transaction completes (around line 625), add:

```typescript
// Auto-generate invoice from sales order
try {
  await generateInvoiceFromSalesOrder(result.salesOrder.id);
} catch (err) {
  // Log but don't fail the quote acceptance — invoice can be generated manually
  console.error("Auto-invoice generation failed for SalesOrder", result.salesOrder.orderRef, err);
}
```

Import at top: `import { generateInvoiceFromSalesOrder } from "@/lib/actions/finance";`

- [ ] **Step 2: Add invoice generation after StorefrontOrder creation**

In `apps/web/lib/storefront-actions.ts`, in the `submitOrder` function:

First, change the `prisma.storefrontOrder.create` call's `select` to include `id`:
```typescript
select: { id: true, orderRef: true },
```

Then, after the order is created successfully, add:
```typescript
// Auto-generate invoice from storefront order
try {
  await generateInvoiceFromStorefrontOrder(created.id);
} catch (err) {
  console.error("Auto-invoice generation failed for StorefrontOrder", created.orderRef, err);
}
```

Import at top: `import { generateInvoiceFromStorefrontOrder } from "@/lib/actions/finance";`

Note: The `submitOrder` function returns `{ success: true, ref, type }` — the invoice generation is fire-and-forget (non-blocking). If it fails, the order still succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/actions/crm.ts apps/web/lib/storefront-actions.ts
git commit -m "feat(finance): auto-generate invoices on SalesOrder and StorefrontOrder creation"
```

---

## Task 9: Add Send and Download Buttons to Invoice Detail Page

**Files:**
- Modify: `apps/web/app/(shell)/finance/invoices/[id]/page.tsx`

- [ ] **Step 1: Add action buttons to invoice detail header**

Add a client component for the action buttons (or use form actions). After the header section, add:

- "Download PDF" button — links to `/api/v1/finance/invoices/${invoice.id}/pdf` (opens in new tab)
- "Send Invoice" button — calls the send endpoint, shows success/error toast
- Only show "Send Invoice" for invoices in draft/approved status
- Show "Resend" for invoices already sent

The buttons should appear in the header area next to the invoice ref.

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/(shell)/finance/invoices/[id]/
git commit -m "feat(finance): add Send Invoice and Download PDF buttons to invoice detail"
```

---

## Task 10: Run Full Test Suite and Verify

- [ ] **Step 1: Run all finance tests**

Run: `cd apps/web && npx vitest run lib/invoice-pdf.test.ts lib/email.test.ts lib/actions/finance.test.ts lib/finance-validation.test.ts lib/permissions.test.ts`
Expected: All PASS.

- [ ] **Step 2: Run full test suite**

Run: `cd apps/web && npx vitest run`
Expected: No regressions from Phase A.2.

- [ ] **Step 3: Commit any fixes**

```bash
git commit -m "fix(finance): resolve Phase A.2 test/build issues"
```

---

## Summary

| Task | What It Delivers |
|------|-----------------|
| 1 | payToken field on Invoice for secure payment links |
| 2 | PDF and email dependencies installed |
| 3 | Invoice PDF generation (branded, Decision 1.6 filename) |
| 4 | Email infrastructure (Nodemailer + invoice email composer with Pay Now button) |
| 5 | Order-to-invoice conversion (SalesOrder + StorefrontOrder, idempotent) |
| 6 | PDF download and send invoice API endpoints |
| 7 | Public Pay Now page (no auth, view tracking, Decision 1.2) |
| 8 | Auto-generation wired into CRM and storefront flows |
| 9 | Send/Download buttons on invoice detail page |
| 10 | Full test suite verification |
