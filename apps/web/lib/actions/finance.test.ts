import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ can: vi.fn() }));
// Transaction client for actions that write inside prisma.$transaction; the mock
// is given the callback and simply hands back this client.
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
import {
  createInvoice,
  recordPayment,
  getInvoice,
  listInvoices,
  generateInvoiceFromSalesOrder,
  sendInvoice,
  getInvoiceByPayToken,
  signInvoice,
  setInvoiceSignatureRequired,
} from "./finance";

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

// ─── Auth checks ─────────────────────────────────────────────────────────────

describe("auth", () => {
  it("createInvoice throws when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as never);
    await expect(createInvoice(baseInvoiceInput)).rejects.toThrow("Unauthorized");
  });

  it("createInvoice throws when unauthorized (can returns false)", async () => {
    mockCan.mockReturnValue(false);
    await expect(createInvoice(baseInvoiceInput)).rejects.toThrow("Unauthorized");
  });

  it("recordPayment throws when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as never);
    await expect(
      recordPayment({ direction: "inbound", method: "bank_transfer", amount: 500, currency: "USD" }),
    ).rejects.toThrow("Unauthorized");
  });
});

// ─── Total calculation ────────────────────────────────────────────────────────

describe("createInvoice total calculation", () => {
  it("calculates totals correctly with two line items at different tax rates", async () => {
    // Line 1: qty=2, unitPrice=100, taxRate=20%, discountPercent=10%
    //   lineSubtotal = 2 * 100 = 200
    //   lineDiscount = 200 * 0.10 = 20
    //   lineAfterDiscount = 180
    //   lineTax = 180 * 0.20 = 36
    //   lineTotal = 180 + 36 = 216
    //
    // Line 2: qty=5, unitPrice=50, taxRate=5%, discountPercent=0%
    //   lineSubtotal = 5 * 50 = 250
    //   lineDiscount = 0
    //   lineAfterDiscount = 250
    //   lineTax = 250 * 0.05 = 12.50
    //   lineTotal = 262.50
    //
    // subtotal = 200 + 250 = 450
    // discountAmount = 20 + 0 = 20
    // taxAmount = 36 + 12.50 = 48.50
    // totalAmount = 216 + 262.50 = 478.50

    const input = {
      accountId: "acc-1",
      type: "standard" as const,
      dueDate: "2026-04-30",
      currency: "USD",
      lineItems: [
        { description: "Item A", quantity: 2, unitPrice: 100, taxRate: 20, discountPercent: 10 },
        { description: "Item B", quantity: 5, unitPrice: 50, taxRate: 5, discountPercent: 0 },
      ],
    };

    mockPrisma.invoice.count.mockResolvedValue(10);
    mockPrisma.invoice.create.mockResolvedValue({ id: "inv-1", invoiceRef: "INV-2026-0011" });

    await createInvoice(input);

    expect(mockPrisma.invoice.create).toHaveBeenCalledOnce();
    const createCall = mockPrisma.invoice.create.mock.calls[0][0];
    const data = createCall.data;

    expect(Number(data.subtotal)).toBe(450);
    expect(Number(data.discountAmount)).toBe(20);
    expect(Number(data.taxAmount)).toBe(48.5);
    expect(Number(data.totalAmount)).toBe(478.5);
    expect(Number(data.amountDue)).toBe(478.5);
  });
});

// ─── Sequential ref generation ───────────────────────────────────────────────

