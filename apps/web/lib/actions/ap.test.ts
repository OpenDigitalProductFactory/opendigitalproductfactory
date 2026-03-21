import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  can: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue({ messageId: "test-msg" }),
  composeApprovalEmail: vi.fn().mockReturnValue({
    to: "approver@example.com",
    subject: "Approval needed",
    text: "Please approve",
    html: "<p>Please approve</p>",
  }),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    supplier: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    bill: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    billLineItem: {},
    purchaseOrder: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    payment: { create: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    paymentAllocation: { create: vi.fn() },
    approvalRule: { findMany: vi.fn() },
    billApproval: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import {
  createSupplier,
  listSuppliers,
  createBill,
  submitBillForApproval,
  respondToBillApproval,
} from "./ap";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockCan = can as ReturnType<typeof vi.fn>;
const mockPrisma = prisma as unknown as {
  supplier: { create: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  bill: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  purchaseOrder: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  payment: { create: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  paymentAllocation: { create: ReturnType<typeof vi.fn> };
  approvalRule: { findMany: ReturnType<typeof vi.fn> };
  billApproval: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

function authorizedUser() {
  mockAuth.mockResolvedValue({
    user: { id: "user-001", platformRole: "HR-000", isSuperuser: false },
  });
  mockCan.mockReturnValue(true);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Supplier CRUD ────────────────────────────────────────────────────────────

describe("createSupplier", () => {
  it("throws Unauthorized when no session", async () => {
    mockAuth.mockResolvedValue(null);
    mockCan.mockReturnValue(false);
    await expect(
      createSupplier({ name: "Acme Ltd", paymentTerms: "Net 30", defaultCurrency: "GBP" }),
    ).rejects.toThrow("Unauthorized");
  });

  it("creates supplier with SUP- ref", async () => {
    authorizedUser();
    mockPrisma.supplier.create.mockResolvedValue({
      id: "sup-cuid-001",
      supplierId: "SUP-abc12345",
      name: "Acme Ltd",
    });

    const result = await createSupplier({ name: "Acme Ltd", paymentTerms: "Net 30", defaultCurrency: "GBP" });

    expect(mockPrisma.supplier.create).toHaveBeenCalledOnce();
    const callArgs = mockPrisma.supplier.create.mock.calls[0][0];
    expect(callArgs.data.supplierId).toMatch(/^SUP-/);
    expect(callArgs.data.name).toBe("Acme Ltd");
    expect(result).toEqual({ id: "sup-cuid-001", supplierId: "SUP-abc12345", name: "Acme Ltd" });
  });
});

describe("listSuppliers", () => {
  it("returns array of suppliers", async () => {
    authorizedUser();
    const fakeSuppliers = [
      { id: "sup-1", name: "Acme", supplierId: "SUP-0001" },
      { id: "sup-2", name: "Zeta Corp", supplierId: "SUP-0002" },
    ];
    mockPrisma.supplier.findMany.mockResolvedValue(fakeSuppliers);

    const result = await listSuppliers();
    expect(result).toEqual(fakeSuppliers);
    expect(mockPrisma.supplier.findMany).toHaveBeenCalledOnce();
  });

  it("throws Unauthorized when no session", async () => {
    mockAuth.mockResolvedValue(null);
    mockCan.mockReturnValue(false);
    await expect(listSuppliers()).rejects.toThrow("Unauthorized");
  });
});

// ─── Bill CRUD ────────────────────────────────────────────────────────────────

describe("createBill", () => {
  const validInput = {
    supplierId: "sup-001",
    issueDate: "2026-03-01",
    dueDate: "2026-04-01",
    currency: "GBP",
    lineItems: [
      { description: "Consulting", quantity: 2, unitPrice: 500, taxRate: 20 },
    ],
  };

  it("throws Unauthorized when no session", async () => {
    mockAuth.mockResolvedValue(null);
    mockCan.mockReturnValue(false);
    await expect(createBill(validInput)).rejects.toThrow("Unauthorized");
  });

  it("calculates totals correctly and creates bill", async () => {
    authorizedUser();
    mockPrisma.bill.count.mockResolvedValue(5);
    mockPrisma.bill.create.mockResolvedValue({
      id: "bill-001",
      billRef: "BILL-2026-0006",
      totalAmount: 1200,
    });

    const result = await createBill(validInput);

    expect(mockPrisma.bill.create).toHaveBeenCalledOnce();
    const callArgs = mockPrisma.bill.create.mock.calls[0][0];
    // quantity=2, unitPrice=500 => subtotal=1000, tax=20% of 1000=200, total=1200
    expect(callArgs.data.subtotal).toBe(1000);
    expect(callArgs.data.taxAmount).toBe(200);
    expect(callArgs.data.totalAmount).toBe(1200);
    expect(callArgs.data.amountDue).toBe(1200);
    expect(callArgs.data.billRef).toMatch(/^BILL-\d{4}-\d{4}$/);
    expect(result).toMatchObject({ id: "bill-001", billRef: "BILL-2026-0006" });
  });
});

// ─── Bill Approval ────────────────────────────────────────────────────────────

describe("submitBillForApproval", () => {
  it("creates approval records and updates bill status", async () => {
    authorizedUser();

    const fakeBill = {
      id: "bill-001",
      billRef: "BILL-2026-0001",
      totalAmount: 1200,
      status: "draft",
      currency: "GBP",
      supplier: { name: "Acme Ltd", email: "acme@example.com" },
    };
    const fakeRule = {
      id: "rule-001",
      approverId: "user-approver-001",
      approver: { id: "user-approver-001", email: "approver@example.com" },
    };

    mockPrisma.bill.findUnique.mockResolvedValue(fakeBill);
    mockPrisma.approvalRule.findMany.mockResolvedValue([fakeRule]);
    mockPrisma.billApproval.create.mockResolvedValue({ id: "approval-001", token: "token-abc" });
    mockPrisma.bill.update.mockResolvedValue({ ...fakeBill, status: "awaiting_approval" });

    await submitBillForApproval("bill-001");

    expect(mockPrisma.billApproval.create).toHaveBeenCalledOnce();
    expect(mockPrisma.bill.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "bill-001" },
        data: expect.objectContaining({ status: "awaiting_approval" }),
      }),
    );
  });
});

describe("respondToBillApproval", () => {
  it("marks approval as approved and updates bill to approved when all approved", async () => {
    const fakeApproval = {
      id: "approval-001",
      billId: "bill-001",
      approverId: "user-approver-001",
      status: "pending",
      token: "token-abc",
    };

    mockPrisma.billApproval.findUnique.mockResolvedValue(fakeApproval);
    mockPrisma.billApproval.update.mockResolvedValue({ ...fakeApproval, status: "approved" });
    mockPrisma.billApproval.findMany.mockResolvedValue([
      { ...fakeApproval, status: "approved" },
    ]);
    mockPrisma.bill.update.mockResolvedValue({ id: "bill-001", status: "approved" });

    await respondToBillApproval("token-abc", true);

    expect(mockPrisma.billApproval.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { token: "token-abc" },
        data: expect.objectContaining({ status: "approved" }),
      }),
    );
    expect(mockPrisma.bill.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "bill-001" },
        data: expect.objectContaining({ status: "approved" }),
      }),
    );
  });

  it("sets bill back to draft when rejected", async () => {
    const fakeApproval = {
      id: "approval-001",
      billId: "bill-001",
      approverId: "user-approver-001",
      status: "pending",
      token: "token-xyz",
    };

    mockPrisma.billApproval.findUnique.mockResolvedValue(fakeApproval);
    mockPrisma.billApproval.update.mockResolvedValue({ ...fakeApproval, status: "rejected" });
    mockPrisma.billApproval.findMany.mockResolvedValue([
      { ...fakeApproval, status: "rejected" },
    ]);
    mockPrisma.bill.update.mockResolvedValue({ id: "bill-001", status: "draft" });

    await respondToBillApproval("token-xyz", false, "Not approved");

    expect(mockPrisma.bill.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "bill-001" },
        data: expect.objectContaining({ status: "draft" }),
      }),
    );
  });
});
