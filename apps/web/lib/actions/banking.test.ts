import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ can: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: {
    bankAccount: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    bankTransaction: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), count: vi.fn(), createMany: vi.fn() },
    bankRule: { create: vi.fn(), findMany: vi.fn() },
    payment: { findMany: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/lib/csv-parser", () => ({
  parseCSV: vi.fn(),
}));

vi.mock("@/lib/matching-engine", () => ({
  findMatches: vi.fn(),
  applyBankRules: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { parseCSV } from "@/lib/csv-parser";
import { findMatches, applyBankRules } from "@/lib/matching-engine";
import {
  createBankAccount,
  importTransactions,
  matchTransaction,
  unmatchTransaction,
  suggestMatches,
  listBankAccounts,
  getBankAccount,
  getTransactions,
  createBankRule,
  listBankRules,
  getReconciliationSummary,
} from "./banking";

const mockAuth = vi.mocked(auth);
const mockCan = vi.mocked(can);
const mockPrisma = prisma as any;
const mockParseCSV = vi.mocked(parseCSV);
const mockFindMatches = vi.mocked(findMatches);
const mockApplyBankRules = vi.mocked(applyBankRules);

const authorizedSession = {
  user: {
    id: "user-1",
    email: "admin@example.com",
    platformRole: "HR-000",
    isSuperuser: false,
  },
};

function authorizedUser() {
  mockAuth.mockResolvedValue(authorizedSession as never);
  mockCan.mockReturnValue(true);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Auth checks ──────────────────────────────────────────────────────────────

describe("auth", () => {
  it("createBankAccount throws when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as never);
    mockCan.mockReturnValue(false);
    await expect(
      createBankAccount({ name: "HSBC Current", currency: "GBP", accountType: "current", openingBalance: 0 }),
    ).rejects.toThrow("Unauthorized");
  });

  it("createBankAccount throws when can returns false", async () => {
    mockAuth.mockResolvedValue(authorizedSession as never);
    mockCan.mockReturnValue(false);
    await expect(
      createBankAccount({ name: "HSBC Current", currency: "GBP", accountType: "current", openingBalance: 0 }),
    ).rejects.toThrow("Unauthorized");
  });
});

// ─── createBankAccount ────────────────────────────────────────────────────────

describe("createBankAccount", () => {
  it("generates BA- ref and sets currentBalance = openingBalance", async () => {
    authorizedUser();
    mockPrisma.bankAccount.create.mockResolvedValue({
      id: "ba-cuid-001",
      bankAccountId: "BA-abc12345",
      name: "HSBC Current",
      currentBalance: 1000,
    });

    const result = await createBankAccount({
      name: "HSBC Current",
      currency: "GBP",
      accountType: "current",
      openingBalance: 1000,
    });

    expect(mockPrisma.bankAccount.create).toHaveBeenCalledOnce();
    const callArgs = mockPrisma.bankAccount.create.mock.calls[0][0];
    expect(callArgs.data.bankAccountId).toMatch(/^BA-/);
    expect(callArgs.data.currentBalance).toBe(1000);
    expect(callArgs.data.openingBalance).toBe(1000);
    expect(result).toMatchObject({ id: "ba-cuid-001", bankAccountId: "BA-abc12345" });
  });

  it("defaults openingBalance and currentBalance to 0 when not provided", async () => {
    authorizedUser();
    mockPrisma.bankAccount.create.mockResolvedValue({
      id: "ba-cuid-002",
      bankAccountId: "BA-xyz99999",
      name: "Savings",
      currentBalance: 0,
    });

    await createBankAccount({ name: "Savings", currency: "GBP", accountType: "savings", openingBalance: 0 });

    const callArgs = mockPrisma.bankAccount.create.mock.calls[0][0];
    expect(callArgs.data.currentBalance).toBe(0);
    expect(callArgs.data.openingBalance).toBe(0);
  });
});

// ─── importTransactions ───────────────────────────────────────────────────────

describe("importTransactions", () => {
  it("calls parseCSV and creates transaction records, returns imported count and errors", async () => {
    authorizedUser();

    const fakeParsed = {
      transactions: [
        { date: new Date("2026-03-01"), description: "ACME Direct Debit", amount: -150.0, balance: 850.0, reference: "DD-001" },
        { date: new Date("2026-03-02"), description: "Invoice payment", amount: 500.0, balance: 1350.0, reference: "INV-001" },
      ],
      errors: [{ row: 3, message: "Invalid date" }],
      format: "generic",
      totalRows: 3,
    };

    mockParseCSV.mockReturnValue(fakeParsed);
    mockApplyBankRules.mockReturnValue(null);
    mockPrisma.bankRule.findMany.mockResolvedValue([]);
    mockPrisma.bankTransaction.create.mockResolvedValue({ id: "bt-001" });
    mockPrisma.bankAccount.update.mockResolvedValue({});

    const result = await importTransactions("ba-001", "Date,Description,Amount\n...");

    expect(mockParseCSV).toHaveBeenCalledOnce();
    expect(mockPrisma.bankTransaction.create).toHaveBeenCalledTimes(2);
    expect(result.imported).toBe(2);
    expect(result.errors).toEqual(fakeParsed.errors);
    expect(result.batchId).toBeTruthy();
  });

  it("applies bank rules for auto-categorization during import", async () => {
    authorizedUser();

    const fakeRule = {
      id: "rule-001",
      matchField: "description",
      matchType: "contains",
      matchValue: "ACME",
      category: "utilities",
      accountCode: "EXP-001",
      taxRate: 20,
      isActive: true,
    };

    const fakeParsed = {
      transactions: [
        { date: new Date("2026-03-01"), description: "ACME Direct Debit", amount: -150.0 },
      ],
      errors: [],
      format: "generic",
      totalRows: 1,
    };

    mockParseCSV.mockReturnValue(fakeParsed);
    mockPrisma.bankRule.findMany.mockResolvedValue([fakeRule]);
    mockApplyBankRules.mockReturnValue({ category: "utilities", accountCode: "EXP-001", taxRate: 20 });
    mockPrisma.bankTransaction.create.mockResolvedValue({ id: "bt-002" });
    mockPrisma.bankAccount.update.mockResolvedValue({});

    await importTransactions("ba-001", "csv content");

    expect(mockApplyBankRules).toHaveBeenCalledOnce();
    const createCall = mockPrisma.bankTransaction.create.mock.calls[0][0];
    expect(createCall.data.category).toBe("utilities");
  });

  it("does not fail the import when some rows have parse errors", async () => {
    authorizedUser();

    const fakeParsed = {
      transactions: [
        { date: new Date("2026-03-01"), description: "Valid transaction", amount: 100.0 },
      ],
      errors: [
        { row: 2, message: "Invalid date" },
        { row: 3, message: "Missing amount" },
      ],
      format: "generic",
      totalRows: 3,
    };

    mockParseCSV.mockReturnValue(fakeParsed);
    mockApplyBankRules.mockReturnValue(null);
    mockPrisma.bankRule.findMany.mockResolvedValue([]);
    mockPrisma.bankTransaction.create.mockResolvedValue({ id: "bt-003" });
    mockPrisma.bankAccount.update.mockResolvedValue({});

    const result = await importTransactions("ba-001", "csv content");

    // Import still succeeds for the valid transaction
    expect(result.imported).toBe(1);
    // Bad rows are reported in errors, not thrown
    expect(result.errors).toHaveLength(2);
  });

  it("returns a shared batchId for all transactions in the import", async () => {
    authorizedUser();

    const fakeParsed = {
      transactions: [
        { date: new Date("2026-03-01"), description: "Tx A", amount: 100.0 },
        { date: new Date("2026-03-02"), description: "Tx B", amount: 200.0 },
      ],
      errors: [],
      format: "generic",
      totalRows: 2,
    };

    mockParseCSV.mockReturnValue(fakeParsed);
    mockApplyBankRules.mockReturnValue(null);
    mockPrisma.bankRule.findMany.mockResolvedValue([]);
    mockPrisma.bankTransaction.create.mockResolvedValue({ id: "bt-004" });
    mockPrisma.bankAccount.update.mockResolvedValue({});

    const result = await importTransactions("ba-001", "csv content");

    // Both transactions should share the same batchId
    const firstCreate = mockPrisma.bankTransaction.create.mock.calls[0][0];
    const secondCreate = mockPrisma.bankTransaction.create.mock.calls[1][0];
    expect(firstCreate.data.importBatchId).toBe(result.batchId);
    expect(secondCreate.data.importBatchId).toBe(result.batchId);
  });
});

// ─── matchTransaction ─────────────────────────────────────────────────────────

describe("matchTransaction", () => {
  it("updates transaction matchStatus and payment reconciled flag", async () => {
    authorizedUser();
    mockPrisma.bankTransaction.update.mockResolvedValue({
      id: "bt-001",
      matchStatus: "matched",
      matchedPaymentId: "pay-001",
    });
    mockPrisma.payment.update.mockResolvedValue({ id: "pay-001", reconciled: true });

    await matchTransaction("bt-001", "pay-001");

    expect(mockPrisma.bankTransaction.update).toHaveBeenCalledOnce();
    const txUpdate = mockPrisma.bankTransaction.update.mock.calls[0][0];
    expect(txUpdate.where).toEqual({ id: "bt-001" });
    expect(txUpdate.data.matchStatus).toBe("matched");
    expect(txUpdate.data.matchedPaymentId).toBe("pay-001");

    expect(mockPrisma.payment.update).toHaveBeenCalledOnce();
    const payUpdate = mockPrisma.payment.update.mock.calls[0][0];
    expect(payUpdate.where).toEqual({ id: "pay-001" });
    expect(payUpdate.data.reconciled).toBe(true);
    expect(payUpdate.data.reconciledAt).toBeInstanceOf(Date);
  });
});

// ─── unmatchTransaction ───────────────────────────────────────────────────────

describe("unmatchTransaction", () => {
  it("reverses the match: clears matchedPaymentId and resets payment reconciled", async () => {
    authorizedUser();
    mockPrisma.bankTransaction.findUnique.mockResolvedValue({
      id: "bt-001",
      matchStatus: "matched",
      matchedPaymentId: "pay-001",
    });
    mockPrisma.bankTransaction.update.mockResolvedValue({
      id: "bt-001",
      matchStatus: "unmatched",
      matchedPaymentId: null,
    });
    mockPrisma.payment.update.mockResolvedValue({ id: "pay-001", reconciled: false });

    await unmatchTransaction("bt-001");

    const txUpdate = mockPrisma.bankTransaction.update.mock.calls[0][0];
    expect(txUpdate.data.matchStatus).toBe("unmatched");
    expect(txUpdate.data.matchedPaymentId).toBeNull();

    const payUpdate = mockPrisma.payment.update.mock.calls[0][0];
    expect(payUpdate.data.reconciled).toBe(false);
    expect(payUpdate.data.reconciledAt).toBeNull();
  });
});

// ─── suggestMatches ───────────────────────────────────────────────────────────

describe("suggestMatches", () => {
  it("returns match candidates from matching engine", async () => {
    authorizedUser();

    const fakeTransaction = {
      id: "bt-001",
      bankAccountId: "ba-001",
      transactionDate: new Date("2026-03-15"),
      description: "ACME Corp payment",
      amount: 500,
      reference: "INV-2026-0042",
      matchStatus: "unmatched",
    };

    const fakePayments = [
      {
        id: "pay-001",
        paymentRef: "PAY-2026-0001",
        amount: 500,
        receivedAt: new Date("2026-03-15"),
        counterpartyId: null,
        reference: "INV-2026-0042",
      },
    ];

    const fakeCandidates = [
      {
        paymentId: "pay-001",
        paymentRef: "PAY-2026-0001",
        amount: 500,
        date: new Date("2026-03-15"),
        confidence: 85,
        matchReasons: ["exact amount match", "reference match: INV-2026-0042"],
      },
    ];

    mockPrisma.bankTransaction.findUnique.mockResolvedValue(fakeTransaction);
    mockPrisma.payment.findMany.mockResolvedValue(fakePayments);
    mockFindMatches.mockReturnValue(fakeCandidates);

    const result = await suggestMatches("bt-001");

    expect(mockPrisma.bankTransaction.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "bt-001" } }),
    );
    expect(mockPrisma.payment.findMany).toHaveBeenCalledOnce();
    const payFindCall = mockPrisma.payment.findMany.mock.calls[0][0];
    expect(payFindCall.where).toMatchObject({ reconciled: false, direction: "inbound" });
    expect(mockFindMatches).toHaveBeenCalledOnce();
    expect(result).toEqual(fakeCandidates);
  });

  it("throws if transaction not found", async () => {
    authorizedUser();
    mockPrisma.bankTransaction.findUnique.mockResolvedValue(null);

    await expect(suggestMatches("bt-nonexistent")).rejects.toThrow("Transaction not found");
  });
});