describe("createInvoice sequential ref generation", () => {
  it("generates INV-2026-0042 when invoice count is 41", async () => {
    mockPrisma.invoice.count.mockResolvedValue(41);
    mockPrisma.invoice.create.mockResolvedValue({ id: "inv-42", invoiceRef: "INV-2026-0042" });

    await createInvoice(baseInvoiceInput);

    const createCall = mockPrisma.invoice.create.mock.calls[0][0];
    expect(createCall.data.invoiceRef).toBe("INV-2026-0042");
  });

  it("uses the current year in the ref", async () => {
    mockPrisma.invoice.count.mockResolvedValue(0);
    mockPrisma.invoice.create.mockResolvedValue({ id: "inv-1", invoiceRef: "INV-2026-0001" });

    await createInvoice(baseInvoiceInput);

    const createCall = mockPrisma.invoice.create.mock.calls[0][0];
    const year = new Date().getFullYear();
    expect(createCall.data.invoiceRef).toBe(`INV-${year}-0001`);
  });
});

// ─── recordPayment ───────────────────────────────────────────────────────────

describe("recordPayment", () => {
  it("creates payment without invoice allocation when no invoiceId", async () => {
    mockPrisma.payment.count.mockResolvedValue(5);
    mockPrisma.payment.create.mockResolvedValue({ id: "pay-1", paymentRef: "PAY-2026-0006" });

    await recordPayment({
      direction: "inbound",
      method: "bank_transfer",
      amount: 500,
      currency: "USD",
    });

    expect(mockPrisma.payment.create).toHaveBeenCalledOnce();
    expect(mockPrisma.paymentAllocation.create).not.toHaveBeenCalled();
    expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
  });

  it("creates payment with allocation and updates invoice amountPaid/amountDue when invoiceId provided", async () => {
    mockPrisma.payment.count.mockResolvedValue(0);
    mockPrisma.payment.create.mockResolvedValue({ id: "pay-1", paymentRef: "PAY-2026-0001" });
    mockPrisma.invoice.findUnique.mockResolvedValue({
      id: "inv-1",
      totalAmount: 1000,
      amountPaid: 0,
    });
    mockPrisma.paymentAllocation.create.mockResolvedValue({});
    mockPrisma.invoice.update.mockResolvedValue({});

    await recordPayment({
      direction: "inbound",
      method: "bank_transfer",
      amount: 600,
      currency: "USD",
      invoiceId: "inv-1",
    });

    expect(mockPrisma.paymentAllocation.create).toHaveBeenCalledOnce();

    const updateCall = mockPrisma.invoice.update.mock.calls[0][0];
    expect(Number(updateCall.data.amountPaid)).toBe(600);
    expect(Number(updateCall.data.amountDue)).toBe(400);
    expect(updateCall.data.status).toBe("partially_paid");
  });

  it("marks invoice as paid and sets paidAt when amountDue becomes 0", async () => {
    mockPrisma.payment.count.mockResolvedValue(0);
    mockPrisma.payment.create.mockResolvedValue({ id: "pay-2", paymentRef: "PAY-2026-0001" });
    mockPrisma.invoice.findUnique.mockResolvedValue({
      id: "inv-2",
      totalAmount: 500,
      amountPaid: 0,
    });
    mockPrisma.paymentAllocation.create.mockResolvedValue({});
    mockPrisma.invoice.update.mockResolvedValue({});

    await recordPayment({
      direction: "inbound",
      method: "card",
      amount: 500,
      currency: "USD",
      invoiceId: "inv-2",
    });

    const updateCall = mockPrisma.invoice.update.mock.calls[0][0];
    expect(Number(updateCall.data.amountDue)).toBe(0);
    expect(updateCall.data.status).toBe("paid");
    expect(updateCall.data.paidAt).toBeInstanceOf(Date);
  });

  it("allocates outbound payments to bills and marks owner-entered bills paid", async () => {
    mockPrisma.payment.count.mockResolvedValue(18);
    mockPrisma.payment.create.mockResolvedValue({
      id: "pay-claude",
      paymentRef: "PAY-2026-0019",
    });
    mockPrisma.paymentAllocation.create.mockResolvedValue({ id: "alloc-claude" });
    mockPrisma.bill.findUnique.mockResolvedValue({
      id: "bill-claude",
      totalAmount: 20,
      amountPaid: 0,
    });
    mockPrisma.bill.update.mockResolvedValue({
      id: "bill-claude",
      status: "paid",
      amountDue: 0,
    });

    await recordPayment({
      direction: "outbound",
      method: "card",
      amount: 20,
      currency: "USD",
      billId: "bill-claude",
      reference: "Claude card charge",
      receivedAt: "2026-06-19",
    } as any);

    expect(mockPrisma.paymentAllocation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentId: "pay-claude",
          billId: "bill-claude",
          amount: 20,
        }),
      }),
    );
    expect(mockPrisma.bill.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "bill-claude" },
        data: expect.objectContaining({
          status: "paid",
          amountPaid: 20,
          amountDue: 0,
        }),
      }),
    );
  });
});

