import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    invoice: { aggregate: vi.fn(), groupBy: vi.fn() },
    bill: { aggregate: vi.fn(), groupBy: vi.fn() },
    expenseClaim: { aggregate: vi.fn(), groupBy: vi.fn(), count: vi.fn() },
    orgSettings: { findFirst: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import { getFinancePeriodSummary, resolveFinancePeriod } from "./period-summary";

const mockPrisma = prisma as unknown as {
  invoice: { aggregate: ReturnType<typeof vi.fn>; groupBy: ReturnType<typeof vi.fn> };
  bill: { aggregate: ReturnType<typeof vi.fn>; groupBy: ReturnType<typeof vi.fn> };
  expenseClaim: {
    aggregate: ReturnType<typeof vi.fn>;
    groupBy: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  orgSettings: { findFirst: ReturnType<typeof vi.fn> };
};

function stubEmpty() {
  mockPrisma.invoice.aggregate.mockResolvedValue({
    _sum: { totalAmount: null, amountDue: null },
    _count: 0,
  });
  mockPrisma.bill.aggregate.mockResolvedValue({
    _sum: { totalAmount: null, amountDue: null },
    _count: 0,
  });
  mockPrisma.expenseClaim.aggregate.mockResolvedValue({
    _sum: { totalAmount: null },
    _count: 0,
  });
  mockPrisma.expenseClaim.count.mockResolvedValue(0);
  mockPrisma.invoice.groupBy.mockResolvedValue([]);
  mockPrisma.bill.groupBy.mockResolvedValue([]);
  mockPrisma.expenseClaim.groupBy.mockResolvedValue([]);
  mockPrisma.orgSettings.findFirst.mockResolvedValue({ baseCurrency: "USD" });
}

beforeEach(() => {
  vi.clearAllMocks();
  stubEmpty();
});

describe("resolveFinancePeriod", () => {
  const now = new Date("2026-05-14T12:00:00Z");

  it("defaults to month-to-date when no input is provided", () => {
    const window = resolveFinancePeriod({ now });
    expect(window.preset).toBe("month-to-date");
    expect(window.start.getFullYear()).toBe(now.getFullYear());
    expect(window.start.getMonth()).toBe(now.getMonth());
    expect(window.start.getDate()).toBe(1);
    expect(window.end.getTime()).toBe(now.getTime());
  });

  it("resolves last-month to the prior calendar month", () => {
    const window = resolveFinancePeriod({ period: "last-month", now });
    expect(window.preset).toBe("last-month");
    expect(window.start.getMonth()).toBe(3); // April (0-indexed)
    expect(window.start.getDate()).toBe(1);
    expect(window.end.getMonth()).toBe(3);
    expect(window.end.getDate()).toBe(30);
  });

  it("resolves quarter-to-date to the first day of the current quarter", () => {
    const window = resolveFinancePeriod({ period: "quarter-to-date", now });
    expect(window.preset).toBe("quarter-to-date");
    expect(window.start.getMonth()).toBe(3); // Apr is start of Q2
    expect(window.start.getDate()).toBe(1);
    expect(window.end.getTime()).toBe(now.getTime());
  });

  it("resolves year-to-date to Jan 1 of the current year", () => {
    const window = resolveFinancePeriod({ period: "year-to-date", now });
    expect(window.preset).toBe("year-to-date");
    expect(window.start.getMonth()).toBe(0);
    expect(window.start.getDate()).toBe(1);
    expect(window.start.getFullYear()).toBe(now.getFullYear());
  });

  it("accepts explicit startDate and endDate as a custom window", () => {
    const window = resolveFinancePeriod({
      startDate: "2026-01-15",
      endDate: "2026-03-31",
      now,
    });
    expect(window.preset).toBe("custom");
    expect(window.start.toISOString().startsWith("2026-01-15")).toBe(true);
    expect(window.end.toISOString().startsWith("2026-03-31")).toBe(true);
  });

  it("rejects an inverted custom window", () => {
    expect(() =>
      resolveFinancePeriod({ startDate: "2026-03-01", endDate: "2026-02-01", now }),
    ).toThrow(/endDate must be on or after startDate/);
  });

  it("rejects an invalid startDate", () => {
    expect(() =>
      resolveFinancePeriod({ startDate: "not-a-date", endDate: "2026-03-01", now }),
    ).toThrow(/Invalid startDate/);
  });
});

describe("getFinancePeriodSummary", () => {
  it("returns canonical income, expenses, and net from paid transactions", async () => {
    mockPrisma.invoice.aggregate.mockResolvedValueOnce({
      _sum: { totalAmount: "12000.00" },
      _count: 8,
    });
    mockPrisma.bill.aggregate.mockResolvedValueOnce({
      _sum: { totalAmount: "3200.00" },
      _count: 4,
    });
    mockPrisma.expenseClaim.aggregate.mockResolvedValueOnce({
      _sum: { totalAmount: "800.00" },
      _count: 5,
    });
    mockPrisma.invoice.aggregate.mockResolvedValueOnce({
      _sum: { amountDue: null },
      _count: 0,
    });
    mockPrisma.bill.aggregate.mockResolvedValueOnce({
      _sum: { amountDue: null },
      _count: 0,
    });
    mockPrisma.invoice.groupBy.mockResolvedValueOnce([{ currency: "USD" }]);
    mockPrisma.bill.groupBy.mockResolvedValueOnce([{ currency: "USD" }]);
    mockPrisma.expenseClaim.groupBy.mockResolvedValueOnce([{ currency: "USD" }]);

    const summary = await getFinancePeriodSummary({
      period: "month-to-date",
      now: new Date("2026-05-14T12:00:00Z"),
    });

    expect(summary.currency).toBe("USD");
    expect(summary.income.total).toBe(12000);
    expect(summary.income.count).toBe(8);
    expect(summary.expenses.total).toBe(4000);
    expect(summary.expenses.count).toBe(9);
    expect(summary.expenses.bills.total).toBe(3200);
    expect(summary.expenses.expenseClaims.total).toBe(800);
    expect(summary.net).toBe(8000);
    expect(summary.gaps).toEqual([]);
    expect(summary.verificationStatus).toBe("verified");
    expect(summary.sourceLanguage).toContain("Evidence:");
    expect(summary.sourceLanguage).toContain("Invoice.totalAmount");
    expect(summary.provenance.sources).toHaveLength(3);
  });

  it("flags zero-activity periods with a gap explanation", async () => {
    const summary = await getFinancePeriodSummary({
      period: "month-to-date",
      now: new Date("2026-05-14T12:00:00Z"),
    });

    expect(summary.income.total).toBe(0);
    expect(summary.expenses.total).toBe(0);
    expect(summary.net).toBe(0);
    expect(summary.gaps).toHaveLength(1);
    expect(summary.gaps[0]).toMatch(/No paid invoices, bills, or expense claims/);
    expect(summary.verificationStatus).toBe("no_current_data");
    expect(summary.sourceLanguage).toContain("no paid activity recorded yet");
    expect(summary.sourceLanguage).toContain("Caveats:");
  });

  it("flags partial gaps when only one side has activity", async () => {
    mockPrisma.invoice.aggregate.mockResolvedValueOnce({
      _sum: { totalAmount: "5000.00" },
      _count: 3,
    });

    const summary = await getFinancePeriodSummary({
      period: "month-to-date",
      now: new Date("2026-05-14T12:00:00Z"),
    });

    expect(summary.income.total).toBe(5000);
    expect(summary.expenses.total).toBe(0);
    expect(summary.gaps.some((g) => g.includes("expenses are zero"))).toBe(true);
    expect(summary.gaps.some((g) => g.includes("income is zero"))).toBe(false);
    expect(summary.verificationStatus).toBe("partial");
  });

  it("surfaces pending receivables and payables as separate signals", async () => {
    mockPrisma.invoice.aggregate.mockResolvedValueOnce({
      _sum: { totalAmount: "1000.00" },
      _count: 1,
    });
    mockPrisma.bill.aggregate.mockResolvedValueOnce({
      _sum: { totalAmount: "500.00" },
      _count: 1,
    });
    mockPrisma.expenseClaim.aggregate.mockResolvedValueOnce({
      _sum: { totalAmount: null },
      _count: 0,
    });
    mockPrisma.invoice.aggregate.mockResolvedValueOnce({
      _sum: { amountDue: "2500.00" },
      _count: 2,
    });
    mockPrisma.bill.aggregate.mockResolvedValueOnce({
      _sum: { amountDue: "800.00" },
      _count: 3,
    });
    mockPrisma.expenseClaim.count.mockResolvedValueOnce(2);

    const summary = await getFinancePeriodSummary({
      period: "month-to-date",
      now: new Date("2026-05-14T12:00:00Z"),
    });

    expect(summary.pending.receivables.total).toBe(2500);
    expect(summary.pending.receivables.count).toBe(2);
    expect(summary.pending.payables.total).toBe(800);
    expect(summary.pending.payables.count).toBe(3);
    expect(summary.pending.expenseClaims.count).toBe(2);
    expect(summary.gaps.some((g) => g.includes("still outstanding"))).toBe(true);
    expect(summary.gaps.some((g) => g.includes("still unpaid"))).toBe(true);
    expect(summary.gaps.some((g) => g.includes("awaiting approval"))).toBe(true);
  });

  it("flags multi-currency mixing without converting totals", async () => {
    mockPrisma.invoice.aggregate.mockResolvedValueOnce({
      _sum: { totalAmount: "1000.00" },
      _count: 1,
    });
    mockPrisma.invoice.groupBy.mockResolvedValueOnce([
      { currency: "USD" },
      { currency: "EUR" },
    ]);
    mockPrisma.bill.groupBy.mockResolvedValueOnce([{ currency: "USD" }]);

    const summary = await getFinancePeriodSummary({
      period: "month-to-date",
      now: new Date("2026-05-14T12:00:00Z"),
    });

    expect(summary.currencies.distinctCount).toBe(2);
    expect(summary.currencies.codes).toEqual(["EUR", "USD"]);
    expect(summary.gaps.some((g) => g.includes("span 2 currencies"))).toBe(true);
  });

  it("falls back to GBP when OrgSettings is missing", async () => {
    mockPrisma.orgSettings.findFirst.mockResolvedValueOnce(null);
    const summary = await getFinancePeriodSummary({
      period: "month-to-date",
      now: new Date("2026-05-14T12:00:00Z"),
    });
    expect(summary.currency).toBe("GBP");
  });
});
