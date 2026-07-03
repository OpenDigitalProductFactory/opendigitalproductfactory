"use server";

import { prisma } from "@dpf/db";
import { requireCapability } from "@/lib/actions/shared/guards";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";
import { signInvoiceSchema } from "@/lib/finance-validation";
import type { CreateInvoiceInput, RecordPaymentInput, SignInvoiceInput } from "@/lib/finance-validation";
import type { INVOICE_STATUSES } from "@/lib/finance-validation";
import { generateInvoicePdf, getInvoicePdfFilename } from "@/lib/invoice-pdf";
import { getOrgIdentity } from "@/lib/org-identity";
import { sendEmail, composeSignedConfirmationEmail, isEmailConfigured } from "@/lib/email";
import { postInvoiceIssued, postPaymentRecorded } from "@/lib/finance/ledger-service";

// ─── Auth guard ───────────────────────────────────────────────────────────────

async function requireManageFinance(): Promise<string> {
  return (await requireCapability("manage_finance")).userId;
}

// ─── Ref generators ───────────────────────────────────────────────────────────

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

// ─── Total calculation helpers ────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface LineItemTotals {
  lineSubtotal: number;
  lineDiscount: number;
  lineAfterDiscount: number;
  lineTax: number;
  lineTotal: number;
}

function calcLineItem(
  quantity: number,
  unitPrice: number,
  taxRate: number,
  discountPercent: number,
): LineItemTotals {
  const lineSubtotal = round2(quantity * unitPrice);
  const lineDiscount = round2(lineSubtotal * (discountPercent / 100));
  const lineAfterDiscount = round2(lineSubtotal - lineDiscount);
  const lineTax = round2(lineAfterDiscount * (taxRate / 100));
  const lineTotal = round2(lineAfterDiscount + lineTax);
  return { lineSubtotal, lineDiscount, lineAfterDiscount, lineTax, lineTotal };
}

// ─── createInvoice ────────────────────────────────────────────────────────────

export async function createInvoice(input: CreateInvoiceInput): Promise<{ id: string; invoiceRef: string }> {
  const userId = await requireManageFinance();

  const invoiceRef = await generateInvoiceRef();

  let subtotal = 0;
  let discountAmount = 0;
  let taxAmount = 0;
  let totalAmount = 0;

  const lineItemsData = input.lineItems.map((item, idx) => {
    const { lineSubtotal, lineDiscount, lineTax, lineTotal } = calcLineItem(
      item.quantity,
      item.unitPrice,
      item.taxRate ?? 0,
      item.discountPercent ?? 0,
    );

    subtotal = round2(subtotal + lineSubtotal);
    discountAmount = round2(discountAmount + lineDiscount);
    taxAmount = round2(taxAmount + lineTax);
    totalAmount = round2(totalAmount + lineTotal);

    return {
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      taxRate: item.taxRate ?? 0,
      taxAmount: lineTax,
      discountPercent: item.discountPercent ?? 0,
      lineTotal: lineTotal,
      accountCode: item.accountCode ?? null,
      sortOrder: idx,
    };
  });

  const invoice = await prisma.invoice.create({
    data: {
      invoiceRef,
      type: input.type ?? "standard",
      status: "draft",
      accountId: input.accountId,
      contactId: input.contactId ?? null,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      dueDate: new Date(input.dueDate),
      currency: input.currency ?? "USD",
      subtotal,
      taxAmount,
      discountAmount,
      totalAmount,
      amountPaid: 0,
      amountDue: totalAmount,
      paymentTerms: input.paymentTerms ?? null,
      notes: input.notes ?? null,
      internalNotes: input.internalNotes ?? null,
      signatureRequired: input.signatureRequired ?? false,
      createdById: userId,
      lineItems: {
        create: lineItemsData,
      },
    },
    select: { id: true, invoiceRef: true },
  });

  revalidatePath("/finance");
  revalidatePath("/finance/invoices");

  return invoice;
}