// ─── getInvoice ───────────────────────────────────────────────────────────────

describe("getInvoice", () => {
  it("fetches invoice with expected includes", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ id: "inv-1", invoiceRef: "INV-2026-0001" });

    const result = await getInvoice("inv-1");

    expect(mockPrisma.invoice.findUnique).toHaveBeenCalledOnce();
    const findCall = mockPrisma.invoice.findUnique.mock.calls[0][0];
    expect(findCall.where).toEqual({ id: "inv-1" });
    expect(findCall.include).toHaveProperty("lineItems");
    expect(findCall.include).toHaveProperty("account");
    expect(findCall.include).toHaveProperty("contact");
    expect(findCall.include).toHaveProperty("allocations");
    expect(findCall.include).toHaveProperty("createdBy");
    expect(result).not.toBeNull();
  });

  it("returns null when invoice not found", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(null);

    const result = await getInvoice("nonexistent");

    expect(result).toBeNull();
  });
});

// ─── listInvoices ─────────────────────────────────────────────────────────────

describe("listInvoices", () => {
  it("lists all invoices without filters", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([]);

    await listInvoices();

    expect(mockPrisma.invoice.findMany).toHaveBeenCalledOnce();
  });

  it("applies status filter when provided", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([]);

    await listInvoices({ status: "draft" });

    const findCall = mockPrisma.invoice.findMany.mock.calls[0][0];
    expect(findCall.where?.status).toBe("draft");
  });

  it("applies accountId filter when provided", async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([]);

    await listInvoices({ accountId: "acc-999" });

    const findCall = mockPrisma.invoice.findMany.mock.calls[0][0];
    expect(findCall.where?.accountId).toBe("acc-999");
  });
});

// ─── generateInvoiceFromSalesOrder ────────────────────────────────────────────

describe("generateInvoiceFromSalesOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      user: { id: "user1", platformRole: "HR-000", isSuperuser: true },
      expires: "",
    } as never);
    mockCan.mockReturnValue(true);
  });

  it("skips if invoice already exists for this source (idempotent)", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({ id: "existing" } as never);

    const result = await generateInvoiceFromSalesOrder("so-1");
    expect(result).toEqual({ id: "existing" });
    expect(mockPrisma.salesOrder.findUnique).not.toHaveBeenCalled();
  });

  it("throws if sales order not found", async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue(null);
    mockPrisma.salesOrder.findUnique.mockResolvedValue(null);

    await expect(generateInvoiceFromSalesOrder("so-404")).rejects.toThrow("Sales order not found");
  });
});

// ─── sendInvoice ──────────────────────────────────────────────────────────────

describe("sendInvoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      user: { id: "user1", platformRole: "HR-000", isSuperuser: true },
      expires: "",
    } as never);
    mockCan.mockReturnValue(true);
  });

  it("generates payToken and updates status to sent", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ id: "inv1", payToken: null, status: "draft" } as never);
    mockPrisma.invoice.update.mockResolvedValue({} as never);

    const result = await sendInvoice("inv1");
    expect(result.payToken).toBeTruthy();
    expect(result.payToken.length).toBe(32);
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "sent" }),
      }),
    );
  });

  it("reuses existing payToken", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ id: "inv1", payToken: "existing-token", status: "draft" } as never);
    mockPrisma.invoice.update.mockResolvedValue({} as never);

    const result = await sendInvoice("inv1");
    expect(result.payToken).toBe("existing-token");
  });
});

