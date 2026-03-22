"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";
import type { CreateInvoiceInput, RecordPaymentInput } from "@/lib/finance-validation";
import type { INVOICE_STATUSES } from "@/lib/finance-validation";

// ─── Auth guard ───────────────────────────────────────────────────────────────

async function requireManageFinance(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_finance")
  ) {
    throw new Error("Unauthorized");
  }
  return user.id;
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
      currency: input.currency ?? "GBP",
      subtotal,
      taxAmount,
      discountAmount,
      totalAmount,
      amountPaid: 0,
      amountDue: totalAmount,
      paymentTerms: input.paymentTerms ?? null,
      notes: input.notes ?? null,
      internalNotes: input.internalNotes ?? null,
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
      currency: input.currency ?? "GBP",
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

  revalidatePath("/finance");
  revalidatePath("/finance/invoices");

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
