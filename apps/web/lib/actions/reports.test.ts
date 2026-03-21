import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    invoice: { aggregate: vi.fn(), findMany: vi.fn() },
    bill: { aggregate: vi.fn() },
    expenseClaim: { aggregate: vi.fn() },
    payment: { aggregate: vi.fn(), groupBy: vi.fn() },
    bankAccount: { aggregate: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import {
  getProfitAndLoss,
  getCashFlowReport,
  getVatSummary,
  getRevenueByCustomer,
  getOutstandingInvoicesReport,
  exportReportToCsv,
} from "./reports";

const mockPrisma = prisma as any;

const startDate = new Date("2026-01-01");
const endDate = new Date("2026-03-31");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getProfitAndLoss", () => {
  it("calculates grossProfit and netProfit from revenue, costs, and expenses", async () => {
    mockPrisma.invoice.aggregate.mockResolvedValue({ _sum: { totalAmount: "1000.00" }, _count: 5 });
    mockPrisma.bill.aggregate.mockResolvedValue({ _sum: { totalAmount: "400.00" }, _count: 3 });
    mockPrisma.expenseClaim.aggregate.mockResolvedValue({ _sum: { totalAmount: "100.00" }, _count: 2 });

    const result = await getProfitAndLoss(startDate, endDate);

    expect(result.revenue).toBe(1000);
    expect(result.costOfSales).toBe(400);
    expect(result.grossProfit).toBe(600);
    expect(result.expenses).toBe(100);
    expect(result.netProfit).toBe(500);
    expect(result.invoiceCount).toBe(5);
    expect(result.billCount).toBe(3);
    expect(result.expenseCount).toBe(2);
  });

  it("handles null sums gracefully (zero revenue period)", async () => {
    mockPrisma.invoice.aggregate.mockResolvedValue({ _sum: { totalAmount: null }, _count: 0 });
    mockPrisma.bill.aggregate.mockResolvedValue({ _sum: { totalAmount: null }, _count: 0 });
    mockPrisma.expenseClaim.aggregate.mockResolvedValue({ _sum: { totalAmount: null }, _count: 0 });

    const result = await getProfitAndLoss(startDate, endDate);

    expect(result.revenue).toBe(0);
    expect(result.grossProfit).toBe(0);
    expect(result.netProfit).toBe(0);
  });
});

describe("getCashFlowReport", () => {
  it("calculates netCashFlow from moneyIn and moneyOut", async () => {
    mockPrisma.payment.aggregate
      .mockResolvedValueOnce({ _sum: { amount: "2000.00" } }) // inbound
      .mockResolvedValueOnce({ _sum: { amount: "1500.00" } }); // outbound
    mockPrisma.bankAccount.aggregate.mockResolvedValue({ _sum: { currentBalance: "5000.00" } });
    mockPrisma.payment.groupBy
      .mockResolvedValueOnce([{ method: "bank_transfer", _sum: { amount: "2000.00" } }]) // inbound breakdown
      .mockResolvedValueOnce([{ method: "bank_transfer", _sum: { amount: "1500.00" } }]); // outbound breakdown

    const result = await getCashFlowReport(startDate, endDate);

    expect(result.moneyIn).toBe(2000);
    expect(result.moneyOut).toBe(1500);
    expect(result.netCashFlow).toBe(500);
    expect(result.closingBalance).toBe(5000);
    expect(result.inboundBreakdown).toEqual([{ method: "bank_transfer", total: 2000 }]);
    expect(result.outboundBreakdown).toEqual([{ method: "bank_transfer", total: 1500 }]);
  });

  it("handles null sums with zero defaults", async () => {
    mockPrisma.payment.aggregate
      .mockResolvedValueOnce({ _sum: { amount: null } })
      .mockResolvedValueOnce({ _sum: { amount: null } });
    mockPrisma.bankAccount.aggregate.mockResolvedValue({ _sum: { currentBalance: null } });
    mockPrisma.payment.groupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const result = await getCashFlowReport(startDate, endDate);

    expect(result.moneyIn).toBe(0);
    expect(result.moneyOut).toBe(0);
    expect(result.netCashFlow).toBe(0);
    expect(result.closingBalance).toBe(0);
  });
});

describe("getVatSummary", () => {
  it("calculates netVat from outputVat and inputVat", async () => {
    mockPrisma.invoice.aggregate.mockResolvedValue({ _sum: { taxAmount: "200.00" }, _count: 10 });
    mockPrisma.bill.aggregate.mockResolvedValue({ _sum: { taxAmount: "80.00" }, _count: 4 });

    const result = await getVatSummary(startDate, endDate);

    expect(result.outputVat).toBe(200);
    expect(result.inputVat).toBe(80);
    expect(result.netVat).toBe(120);
    expect(result.invoiceCount).toBe(10);
    expect(result.billCount).toBe(4);
  });

  it("handles null taxAmount sums", async () => {
    mockPrisma.invoice.aggregate.mockResolvedValue({ _sum: { taxAmount: null }, _count: 0 });
    mockPrisma.bill.aggregate.mockResolvedValue({ _sum: { taxAmount: null }, _count: 0 });

    const result = await getVatSummary(startDate, endDate);

    expect(result.outputVat).toBe(0);
    expect(result.inputVat).toBe(0);
    expect(result.netVat).toBe(0);
  });
});