// ─── getInvoiceByPayToken ─────────────────────────────────────────────────────

describe("getInvoiceByPayToken", () => {
  it("returns invoice for valid token", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ id: "inv1", invoiceRef: "INV-2026-0001" } as never);

    const result = await getInvoiceByPayToken("valid-token");
    expect(result?.id).toBe("inv1");
  });

  it("returns null for invalid token", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(null);

    const result = await getInvoiceByPayToken("bad-token");
    expect(result).toBeNull();
  });
});

// ─── signInvoice (public, payToken-authorized) ────────────────────────────────

describe("signInvoice", () => {
  const validInput = {
    token: "tok_abc",
    signedByName: "Jane Client",
    signedByEmail: "jane@client.com",
    signatureDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAterminate=",
  };

  it("records the signature when required and not yet signed", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({
      id: "inv1",
      signatureRequired: true,
      signedAt: null,
    } as never);
    mockPrisma.invoice.update.mockResolvedValue({} as never);

    const result = await signInvoice(validInput);

    expect(result).toEqual({ ok: true });
    const updateCall = mockPrisma.invoice.update.mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: "inv1" });
    expect(updateCall.data.signedByName).toBe("Jane Client");
    expect(updateCall.data.signedByEmail).toBe("jane@client.com");
    expect(updateCall.data.signatureDataUrl).toBe(validInput.signatureDataUrl);
    expect(updateCall.data.signedAt).toBeInstanceOf(Date);
  });

  it("is idempotent — already-signed invoice does not write again", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({
      id: "inv1",
      signatureRequired: true,
      signedAt: new Date(),
    } as never);

    const result = await signInvoice(validInput);

    expect(result).toEqual({ ok: true });
    expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
  });

  it("rejects when the invoice does not require a signature", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({
      id: "inv1",
      signatureRequired: false,
      signedAt: null,
    } as never);

    await expect(signInvoice(validInput)).rejects.toThrow(/does not require a signature/);
    expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
  });

  it("rejects when the token matches no invoice", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(null);

    await expect(signInvoice(validInput)).rejects.toThrow(/not found/);
  });

  it("rejects an invalid signature payload (not an image data URL)", async () => {
    await expect(
      signInvoice({ ...validInput, signatureDataUrl: "not-an-image" }),
    ).rejects.toThrow();
    expect(mockPrisma.invoice.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a missing signer name", async () => {
    await expect(signInvoice({ ...validInput, signedByName: "" })).rejects.toThrow();
  });
});

// ─── setInvoiceSignatureRequired (admin) ──────────────────────────────────────

describe("setInvoiceSignatureRequired", () => {
  it("throws when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as never);
    await expect(setInvoiceSignatureRequired("inv1", true)).rejects.toThrow("Unauthorized");
  });

  it("updates the flag on an unsigned invoice", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({ id: "inv1", signedAt: null } as never);
    mockPrisma.invoice.update.mockResolvedValue({} as never);

    await setInvoiceSignatureRequired("inv1", true);

    const updateCall = mockPrisma.invoice.update.mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: "inv1" });
    expect(updateCall.data.signatureRequired).toBe(true);
  });

  it("refuses to change the requirement after the invoice is signed", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({
      id: "inv1",
      signedAt: new Date(),
    } as never);

    await expect(setInvoiceSignatureRequired("inv1", false)).rejects.toThrow(
      /after the invoice has been signed/,
    );
    expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
  });

  it("throws when the invoice is not found", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(null);
    await expect(setInvoiceSignatureRequired("missing", true)).rejects.toThrow("Invoice not found");
  });
});
