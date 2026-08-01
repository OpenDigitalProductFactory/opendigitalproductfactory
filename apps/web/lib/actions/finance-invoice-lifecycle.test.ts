// Invoice lifecycle actions — status transitions, content edits, delete, and void.
// Split out of finance.test.ts: the combined file crossed the 800-LOC module
// ceiling, and these four actions are one coherent concern (BI-3FDFBFD3).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ can: vi.fn() }));
// Transaction client shared by deleteInvoice/voidInvoice assertions. prisma.$transaction
// is given a callback in those actions, so the mock simply hands back this client.
const mockTx = {
  invoice: { update: vi.fn(), delete: vi.fn() },
  invoiceLineItem: { deleteMany: vi.fn(), createMany: vi.fn() },
  paymentAllocation: { deleteMany: vi.fn() },
  timesheetEntry: { updateMany: vi.fn() },
};

vi.mock("@dpf/db", () => ({
  prisma: {
    invoice: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn() },
    invoiceLineItem: { deleteMany: vi.fn(), createMany: vi.fn() },
    bill: { findUnique: vi.fn(), update: vi.fn() },
    payment: { create: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
    paymentAllocation: { create: vi.fn(), count: vi.fn(), deleteMany: vi.fn() },
    dunningLog: { count: vi.fn() },
    journalEntry: { count: vi.fn(), findMany: vi.fn() },
    timesheetEntry: { updateMany: vi.fn() },
    salesOrder: { findUnique: vi.fn() },
    storefrontOrder: { findUnique: vi.fn() },
    customerContact: { findUnique: vi.fn(), create: vi.fn() },
    customerAccount: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/finance/ledger-service", () => ({
  postInvoiceIssued: vi.fn().mockResolvedValue({ success: true }),
  postPaymentRecorded: vi.fn().mockResolvedValue({ success: true }),
  reverseJournalEntry: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Keep the signed-confirmation side-effects out of these unit tests: the PDF
// renderer and mailer are exercised elsewhere; here isEmailConfigured()=false
// short-circuits the confirmation path entirely.
vi.mock("@/lib/invoice-pdf", () => ({
  generateInvoicePdf: vi.fn().mockResolvedValue(Buffer.from("pdf")),
  getInvoicePdfFilename: vi.fn(() => "Invoice.pdf"),
}));
vi.mock("@/lib/org-identity", () => ({ getOrgIdentity: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue({ messageId: "x" }),
  composeSignedConfirmationEmail: vi.fn(() => ({ to: "", subject: "", text: "", html: "" })),
  isEmailConfigured: vi.fn(() => false),
}));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { reverseJournalEntry } from "@/lib/finance/ledger-service";
import {
  updateInvoiceStatus,
  updateInvoice,
  deleteInvoice,
  voidInvoice,
} from "./finance";

const mockReverseJournalEntry = vi.mocked(reverseJournalEntry);

const mockAuth = vi.mocked(auth);
const mockCan = vi.mocked(can);
const mockPrisma = prisma as any;

const authorizedSession = {
  user: {
    id: "user-1",
    email: "admin@example.com",
    platformRole: "HR-000",
    isSuperuser: false,
  },
};

const baseInvoiceInput = {
  accountId: "acc-1",
  type: "standard" as const,
  dueDate: "2026-04-30",
  currency: "USD",
  lineItems: [
    {
      description: "Consulting services",
      quantity: 10,
      unitPrice: 100,
      taxRate: 20,
      discountPercent: 0,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(authorizedSession as never);
  mockCan.mockReturnValue(true);
  mockTx.invoice.update.mockReset();
  mockTx.invoice.delete.mockReset();
  mockTx.invoiceLineItem.deleteMany.mockReset();
  mockTx.invoiceLineItem.createMany.mockReset();
  mockTx.paymentAllocation.deleteMany.mockReset();
  mockTx.timesheetEntry.updateMany.mockReset();
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx));
});

// ─── updateInvoiceStatus ──────────────────────────────────────────────────────

describe("updateInvoiceStatus", () => {
  it("sets sentAt when transitioning to sent", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ status: "draft" });
    mockPrisma.invoice.update.mockResolvedValue({});

    const result = await updateInvoiceStatus("inv-1", "sent");

    expect(result).toEqual({ ok: true });
    const updateCall = mockPrisma.invoice.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe("sent");
    expect(updateCall.data.sentAt).toBeInstanceOf(Date);
  });

  it("sets voidedAt when transitioning to void", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ status: "draft" });
    mockPrisma.invoice.update.mockResolvedValue({});

    const result = await updateInvoiceStatus("inv-1", "void");

    expect(result).toEqual({ ok: true });
    const updateCall = mockPrisma.invoice.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe("void");
    expect(updateCall.data.voidedAt).toBeInstanceOf(Date);
  });

  it("sets paidAt when transitioning to paid", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ status: "sent" });
    mockPrisma.invoice.update.mockResolvedValue({});

    const result = await updateInvoiceStatus("inv-1", "paid");

    expect(result).toEqual({ ok: true });
    const updateCall = mockPrisma.invoice.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe("paid");
    expect(updateCall.data.paidAt).toBeInstanceOf(Date);
  });

  it("refuses an illegal transition and writes nothing", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ status: "void" });

    const result = await updateInvoiceStatus("inv-1", "sent");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.error).toBe("illegal_transition");
    expect(result.message).toContain("terminal");
    expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
  });

  it("returns not_found rather than throwing for a missing invoice", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(null);

    const result = await updateInvoiceStatus("nope", "sent");

    expect(result).toEqual({ ok: false, error: "not_found", message: "Invoice not found." });
    expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
  });
});

