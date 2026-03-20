import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ can: vi.fn() }));
vi.mock("@dpf/db", () => ({
  prisma: {
    invoice: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    payment: { create: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
    paymentAllocation: { create: vi.fn() },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { createInvoice, recordPayment, getInvoice, listInvoices, updateInvoiceStatus } from "./finance";

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
  currency: "GBP",
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
      recordPayment({ direction: "inbound", method: "bank_transfer", amount: 500, currency: "GBP" }),
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
      currency: "GBP",
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
      currency: "GBP",
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
      currency: "GBP",
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
      currency: "GBP",
      invoiceId: "inv-2",
    });

    const updateCall = mockPrisma.invoice.update.mock.calls[0][0];
    expect(Number(updateCall.data.amountDue)).toBe(0);
    expect(updateCall.data.status).toBe("paid");
    expect(updateCall.data.paidAt).toBeInstanceOf(Date);
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

// ─── updateInvoiceStatus ──────────────────────────────────────────────────────

describe("updateInvoiceStatus", () => {
  it("sets sentAt when transitioning to sent", async () => {
    mockPrisma.invoice.update.mockResolvedValue({});

    await updateInvoiceStatus("inv-1", "sent");

    const updateCall = mockPrisma.invoice.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe("sent");
    expect(updateCall.data.sentAt).toBeInstanceOf(Date);
  });

  it("sets voidedAt when transitioning to void", async () => {
    mockPrisma.invoice.update.mockResolvedValue({});

    await updateInvoiceStatus("inv-1", "void");

    const updateCall = mockPrisma.invoice.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe("void");
    expect(updateCall.data.voidedAt).toBeInstanceOf(Date);
  });

  it("sets paidAt when transitioning to paid", async () => {
    mockPrisma.invoice.update.mockResolvedValue({});

    await updateInvoiceStatus("inv-1", "paid");

    const updateCall = mockPrisma.invoice.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe("paid");
    expect(updateCall.data.paidAt).toBeInstanceOf(Date);
  });
});
