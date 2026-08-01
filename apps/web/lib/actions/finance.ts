"use server";

import { prisma } from "@dpf/db";
import { requireCapability } from "@/lib/actions/shared/guards";
import { revalidatePath } from "next/cache";
import { newId } from "@/lib/shared/new-id";
import { signInvoiceSchema } from "@/lib/finance-validation";
import type {
  CreateInvoiceInput,
  RecordPaymentInput,
  SignInvoiceInput,
  UpdateInvoiceContentInput,
} from "@/lib/finance-validation";
import type { INVOICE_STATUSES } from "@/lib/finance-validation";
import { generateInvoicePdf, getInvoicePdfFilename } from "@/lib/invoice-pdf";
import { getOrgIdentity } from "@/lib/org-identity";
import { sendEmail, composeSignedConfirmationEmail, isEmailConfigured } from "@/lib/email";
import { postInvoiceIssued, postPaymentRecorded, reverseJournalEntry } from "@/lib/finance/ledger-service";
import {
  checkInvoiceTransition,
  checkInvoiceDeletion,
  checkInvoiceEditScope,
  type InvoiceStatus as InvoiceLifecycleStatus,
} from "@/lib/finance/invoice-lifecycle";
import { buildInvoiceTotals, round2 } from "@/lib/finance/invoice-totals";
import { customerAccountNormalizedColumns } from "@/lib/mdm/dedup-gate";
import { registerCustomerAccountSource } from "@/lib/mdm/crosswalk";

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

// ─── createInvoice ────────────────────────────────────────────────────────────

export async function createInvoice(input: CreateInvoiceInput): Promise<{ id: string; invoiceRef: string }> {
  const userId = await requireManageFinance();

  const invoiceRef = await generateInvoiceRef();

  const { lineItemsData, subtotal, discountAmount, taxAmount, totalAmount } = buildInvoiceTotals(
    input.lineItems,
  );

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

/**
 * Domain outcomes are RETURNED, not thrown: a thrown error crossing the
 * "use server" boundary is stripped to a generic message in production, which
 * would hide exactly the "why can't I do this" the operator needs.
 */
export type InvoiceStatusResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "illegal_transition"; message: string };

export async function updateInvoiceStatus(
  id: string,
  status: InvoiceStatus,
): Promise<InvoiceStatusResult> {
  await requireManageFinance();

  const existing = await prisma.invoice.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!existing) {
    return { ok: false, error: "not_found", message: "Invoice not found." };
  }

  const check = checkInvoiceTransition(existing.status as InvoiceStatus, status);
  if (!check.allowed) {
    return { ok: false, error: "illegal_transition", message: check.reason };
  }

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
  return { ok: true };
}

// ─── updateInvoice ────────────────────────────────────────────────────────────

export type UpdateInvoiceResult =
  | { ok: true; totalAmount: number }
  | { ok: false; error: "not_found" | "not_editable"; message: string; rejectedFields?: string[] };

/**
 * Edit an invoice's content.
 *
 * Draft invoices are fully editable, line items included. Once sent, only the
 * fields that carry no economic claim can move — see checkInvoiceEditScope. Line
 * items are REPLACED wholesale rather than diffed: an invoice's lines are one
 * document, and per-line patching would let a partial failure leave totals that
 * do not sum.
 */
export async function updateInvoice(
  id: string,
  input: UpdateInvoiceContentInput,
): Promise<UpdateInvoiceResult> {
  await requireManageFinance();

  const existing = await prisma.invoice.findUnique({
    where: { id },
    select: { id: true, status: true, amountPaid: true },
  });
  if (!existing) {
    return { ok: false, error: "not_found", message: "Invoice not found." };
  }

  // Only fields actually supplied are scope-checked; an untouched field is not
  // an attempted change.
  const suppliedFields = Object.keys(input).filter(
    (k) => input[k as keyof UpdateInvoiceContentInput] !== undefined,
  );
  if (suppliedFields.length === 0) {
    return { ok: true, totalAmount: 0 };
  }

  const scope = checkInvoiceEditScope(existing.status as InvoiceLifecycleStatus, suppliedFields);
  if (!scope.allowed) {
    return {
      ok: false,
      error: "not_editable",
      message: scope.reason,
      rejectedFields: scope.rejectedFields,
    };
  }

  const header: Record<string, unknown> = {};
  if (input.notes !== undefined) header.notes = input.notes;
  if (input.internalNotes !== undefined) header.internalNotes = input.internalNotes;
  if (input.paymentTerms !== undefined) header.paymentTerms = input.paymentTerms;
  if (input.dueDate !== undefined) header.dueDate = new Date(input.dueDate);
  if (input.accountId !== undefined) header.accountId = input.accountId;
  if (input.contactId !== undefined) header.contactId = input.contactId;
  if (input.type !== undefined) header.type = input.type;
  if (input.currency !== undefined) header.currency = input.currency;

  let totalAmount = 0;

  await prisma.$transaction(async (tx) => {
    if (input.lineItems !== undefined) {
      const totals = buildInvoiceTotals(input.lineItems);
      totalAmount = totals.totalAmount;

      // Replace the whole set. InvoiceLineItem carries no external references, so
      // there is nothing downstream to orphan.
      await tx.invoiceLineItem.deleteMany({ where: { invoiceId: id } });
      await tx.invoiceLineItem.createMany({
        data: totals.lineItemsData.map((row) => ({ ...row, invoiceId: id })),
      });

      header.subtotal = totals.subtotal;
      header.discountAmount = totals.discountAmount;
      header.taxAmount = totals.taxAmount;
      header.totalAmount = totals.totalAmount;
      header.amountDue = round2(totals.totalAmount - Number(existing.amountPaid ?? 0));
    }

    await tx.invoice.update({ where: { id }, data: header });
  });

  revalidatePath("/finance");
  revalidatePath("/finance/invoices");
  revalidatePath(`/finance/invoices/${id}`);
  return { ok: true, totalAmount };
}