// ─── updateInvoice ────────────────────────────────────────────────────────────

describe("updateInvoice", () => {
  it("replaces line items on a draft and recomputes the totals", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ id: "inv-1", status: "draft", amountPaid: 0 });

    const result = await updateInvoice("inv-1", {
      lineItems: [
        { description: "A", quantity: 10, unitPrice: 100, taxRate: 20, discountPercent: 10 },
      ],
    });

    expect(result).toEqual({ ok: true, totalAmount: 1080 });
    expect(mockTx.invoiceLineItem.deleteMany).toHaveBeenCalledWith({ where: { invoiceId: "inv-1" } });
    const header = mockTx.invoice.update.mock.calls[0][0].data;
    expect(header.subtotal).toBe(1000);
    expect(header.discountAmount).toBe(100);
    expect(header.taxAmount).toBe(180);
    expect(header.totalAmount).toBe(1080);
    expect(header.amountDue).toBe(1080);
  });

  it("subtracts what has already been paid when recomputing amountDue", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({
      id: "inv-1",
      status: "draft",
      amountPaid: 200,
    });

    await updateInvoice("inv-1", {
      lineItems: [{ description: "A", quantity: 1, unitPrice: 1000, taxRate: 0, discountPercent: 0 }],
    });

    expect(mockTx.invoice.update.mock.calls[0][0].data.amountDue).toBe(800);
  });

  it("refuses to change line items on a sent invoice", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ id: "inv-1", status: "sent", amountPaid: 0 });

    const result = await updateInvoice("inv-1", {
      lineItems: [{ description: "A", quantity: 1, unitPrice: 5 }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.error).toBe("not_editable");
    expect(result.rejectedFields).toEqual(["lineItems"]);
    expect(mockTx.invoice.update).not.toHaveBeenCalled();
    expect(mockTx.invoiceLineItem.deleteMany).not.toHaveBeenCalled();
  });

  it("allows notes on a sent invoice", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ id: "inv-1", status: "sent", amountPaid: 0 });

    const result = await updateInvoice("inv-1", { notes: "chased 2026-08-01" });

    expect(result.ok).toBe(true);
    expect(mockTx.invoice.update.mock.calls[0][0].data).toEqual({ notes: "chased 2026-08-01" });
    // No line-item churn when line items were not supplied.
    expect(mockTx.invoiceLineItem.deleteMany).not.toHaveBeenCalled();
  });

  it("does not treat an omitted field as an attempted change", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ id: "inv-1", status: "paid", amountPaid: 10 });

    const result = await updateInvoice("inv-1", { notes: undefined, lineItems: undefined });

    expect(result.ok).toBe(true);
    expect(mockTx.invoice.update).not.toHaveBeenCalled();
  });

  it("returns not_found rather than throwing", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(null);

    const result = await updateInvoice("nope", { notes: "x" });

    expect(result).toEqual({ ok: false, error: "not_found", message: "Invoice not found." });
  });

  it("applies every header field it is given on a draft", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ id: "inv-1", status: "draft", amountPaid: 0 });

    await updateInvoice("inv-1", {
      notes: "n",
      internalNotes: "i",
      paymentTerms: "NET30",
      dueDate: "2026-09-01",
      accountId: "acc-2",
      currency: "EUR",
    });

    const data = mockTx.invoice.update.mock.calls[0][0].data;
    expect(data.notes).toBe("n");
    expect(data.internalNotes).toBe("i");
    expect(data.paymentTerms).toBe("NET30");
    expect(data.dueDate).toBeInstanceOf(Date);
    expect(data.accountId).toBe("acc-2");
    expect(data.currency).toBe("EUR");
  });
});

