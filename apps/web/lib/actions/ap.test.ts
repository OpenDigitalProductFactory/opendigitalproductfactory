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
import { createSupplier, listSuppliers } from "./ap";

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
