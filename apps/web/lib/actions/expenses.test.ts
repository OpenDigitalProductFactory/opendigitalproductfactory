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
  sendEmail: vi.fn().mockResolvedValue({ messageId: "test" }),
  composeExpenseApprovalEmail: vi.fn().mockReturnValue({
    to: "mgr@test.com",
    subject: "test",
    text: "test",
    html: "test",
  }),
}));

vi.mock("@/lib/org-identity", () => ({
  getOrgIdentity: vi.fn().mockResolvedValue(null),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    expenseClaim: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    employeeProfile: { findFirst: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import {
  createExpenseClaim,
  getExpenseClaim,
  listExpenseClaims,
  submitExpenseClaim,
  respondToExpenseApproval,
  markExpenseReimbursed,
} from "./expenses";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockCan = can as ReturnType<typeof vi.fn>;
const mockPrisma = prisma as unknown as {
  expenseClaim: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  employeeProfile: { findFirst: ReturnType<typeof vi.fn> };
  user: { findMany: ReturnType<typeof vi.fn> };
};

function authenticatedUser(id = "user-001") {
  mockAuth.mockResolvedValue({
    user: { id, platformRole: "HR-100", isSuperuser: false },
  });
}

function managerUser(id = "mgr-001") {
  mockAuth.mockResolvedValue({
    user: { id, platformRole: "HR-000", isSuperuser: false },
  });
  mockCan.mockReturnValue(true);
}

const validInput = {
  title: "March Expenses",
  currency: "USD",
  items: [
    {
      date: "2026-03-01",
      category: "travel" as const,
      description: "Train to London",
      amount: 45.5,
      currency: "USD",
      taxReclaimable: false,
      taxAmount: 0,
    },
    {
      date: "2026-03-02",
      category: "meals" as const,
      description: "Team lunch",
      amount: 32.0,
      currency: "USD",
      taxReclaimable: false,
      taxAmount: 0,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── createExpenseClaim ────────────────────────────────────────────────────────

describe("createExpenseClaim", () => {
  it("throws Unauthorized when no session", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(createExpenseClaim(validInput)).rejects.toThrow("Unauthorized");
  });

  it("throws when employee profile not found", async () => {
    authenticatedUser();
    mockPrisma.employeeProfile.findFirst.mockResolvedValue(null);
    await expect(createExpenseClaim(validInput)).rejects.toThrow("Employee profile not found");
  });

  it("creates claim with EXP- reference", async () => {
    authenticatedUser();
    mockPrisma.employeeProfile.findFirst.mockResolvedValue({ id: "emp-001" });
    mockPrisma.expenseClaim.count.mockResolvedValue(0);
    mockPrisma.expenseClaim.create.mockResolvedValue({
      id: "claim-cuid-001",
      claimId: "EXP-2026-0001",
      totalAmount: 77.5,
      items: [],
    });

    const result = await createExpenseClaim(validInput);

    expect(mockPrisma.expenseClaim.create).toHaveBeenCalledOnce();
    const callArgs = mockPrisma.expenseClaim.create.mock.calls[0][0];
    expect(callArgs.data.claimId).toMatch(/^EXP-\d{4}-\d{4}$/);
    expect(callArgs.data.employeeId).toBe("emp-001");
    expect(result).toMatchObject({ id: "claim-cuid-001", claimId: "EXP-2026-0001" });
  });

  it("calculates totalAmount as sum of item amounts", async () => {
    authenticatedUser();
    mockPrisma.employeeProfile.findFirst.mockResolvedValue({ id: "emp-001" });
    mockPrisma.expenseClaim.count.mockResolvedValue(5);
    mockPrisma.expenseClaim.create.mockResolvedValue({ id: "c1", claimId: "EXP-2026-0006", totalAmount: 77.5, items: [] });

    await createExpenseClaim(validInput);

    const callArgs = mockPrisma.expenseClaim.create.mock.calls[0][0];
    // 45.5 + 32.0 = 77.5
    expect(callArgs.data.totalAmount).toBe(77.5);
  });
});

// ─── listExpenseClaims ────────────────────────────────────────────────────────

describe("listExpenseClaims", () => {
  it("throws Unauthorized when no session", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(listExpenseClaims()).rejects.toThrow("Unauthorized");
  });

  it("filters by employee for non-manager users", async () => {
    authenticatedUser("user-002");
    mockCan.mockReturnValue(false);
    mockPrisma.employeeProfile.findFirst.mockResolvedValue({ id: "emp-002" });
    mockPrisma.expenseClaim.findMany.mockResolvedValue([]);

    await listExpenseClaims();

    const callArgs = mockPrisma.expenseClaim.findMany.mock.calls[0][0];
    expect(callArgs.where.employeeId).toBe("emp-002");
  });

  it("returns all claims for managers without employeeOnly filter", async () => {
    managerUser();
    mockPrisma.expenseClaim.findMany.mockResolvedValue([]);

    await listExpenseClaims();

    const callArgs = mockPrisma.expenseClaim.findMany.mock.calls[0][0];
    expect(callArgs.where.employeeId).toBeUndefined();
  });

  it("filters by status when provided", async () => {
    managerUser();
    mockPrisma.expenseClaim.findMany.mockResolvedValue([]);

    await listExpenseClaims({ status: "submitted" });

    const callArgs = mockPrisma.expenseClaim.findMany.mock.calls[0][0];
    expect(callArgs.where.status).toBe("submitted");
  });
});

// ─── submitExpenseClaim ───────────────────────────────────────────────────────

describe("submitExpenseClaim", () => {
  it("throws when claim not found", async () => {
    authenticatedUser();
    mockPrisma.expenseClaim.findUnique.mockResolvedValue(null);
    await expect(submitExpenseClaim("no-such-id")).rejects.toThrow("Expense claim not found");
  });

  it("generates an approvalToken and sets status to submitted", async () => {
    authenticatedUser("user-001");
    mockCan.mockReturnValue(false);
    mockPrisma.expenseClaim.findUnique.mockResolvedValue({
      id: "claim-001",
      claimId: "EXP-2026-0001",
      title: "March Expenses",
      currency: "USD",
      totalAmount: 77.5,
      employee: { id: "emp-001", displayName: "Alice Smith", workEmail: "alice@example.com", userId: "user-001" },
      _count: { items: 2 },
    });
    mockPrisma.user.findMany.mockResolvedValue([{ id: "mgr-001", email: "mgr@example.com" }]);
    mockPrisma.expenseClaim.update.mockResolvedValue({});

    await submitExpenseClaim("claim-001");

    expect(mockPrisma.expenseClaim.update).toHaveBeenCalledOnce();
    const updateArgs = mockPrisma.expenseClaim.update.mock.calls[0][0];
    expect(updateArgs.data.status).toBe("submitted");
    expect(updateArgs.data.approvalToken).toBeTruthy();
    expect(updateArgs.data.approvalToken).toHaveLength(32);
    expect(updateArgs.data.submittedAt).toBeInstanceOf(Date);
  });
});

// ─── respondToExpenseApproval ─────────────────────────────────────────────────

describe("respondToExpenseApproval", () => {
  it("throws when token not found", async () => {
    mockPrisma.expenseClaim.findUnique.mockResolvedValue(null);
    await expect(respondToExpenseApproval("bad-token", true)).rejects.toThrow("Approval not found");
  });

  it("sets status to approved when approved=true", async () => {
    mockPrisma.expenseClaim.findUnique.mockResolvedValue({ id: "claim-001", approvalToken: "token-abc" });
    mockPrisma.expenseClaim.update.mockResolvedValue({});

    await respondToExpenseApproval("token-abc", true);

    const updateArgs = mockPrisma.expenseClaim.update.mock.calls[0][0];
    expect(updateArgs.data.status).toBe("approved");
    expect(updateArgs.data.approvedAt).toBeInstanceOf(Date);
  });

  it("sets status to rejected and stores reason when approved=false", async () => {
    mockPrisma.expenseClaim.findUnique.mockResolvedValue({ id: "claim-001", approvalToken: "token-abc" });
    mockPrisma.expenseClaim.update.mockResolvedValue({});

    await respondToExpenseApproval("token-abc", false, "Missing receipts");

    const updateArgs = mockPrisma.expenseClaim.update.mock.calls[0][0];
    expect(updateArgs.data.status).toBe("rejected");
    expect(updateArgs.data.rejectedReason).toBe("Missing receipts");
  });
});

// ─── markExpenseReimbursed ────────────────────────────────────────────────────

describe("markExpenseReimbursed", () => {
  it("throws Unauthorized for non-managers", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-001", platformRole: "HR-100", isSuperuser: false } });
    mockCan.mockReturnValue(false);
    await expect(markExpenseReimbursed("claim-001")).rejects.toThrow("Unauthorized");
  });

  it("sets status to paid and paidAt for managers", async () => {
    managerUser();
    mockPrisma.expenseClaim.findUnique.mockResolvedValue({ id: "claim-001" });
    mockPrisma.expenseClaim.update.mockResolvedValue({});

    await markExpenseReimbursed("claim-001");

    const updateArgs = mockPrisma.expenseClaim.update.mock.calls[0][0];
    expect(updateArgs.data.status).toBe("paid");
    expect(updateArgs.data.paidAt).toBeInstanceOf(Date);
  });
});

// Any signed-in user could read any expense claim, and the detail page handed
// them its approvalToken — which respondToExpenseApproval accepts on its own,
// with no session check. So a colleague (or the claimant) could approve a claim
// they had no authority over (BI-D43F1516). getExpenseClaim is the chokepoint:
// listExpenseClaims already scopes by manage_finance, and this makes the single
// read agree with it.
describe("getExpenseClaim authorisation (BI-D43F1516)", () => {
  const claim = {
    id: "claim-1",
    employeeId: "emp-owner",
    status: "submitted",
    approvalToken: "tok-secret",
    items: [],
    employee: { id: "emp-owner", displayName: "Owner", workEmail: "owner@test.com" },
    approvedBy: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "user-other", platformRole: "member", isSuperuser: false } });
    mockPrisma.expenseClaim.findUnique.mockResolvedValue(claim);
  });

  it("does not give a non-finance colleague another employee's claim", async () => {
    mockCan.mockReturnValue(false);
    // The viewer has an employee profile, but it is not the claimant's.
    mockPrisma.employeeProfile.findFirst.mockResolvedValue({ id: "emp-other" });

    expect(await getExpenseClaim("claim-1")).toBeNull();
  });

  it("gives the claimant their own claim, but never the approval token", async () => {
    mockCan.mockReturnValue(false);
    mockPrisma.employeeProfile.findFirst.mockResolvedValue({ id: "emp-owner" });

    const result = await getExpenseClaim("claim-1");

    expect(result).not.toBeNull();
    expect(result?.id).toBe("claim-1");
    // The token is the approval capability. A claimant holding it could approve
    // their own claim through the storefront route.
    expect(result?.approvalToken).toBeNull();
  });

  it("gives a finance manager the claim with its token, so approval still works", async () => {
    mockCan.mockReturnValue(true);

    const result = await getExpenseClaim("claim-1");

    expect(result?.approvalToken).toBe("tok-secret");
    // A manager is not filtered to their own employee profile.
    expect(mockPrisma.employeeProfile.findFirst).not.toHaveBeenCalled();
  });

  it("returns null when a non-finance viewer has no employee profile at all", async () => {
    mockCan.mockReturnValue(false);
    mockPrisma.employeeProfile.findFirst.mockResolvedValue(null);

    expect(await getExpenseClaim("claim-1")).toBeNull();
  });
});
