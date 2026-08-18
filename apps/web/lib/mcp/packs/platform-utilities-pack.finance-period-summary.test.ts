import { afterEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    invoice: { aggregate: vi.fn(), groupBy: vi.fn() },
    bill: { aggregate: vi.fn(), groupBy: vi.fn() },
    expenseClaim: { aggregate: vi.fn(), groupBy: vi.fn(), count: vi.fn() },
    orgSettings: { findFirst: vi.fn() },
  },
}));

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
  DISCOVERY_TRIAGE_AGENT_ID: "discovery-triage",
}));

import { executeTool } from "@/lib/mcp-tools";

afterEach(() => {
  vi.clearAllMocks();
});

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

describe("get_finance_period_summary MCP tool", () => {
  it("returns a verdict message with totals when activity exists", async () => {
    stubEmpty();
    mockPrisma.invoice.aggregate.mockResolvedValueOnce({
      _sum: { totalAmount: "9000.00" },
      _count: 6,
    });
    mockPrisma.bill.aggregate.mockResolvedValueOnce({
      _sum: { totalAmount: "2500.00" },
      _count: 3,
    });
    mockPrisma.expenseClaim.aggregate.mockResolvedValueOnce({
      _sum: { totalAmount: "500.00" },
      _count: 2,
    });
    mockPrisma.invoice.aggregate.mockResolvedValueOnce({
      _sum: { amountDue: null },
      _count: 0,
    });
    mockPrisma.bill.aggregate.mockResolvedValueOnce({
      _sum: { amountDue: null },
      _count: 0,
    });

    const res = await executeTool("get_finance_period_summary", {}, "user_test");

    expect(res.success).toBe(true);
    expect(res.message).toMatch(/income 9000\.00 USD/);
    expect(res.message).toMatch(/expenses 3000\.00 USD/);
    expect(res.message).toMatch(/net 6000\.00 USD/);
    expect(res.message).toMatch(/Evidence:/);
    const data = res.data as {
      income: { total: number };
      expenses: { total: number };
      net: number;
      verificationStatus: string;
      sourceLanguage: string;
    };
    expect(data.income.total).toBe(9000);
    expect(data.expenses.total).toBe(3000);
    expect(data.net).toBe(6000);
    expect(data.verificationStatus).toBe("verified");
    expect(data.sourceLanguage).toContain("Invoice.totalAmount");
  });

  it("returns an explicit no-activity message when nothing is recorded", async () => {
    stubEmpty();
    const res = await executeTool("get_finance_period_summary", {}, "user_test");
    expect(res.success).toBe(true);
    expect(res.message).toMatch(/no paid activity recorded yet/);
    expect(res.message).toMatch(/Caveats:/);
    const data = res.data as { gaps: string[]; verificationStatus: string };
    expect(data.gaps.length).toBeGreaterThan(0);
    expect(data.verificationStatus).toBe("no_current_data");
  });

  it("accepts a preset period parameter", async () => {
    stubEmpty();
    const res = await executeTool(
      "get_finance_period_summary",
      { period: "year-to-date" },
      "user_test",
    );
    expect(res.success).toBe(true);
    const data = res.data as { period: { preset: string; label: string } };
    expect(data.period.preset).toBe("year-to-date");
    expect(data.period.label).toMatch(/Year-to-date/);
  });

  it("accepts a custom startDate/endDate window", async () => {
    stubEmpty();
    const res = await executeTool(
      "get_finance_period_summary",
      { startDate: "2026-01-01", endDate: "2026-03-31" },
      "user_test",
    );
    expect(res.success).toBe(true);
    const data = res.data as { period: { preset: string; start: string; end: string } };
    expect(data.period.preset).toBe("custom");
    expect(data.period.start.startsWith("2026-01-01")).toBe(true);
    expect(data.period.end.startsWith("2026-03-31")).toBe(true);
  });

  it("returns a structured error when the date window is invalid", async () => {
    stubEmpty();
    const res = await executeTool(
      "get_finance_period_summary",
      { startDate: "2026-04-01", endDate: "2026-02-01" },
      "user_test",
    );
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/endDate must be on or after startDate/);
  });
});