describe("getRevenueByCustomer", () => {
  it("groups invoices by customer and sorts by totalRevenue descending", async () => {
    // First findMany: paid invoices in period (to identify relevant accounts)
    mockPrisma.invoice.findMany
      .mockResolvedValueOnce([
        { accountId: "acc-1", totalAmount: "500.00", amountPaid: "500.00", amountDue: "0.00", account: { name: "Acme Ltd" } },
        { accountId: "acc-2", totalAmount: "1500.00", amountPaid: "1500.00", amountDue: "0.00", account: { name: "BigCorp" } },
      ])
      // Second findMany: all non-void invoices for those accounts
      .mockResolvedValueOnce([
        { accountId: "acc-1", totalAmount: "500.00", amountPaid: "500.00", amountDue: "0.00", status: "paid", account: { name: "Acme Ltd" } },
        { accountId: "acc-2", totalAmount: "1500.00", amountPaid: "1500.00", amountDue: "0.00", status: "paid", account: { name: "BigCorp" } },
        { accountId: "acc-2", totalAmount: "200.00", amountPaid: "0.00", amountDue: "200.00", status: "sent", account: { name: "BigCorp" } },
      ]);

    const result = await getRevenueByCustomer(startDate, endDate);

    expect(result).toHaveLength(2);
    // BigCorp has higher totalRevenue (1700) so sorts first
    expect(result[0].accountId).toBe("acc-2");
    expect(result[0].name).toBe("BigCorp");
    expect(result[0].totalRevenue).toBe(1700);
    expect(result[0].totalOutstanding).toBe(200);
    expect(result[0].invoiceCount).toBe(2);
    // Acme second
    expect(result[1].accountId).toBe("acc-1");
    expect(result[1].totalRevenue).toBe(500);
  });

  it("returns empty array when no paid invoices in period", async () => {
    mockPrisma.invoice.findMany
      .mockResolvedValueOnce([]) // no paid invoices
      .mockResolvedValueOnce([]); // no all invoices

    const result = await getRevenueByCustomer(startDate, endDate);
    expect(result).toEqual([]);
  });
});

describe("getOutstandingInvoicesReport", () => {
  it("calculates daysOverdue correctly for overdue invoices", async () => {
    const pastDue = new Date("2026-01-01"); // well in the past
    mockPrisma.invoice.findMany.mockResolvedValue([
      {
        id: "inv-1",
        invoiceRef: "INV-001",
        totalAmount: "1000.00",
        amountDue: "1000.00",
        dueDate: pastDue,
        status: "overdue",
        account: { name: "Acme Ltd" },
      },
    ]);

    const result = await getOutstandingInvoicesReport();

    expect(result).toHaveLength(1);
    expect(result[0].invoiceRef).toBe("INV-001");
    expect(result[0].accountName).toBe("Acme Ltd");
    expect(result[0].totalAmount).toBe(1000);
    expect(result[0].amountDue).toBe(1000);
    expect(result[0].daysOverdue).toBeGreaterThan(0);
    expect(result[0].status).toBe("overdue");
  });

  it("returns daysOverdue of 0 for invoices not yet due", async () => {
    const futureDate = new Date(Date.now() + 30 * 86400000); // 30 days from now
    mockPrisma.invoice.findMany.mockResolvedValue([
      {
        id: "inv-2",
        invoiceRef: "INV-002",
        totalAmount: "500.00",
        amountDue: "500.00",
        dueDate: futureDate,
        status: "sent",
        account: { name: "FutureCo" },
      },
    ]);

    const result = await getOutstandingInvoicesReport();

    expect(result[0].daysOverdue).toBe(0);
  });
});

describe("exportReportToCsv", () => {
  it("produces correct CSV for basic data", () => {
    const csv = exportReportToCsv(["Item", "Amount"], [["Revenue", "1000.00"], ["Expenses", "400.00"]]);
    expect(csv).toBe("Item,Amount\nRevenue,1000.00\nExpenses,400.00");
  });

  it("escapes values containing commas", () => {
    const csv = exportReportToCsv(["Name", "Value"], [["Smith, John", "500.00"]]);
    expect(csv).toContain('"Smith, John"');
  });

  it("escapes values containing double quotes", () => {
    const csv = exportReportToCsv(["Description", "Amount"], [['Say "hello"', "100.00"]]);
    expect(csv).toContain('"Say ""hello"""');
  });

  it("handles empty rows", () => {
    const csv = exportReportToCsv(["Item", "Amount"], []);
    expect(csv).toBe("Item,Amount");
  });
});