// ─── deleteInvoice ────────────────────────────────────────────────────────────

describe("deleteInvoice", () => {
  it("deletes a clean draft and returns its billable time to the unbilled pool", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ id: "inv-1", status: "draft" });
    mockPrisma.paymentAllocation.count.mockResolvedValue(0);
    mockPrisma.dunningLog.count.mockResolvedValue(0);
    mockPrisma.journalEntry.count.mockResolvedValue(0);

    const result = await deleteInvoice("inv-1");

    expect(result).toEqual({ ok: true });
    expect(mockTx.timesheetEntry.updateMany).toHaveBeenCalledWith({
      where: { invoiceId: "inv-1" },
      data: { invoiceId: null, invoicedAt: null },
    });
    expect(mockTx.invoice.delete).toHaveBeenCalledWith({ where: { id: "inv-1" } });
  });

  it("refuses to delete a sent invoice and points at void", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ id: "inv-1", status: "sent" });
    mockPrisma.paymentAllocation.count.mockResolvedValue(0);
    mockPrisma.dunningLog.count.mockResolvedValue(0);
    mockPrisma.journalEntry.count.mockResolvedValue(0);

    const result = await deleteInvoice("inv-1");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.message).toContain("Void it instead");
    expect(mockTx.invoice.delete).not.toHaveBeenCalled();
  });

  it("refuses to delete a draft that already has a payment allocation", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ id: "inv-1", status: "draft" });
    mockPrisma.paymentAllocation.count.mockResolvedValue(1);
    mockPrisma.dunningLog.count.mockResolvedValue(0);
    mockPrisma.journalEntry.count.mockResolvedValue(0);

    const result = await deleteInvoice("inv-1");

    expect(result.ok).toBe(false);
    expect(mockTx.invoice.delete).not.toHaveBeenCalled();
  });

  it("refuses to delete a draft that already posted to the ledger", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ id: "inv-1", status: "draft" });
    mockPrisma.paymentAllocation.count.mockResolvedValue(0);
    mockPrisma.dunningLog.count.mockResolvedValue(0);
    mockPrisma.journalEntry.count.mockResolvedValue(2);

    const result = await deleteInvoice("inv-1");

    expect(result.ok).toBe(false);
    expect(mockTx.invoice.delete).not.toHaveBeenCalled();
  });
});

// ─── voidInvoice ──────────────────────────────────────────────────────────────

describe("voidInvoice", () => {
  it("unallocates payments, reverses ledger postings, and re-bills linked time", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({
      id: "inv-1",
      status: "sent",
      internalNotes: null,
    });
    mockPrisma.journalEntry.findMany.mockResolvedValue([{ id: "je-1" }]);
    mockReverseJournalEntry.mockResolvedValue({
      success: true,
      reversingEntryId: "je-2",
      entryRef: "JE-2",
    });

    const result = await voidInvoice("inv-1", "duplicate of INV-2026-0009");

    expect(result).toEqual({ ok: true, reversedJournalEntries: 1 });
    expect(mockReverseJournalEntry).toHaveBeenCalledWith(
      "je-1",
      expect.stringContaining("duplicate of INV-2026-0009"),
    );
    expect(mockTx.paymentAllocation.deleteMany).toHaveBeenCalledWith({
      where: { invoiceId: "inv-1" },
    });
    expect(mockTx.timesheetEntry.updateMany).toHaveBeenCalledWith({
      where: { invoiceId: "inv-1" },
      data: { invoiceId: null, invoicedAt: null },
    });
    const updateCall = mockTx.invoice.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe("void");
    expect(updateCall.data.amountDue).toBe(0);
    expect(updateCall.data.amountPaid).toBe(0);
    expect(updateCall.data.internalNotes).toContain("duplicate of INV-2026-0009");
  });

  it("refuses to void a paid invoice", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({
      id: "inv-1",
      status: "paid",
      internalNotes: null,
    });

    const result = await voidInvoice("inv-1", "oops");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.error).toBe("illegal_transition");
    expect(mockTx.invoice.update).not.toHaveBeenCalled();
  });

  it("appends to existing internal notes rather than overwriting them", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({
      id: "inv-1",
      status: "draft",
      internalNotes: "original note",
    });
    mockPrisma.journalEntry.findMany.mockResolvedValue([]);

    await voidInvoice("inv-1", "test data");

    const updateCall = mockTx.invoice.update.mock.calls[0][0];
    expect(updateCall.data.internalNotes).toContain("original note");
    expect(updateCall.data.internalNotes).toContain("test data");
  });
});