// ─── updateInvoiceStatus ──────────────────────────────────────────────────────

type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export async function updateInvoiceStatus(id: string, status: InvoiceStatus): Promise<void> {
  await requireManageFinance();

  const timestampData: Record<string, Date | undefined> = {};
  if (status === "sent") timestampData.sentAt = new Date();
  if (status === "paid") timestampData.paidAt = new Date();
  if (status === "void") timestampData.voidedAt = new Date();

  await prisma.invoice.update({
    where: { id },
    data: {
      status,
      ...timestampData,
    },
  });

  revalidatePath("/finance");
  revalidatePath("/finance/invoices");
}

// ─── recordPayment ────────────────────────────────────────────────────────────

export async function recordPayment(input: RecordPaymentInput): Promise<{ id: string; paymentRef: string }> {
  const userId = await requireManageFinance();

  const paymentRef = await generatePaymentRef();

  const payment = await prisma.payment.create({
    data: {
      paymentRef,
      direction: input.direction,
      method: input.method,
      status: "completed",
      amount: input.amount,
      currency: input.currency ?? "USD",
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
      createdById: userId,
    },
    select: { id: true, paymentRef: true },
  });

  if (input.invoiceId) {
    // Create allocation
    await prisma.paymentAllocation.create({
      data: {
        paymentId: payment.id,
        invoiceId: input.invoiceId,
        amount: input.amount,
      },
    });

    // Fetch current invoice totals
    const invoice = await prisma.invoice.findUnique({
      where: { id: input.invoiceId },
      select: { totalAmount: true, amountPaid: true },
    });

    if (invoice) {
      const totalAmount = Number(invoice.totalAmount);
      const prevPaid = Number(invoice.amountPaid);
      const newAmountPaid = round2(prevPaid + input.amount);
      const newAmountDue = round2(totalAmount - newAmountPaid);

      const isPaid = newAmountDue <= 0;
      await prisma.invoice.update({
        where: { id: input.invoiceId },
        data: {
          amountPaid: newAmountPaid,
          amountDue: newAmountDue,
          status: isPaid ? "paid" : "partially_paid",
          ...(isPaid ? { paidAt: new Date() } : {}),
        },
      });
    }
  }

  if (input.billId) {
    await prisma.paymentAllocation.create({
      data: {
        paymentId: payment.id,
        billId: input.billId,
        amount: input.amount,
      },
    });

    const bill = await prisma.bill.findUnique({
      where: { id: input.billId },
      select: { totalAmount: true, amountPaid: true },
    });

    if (bill) {
      const totalAmount = Number(bill.totalAmount);
      const prevPaid = Number(bill.amountPaid);
      const newAmountPaid = round2(prevPaid + input.amount);
      const newAmountDue = round2(totalAmount - newAmountPaid);
      const isPaid = newAmountDue <= 0;

      await prisma.bill.update({
        where: { id: input.billId },
        data: {
          amountPaid: newAmountPaid,
          amountDue: newAmountDue,
          status: isPaid ? "paid" : "partially_paid",
        },
      });
    }
  }

  // Post the payment to the general ledger (settle AR/AP against bank). Best-effort
  // by design: a ledger hiccup must never fail recording the payment. Idempotent,
  // so a later retry is safe.
  try {
    await postPaymentRecorded(payment.id);
  } catch (err) {
    // Log only the error (which carries the paymentRef); no id is interpolated, so
    // no user-controlled value can reach the log sink — consistent with the invoice
    // post above and avoids a CodeQL js/log-injection false positive.
    console.error("[ledger] failed to post a payment to the general ledger:", err);
  }

  revalidatePath("/finance");
  revalidatePath("/finance/invoices");
  revalidatePath("/finance/bills");
  revalidatePath("/finance/payments");

  return payment;
}

// ─── getInvoice ───────────────────────────────────────────────────────────────