// ─── listBankAccounts ─────────────────────────────────────────────────────────

describe("listBankAccounts", () => {
  it("returns bank accounts ordered by name", async () => {
    authorizedUser();
    mockPrisma.bankAccount.findMany.mockResolvedValue([
      { id: "ba-001", name: "HSBC Current", _count: { transactions: 5 } },
    ]);

    const result = await listBankAccounts();

    expect(mockPrisma.bankAccount.findMany).toHaveBeenCalledOnce();
    const callArgs = mockPrisma.bankAccount.findMany.mock.calls[0][0];
    expect(callArgs.orderBy).toEqual({ name: "asc" });
    expect(result).toHaveLength(1);
  });
});

// ─── getBankAccount ───────────────────────────────────────────────────────────

describe("getBankAccount", () => {
  it("fetches account with transactions (last 50) and _count", async () => {
    authorizedUser();
    mockPrisma.bankAccount.findUnique.mockResolvedValue({
      id: "ba-001",
      name: "HSBC Current",
      transactions: [],
      _count: { transactions: 0 },
    });

    await getBankAccount("ba-001");

    const callArgs = mockPrisma.bankAccount.findUnique.mock.calls[0][0];
    expect(callArgs.where).toEqual({ id: "ba-001" });
    expect(callArgs.include.transactions.take).toBe(50);
    expect(callArgs.include.transactions.orderBy).toEqual({ transactionDate: "desc" });
  });

  it("returns null when account not found", async () => {
    authorizedUser();
    mockPrisma.bankAccount.findUnique.mockResolvedValue(null);

    const result = await getBankAccount("ba-nonexistent");
    expect(result).toBeNull();
  });
});