// ─── deleteInvoice ────────────────────────────────────────────────────────────

export type DeleteInvoiceResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "not_deletable"; message: string };

/**
 * Hard-delete an invoice that never became a business record.
 *
 * Deliberately narrow: anything that has reached a customer, a payment, or the
 * ledger must be VOIDED instead so the audit trail survives. The gate itself lives
 * in lib/finance/invoice-lifecycle so it can be reasoned about without a database.
 */
export async function deleteInvoice(id: string): Promise<DeleteInvoiceResult> {
  await requireManageFinance();

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!invoice) {
    return { ok: false, error: "not_found", message: "Invoice not found." };
  }

  const [allocationCount, dunningCount, journalEntryCount] = await Promise.all([
    prisma.paymentAllocation.count({ where: { invoiceId: id } }),
    prisma.dunningLog.count({ where: { invoiceId: id } }),
    prisma.journalEntry.count({ where: { sourceType: "Invoice", sourceId: id } }),
  ]);

  const check = checkInvoiceDeletion({
    status: invoice.status as InvoiceLifecycleStatus,
    allocationCount,
    dunningCount,
    journalEntryCount,
  });
  if (!check.allowed) {
    return { ok: false, error: "not_deletable", message: check.reason };
  }

  await prisma.$transaction(async (tx) => {
    // Billable time attached to this invoice returns to the unbilled pool, otherwise
    // deleting the invoice would silently swallow hours nobody can bill again.
    await tx.timesheetEntry.updateMany({
      where: { invoiceId: id },
      data: { invoiceId: null, invoicedAt: null },
    });
    // InvoiceLineItem cascades on the FK; no explicit delete needed.
    await tx.invoice.delete({ where: { id } });
  });

  revalidatePath("/finance");
  revalidatePath("/finance/invoices");
  return { ok: true };
}

// ─── voidInvoice ──────────────────────────────────────────────────────────────

export type VoidInvoiceResult =
  | { ok: true; reversedJournalEntries: number }
  | { ok: false; error: "not_found" | "illegal_transition"; message: string };

/**
 * Void an invoice: keep the record, neutralise its economics.
 *
 * Unwinds payment allocations (keeping the Payment itself — the money really did
 * arrive), reverses any general-ledger postings via the storno path rather than
 * deleting them, and returns linked billable time to the unbilled pool.
 */
export async function voidInvoice(id: string, reason: string): Promise<VoidInvoiceResult> {
  await requireManageFinance();

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: { id: true, status: true, internalNotes: true },
  });
  if (!invoice) {
    return { ok: false, error: "not_found", message: "Invoice not found." };
  }

  const check = checkInvoiceTransition(invoice.status as InvoiceLifecycleStatus, "void");
  if (!check.allowed) {
    return { ok: false, error: "illegal_transition", message: check.reason };
  }

  // Reverse ledger postings BEFORE mutating the invoice: a storno that fails must
  // not leave a voided invoice with live postings still standing against it.
  const postings = await prisma.journalEntry.findMany({
    where: { sourceType: "Invoice", sourceId: id, status: "posted" },
    select: { id: true },
  });
  let reversedJournalEntries = 0;
  for (const posting of postings) {
    const result = await reverseJournalEntry(posting.id, `Invoice voided: ${reason}`);
    if (result.success) reversedJournalEntries += 1;
  }

  const auditLine = `Voided ${new Date().toISOString()}: ${reason}`;
  const internalNotes = invoice.internalNotes ? `${invoice.internalNotes}\n${auditLine}` : auditLine;

  await prisma.$transaction(async (tx) => {
    await tx.paymentAllocation.deleteMany({ where: { invoiceId: id } });
    await tx.timesheetEntry.updateMany({
      where: { invoiceId: id },
      data: { invoiceId: null, invoicedAt: null },
    });
    await tx.invoice.update({
      where: { id },
      data: {
        status: "void",
        voidedAt: new Date(),
        amountDue: 0,
        amountPaid: 0,
        paidAt: null,
        internalNotes,
      },
    });
  });

  revalidatePath("/finance");
  revalidatePath("/finance/invoices");
  return { ok: true, reversedJournalEntries };
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
    const accountName = order.customerEmail.split("@")[0] ?? "Customer";
    const account = await prisma.customerAccount.create({
      data: {
        accountId: `CA-${newId(8)}`,
        name: accountName,
        ...customerAccountNormalizedColumns({ name: accountName }),
        status: "prospect",
      },
    });
    contact = await prisma.customerContact.create({
      data: { email: order.customerEmail, accountId: account.id },
      include: { account: true },
    });
    await registerCustomerAccountSource({
      accountId: account.id,
      sourceSystem: "storefront-order",
      sourceEntityId: order.customerEmail,
      sourceEntityType: "order-contact",
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

  // A resend of an already-sent invoice is legitimate (chasing, re-issuing the link),
  // so sent -> sent is a no-op transition rather than a rejection. What this blocks is
  // sending an invoice that is void, paid, or written off — previously all accepted.
  const check = checkInvoiceTransition(invoice.status as InvoiceLifecycleStatus, "sent");
  if (!check.allowed) {
    throw new Error(check.reason);
  }

  const payToken = invoice.payToken ?? newId(32);

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