export async function getInvoice(id: string) {
  await requireManageFinance();

  return prisma.invoice.findUnique({
    where: { id },
    include: {
      lineItems: { orderBy: { sortOrder: "asc" } },
      account: { select: { id: true, accountId: true, name: true } },
      contact: { select: { id: true, email: true, firstName: true, lastName: true } },
      allocations: {
        include: {
          payment: {
            select: { id: true, paymentRef: true, method: true, amount: true, receivedAt: true },
          },
        },
      },
      createdBy: { select: { id: true, email: true } },
    },
  });
}

// ─── listInvoices ─────────────────────────────────────────────────────────────

interface ListInvoicesFilters {
  status?: string;
  accountId?: string;
}

export async function listInvoices(filters?: ListInvoicesFilters) {
  await requireManageFinance();

  const where: Record<string, unknown> = {};
  if (filters?.status) where.status = filters.status;
  if (filters?.accountId) where.accountId = filters.accountId;

  return prisma.invoice.findMany({
    where,
    include: {
      lineItems: { orderBy: { sortOrder: "asc" } },
      account: { select: { id: true, accountId: true, name: true } },
      contact: { select: { id: true, email: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

// ─── generateInvoiceFromSalesOrder ────────────────────────────────────────────

export async function generateInvoiceFromSalesOrder(salesOrderId: string) {
  // Check idempotency: skip if invoice already exists for this source
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
  const lineItems = order.quote.lineItems.map((li: {
    description: string;
    quantity: unknown;
    unitPrice: unknown;
    taxPercent: unknown;
    discountPercent: unknown;
  }) => ({
    description: li.description,
    quantity: Number(li.quantity),
    unitPrice: Number(li.unitPrice),
    taxRate: Number(li.taxPercent),
    discountPercent: Number(li.discountPercent),
  }));

  return createInvoice({
    accountId: order.accountId,
    type: "standard",
    dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0]!,
    currency: order.currency,
    sourceType: "sales_order",
    sourceId: salesOrderId,
    lineItems,
  });
}

// ─── generateInvoiceFromStorefrontOrder ───────────────────────────────────────

export async function generateInvoiceFromStorefrontOrder(orderId: string) {
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
    discountPercent: 0,
    taxRate: 0,
  }));

  return createInvoice({
    accountId: contact.account.id,
    type: "standard" as const,
    contactId: contact.id,
    dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0]!,
    currency: order.currency,
    sourceType: "storefront_order",
    sourceId: orderId,
    lineItems,
  });
}

// ─── sendInvoice ──────────────────────────────────────────────────────────────

export async function sendInvoice(invoiceId: string): Promise<{ payToken: string }> {
  await requireManageFinance();

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, payToken: true, status: true },
  });
  if (!invoice) throw new Error("Invoice not found");

  const payToken = invoice.payToken ?? nanoid(32);

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { payToken, status: "sent", sentAt: new Date() },
  });

  // Post the issued invoice to the general ledger. Best-effort by design: a ledger
  // hiccup must never block sending the customer their invoice. The post is
  // idempotent (one journal per source document), so a later retry is safe.
  try {
    await postInvoiceIssued(invoiceId);
  } catch (err) {
    // The raw invoiceId is a route parameter (tainted), so it is intentionally NOT
    // logged — no user-controlled value reaches the log sink at all (js/log-injection
    // cannot arise). The thrown error carries the invoiceRef where it matters, and
    // that is the debugging signal for this best-effort post.
    console.error("[ledger] failed to post an issued invoice to the general ledger:", err);
  }

  revalidatePath("/finance");
  revalidatePath("/finance/invoices");
  return { payToken };
}

// ─── getInvoiceByPayToken ─────────────────────────────────────────────────────