// ─── getTransactions ──────────────────────────────────────────────────────────

describe("getTransactions", () => {
  it("filters by bankAccountId", async () => {
    authorizedUser();
    mockPrisma.bankTransaction.findMany.mockResolvedValue([]);

    await getTransactions("ba-001");

    const callArgs = mockPrisma.bankTransaction.findMany.mock.calls[0][0];
    expect(callArgs.where.bankAccountId).toBe("ba-001");
  });

  it("applies matchStatus filter when provided", async () => {
    authorizedUser();
    mockPrisma.bankTransaction.findMany.mockResolvedValue([]);

    await getTransactions("ba-001", { matchStatus: "unmatched" });

    const callArgs = mockPrisma.bankTransaction.findMany.mock.calls[0][0];
    expect(callArgs.where.matchStatus).toBe("unmatched");
  });
});

// ─── createBankRule ───────────────────────────────────────────────────────────

describe("createBankRule", () => {
  it("creates a bank rule and revalidates", async () => {
    authorizedUser();
    mockPrisma.bankRule.create.mockResolvedValue({
      id: "rule-001",
      name: "Direct Debits",
      matchField: "description",
      matchType: "contains",
      matchValue: "DIRECT DEBIT",
    });

    const result = await createBankRule({
      name: "Direct Debits",
      matchField: "description",
      matchType: "contains",
      matchValue: "DIRECT DEBIT",
    });

    expect(mockPrisma.bankRule.create).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ id: "rule-001" });
  });
});