export async function getInvoiceByPayToken(token: string) {
  return prisma.invoice.findUnique({
    where: { payToken: token },
    include: {
      lineItems: { orderBy: { sortOrder: "asc" } },
      account: { select: { name: true } },
      contact: { select: { email: true, firstName: true, lastName: true } },
    },
  });
}

// ─── markInvoiceViewed ────────────────────────────────────────────────────────

export async function markInvoiceViewed(invoiceId: string): Promise<void> {
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { viewedAt: new Date(), status: "viewed" },
  });
}

// ─── signInvoice (public, authorized by payToken possession) ───────────────────
//
// Called from the public payment portal's signature pad — the signer is the
// unauthenticated customer, authorized by holding the invoice's payToken (the
// same model as getInvoiceByPayToken / markInvoiceViewed). Idempotent.

export async function signInvoice(input: SignInvoiceInput): Promise<{ ok: true }> {
  const parsed = signInvoiceSchema.parse(input);

  const invoice = await prisma.invoice.findUnique({
    where: { payToken: parsed.token },
    select: { id: true, signatureRequired: true, signedAt: true },
  });
  if (!invoice) throw new Error("Invoice not found");
  if (!invoice.signatureRequired) {
    throw new Error("This invoice does not require a signature");
  }

  // Idempotent: a duplicate submit after a successful sign is a no-op success.
  if (!invoice.signedAt) {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        signedAt: new Date(),
        signedByName: parsed.signedByName,
        signedByEmail: parsed.signedByEmail,
        signatureDataUrl: parsed.signatureDataUrl,
      },
    });

    // Best-effort countersigned confirmation. Never block signing on email.
    await sendSignedConfirmation(invoice.id, parsed.token).catch((e) => {
      console.error("[signInvoice] confirmation email failed", e);
    });
  }

  revalidatePath(`/s/pay/${parsed.token}`);
  return { ok: true };
}

async function sendSignedConfirmation(invoiceId: string, token: string): Promise<void> {
  if (!(await isEmailConfigured())) return;

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      lineItems: { orderBy: { sortOrder: "asc" } },
      account: { select: { name: true } },
      contact: { select: { email: true, firstName: true, lastName: true } },
    },
  });
  if (!invoice || !invoice.signedAt || !invoice.signedByEmail) return;

  const issuer = await getOrgIdentity();
  const signedByName = invoice.signedByName ?? invoice.signedByEmail;
  const pdf = await generateInvoicePdf({
    ...invoice,
    issuer,
    signature: {
      signedByName,
      signedByEmail: invoice.signedByEmail,
      signedAt: invoice.signedAt,
    },
  });
  const filename = getInvoicePdfFilename(invoice.invoiceRef, invoice.account.name);

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const email = composeSignedConfirmationEmail({
    to: invoice.signedByEmail,
    invoiceRef: invoice.invoiceRef,
    accountName: invoice.account.name,
    signedByName,
    signedAt: invoice.signedAt.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
    orgName: issuer?.name ?? null,
    payUrl: `${baseUrl}/s/pay/${token}`,
  });

  await sendEmail({
    ...email,
    from: issuer?.email ? `${issuer.name} <${issuer.email}>` : undefined,
    attachments: [{ filename, content: pdf, contentType: "application/pdf" }],
  });
}

// ─── setInvoiceSignatureRequired (admin) ───────────────────────────────────────
//
// Lets an operator toggle the signature requirement on an invoice before it is
// signed — e.g. enable it on a counselling/IT invoice (default off) or on an
// invoice generated from a sales/storefront order.

export async function setInvoiceSignatureRequired(
  invoiceId: string,
  required: boolean,
): Promise<void> {
  await requireManageFinance();

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, signedAt: true },
  });
  if (!invoice) throw new Error("Invoice not found");
  if (invoice.signedAt) {
    throw new Error("Cannot change the signature requirement after the invoice has been signed");
  }

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { signatureRequired: required },
  });

  revalidatePath(`/finance/invoices/${invoiceId}`);
}