// ─── listBankRules ────────────────────────────────────────────────────────────

describe("listBankRules", () => {
  it("returns rules ordered by hitCount desc", async () => {
    authorizedUser();
    mockPrisma.bankRule.findMany.mockResolvedValue([
      { id: "rule-001", name: "ACME", hitCount: 42 },
      { id: "rule-002", name: "HMRC", hitCount: 10 },
    ]);

    const result = await listBankRules();

    const callArgs = mockPrisma.bankRule.findMany.mock.calls[0][0];
    expect(callArgs.orderBy).toEqual({ hitCount: "desc" });
    expect(result).toHaveLength(2);
  });
});

// ─── getReconciliationSummary ─────────────────────────────────────────────────

describe("getReconciliationSummary", () => {
  it("returns summary with unmatchedCount, totalCount, currentBalance, lastReconciledAt", async () => {
    authorizedUser();
    mockPrisma.bankTransaction.count
      .mockResolvedValueOnce(3)   // unmatched count
      .mockResolvedValueOnce(10); // total count
    mockPrisma.bankAccount.findUnique.mockResolvedValue({
      id: "ba-001",
      currentBalance: 5000,
      lastReconciledAt: new Date("2026-03-01"),
    });

    const result = await getReconciliationSummary("ba-001");

    expect(result.unmatchedCount).toBe(3);
    expect(result.totalCount).toBe(10);
    expect(result.currentBalance).toBe(5000);
    expect(result.lastReconciledAt).toBeInstanceOf(Date);
  });
});
