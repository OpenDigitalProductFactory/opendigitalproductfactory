import { prisma } from "@dpf/db";

export async function getProfitAndLoss(startDate: Date, endDate: Date) {
  const [revenueResult, costResult, expenseResult] = await Promise.all([
    // Revenue: sum of totalAmount from paid invoices in period
    prisma.invoice.aggregate({
      where: { status: "paid", paidAt: { gte: startDate, lte: endDate } },
      _sum: { totalAmount: true },
      _count: true,
    }),
    // Cost of sales: sum of totalAmount from paid bills in period
    prisma.bill.aggregate({
      where: { status: "paid", updatedAt: { gte: startDate, lte: endDate } },
      _sum: { totalAmount: true },
      _count: true,
    }),
    // Expenses: sum of totalAmount from paid expense claims in period
    prisma.expenseClaim.aggregate({
      where: { status: "paid", paidAt: { gte: startDate, lte: endDate } },
      _sum: { totalAmount: true },
      _count: true,
    }),
  ]);

  const revenue = Number(revenueResult._sum.totalAmount ?? 0);
  const costOfSales = Number(costResult._sum.totalAmount ?? 0);
  const expenses = Number(expenseResult._sum.totalAmount ?? 0);
  const grossProfit = revenue - costOfSales;
  const netProfit = grossProfit - expenses;

  return {
    revenue,
    costOfSales,
    grossProfit,
    expenses,
    netProfit,
    invoiceCount: revenueResult._count,
    billCount: costResult._count,
    expenseCount: expenseResult._count,
  };
}

export async function getCashFlowReport(startDate: Date, endDate: Date) {
  const [inboundResult, outboundResult, bankBalances, inboundByMethod, outboundByMethod] = await Promise.all([
    prisma.payment.aggregate({
      where: { direction: "inbound", status: "completed", processedAt: { gte: startDate, lte: endDate } },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: { direction: "outbound", status: "completed", processedAt: { gte: startDate, lte: endDate } },
      _sum: { amount: true },
    }),
    prisma.bankAccount.aggregate({
      where: { status: "active" },
      _sum: { currentBalance: true },
    }),
    prisma.payment.groupBy({
      by: ["method"],
      where: { direction: "inbound", status: "completed", processedAt: { gte: startDate, lte: endDate } },
      _sum: { amount: true },
    }),
    prisma.payment.groupBy({
      by: ["method"],
      where: { direction: "outbound", status: "completed", processedAt: { gte: startDate, lte: endDate } },
      _sum: { amount: true },
    }),
  ]);

  const moneyIn = Number(inboundResult._sum.amount ?? 0);
  const moneyOut = Number(outboundResult._sum.amount ?? 0);
  const closingBalance = Number(bankBalances._sum.currentBalance ?? 0);

  return {
    moneyIn,
    moneyOut,
    netCashFlow: moneyIn - moneyOut,
    closingBalance,
    inboundBreakdown: inboundByMethod.map(g => ({ method: g.method, total: Number(g._sum.amount ?? 0) })),
    outboundBreakdown: outboundByMethod.map(g => ({ method: g.method, total: Number(g._sum.amount ?? 0) })),
  };
}

export async function getVatSummary(startDate: Date, endDate: Date) {
  const [outputResult, inputResult] = await Promise.all([
    prisma.invoice.aggregate({
      where: { status: "paid", paidAt: { gte: startDate, lte: endDate } },
      _sum: { taxAmount: true },
      _count: true,
    }),
    prisma.bill.aggregate({
      where: { status: "paid", updatedAt: { gte: startDate, lte: endDate } },
      _sum: { taxAmount: true },
      _count: true,
    }),
  ]);

  const outputVat = Number(outputResult._sum.taxAmount ?? 0);
  const inputVat = Number(inputResult._sum.taxAmount ?? 0);

  return {
    outputVat,
    inputVat,
    netVat: outputVat - inputVat,
    invoiceCount: outputResult._count,
    billCount: inputResult._count,
  };
}

export async function getRevenueByCustomer(startDate: Date, endDate: Date) {
  const invoices = await prisma.invoice.findMany({
    where: { paidAt: { gte: startDate, lte: endDate }, status: "paid" },
    select: { accountId: true, totalAmount: true, amountPaid: true, amountDue: true, account: { select: { name: true } } },
  });

  // Also get outstanding invoices for the same customers
  const allInvoices = await prisma.invoice.findMany({
    where: { accountId: { in: [...new Set(invoices.map(i => i.accountId))] }, status: { notIn: ["void", "written_off", "draft"] } },
    select: { accountId: true, totalAmount: true, amountPaid: true, amountDue: true, status: true, account: { select: { name: true } } },
  });

  const grouped = new Map<string, { name: string; invoiceCount: number; totalRevenue: number; totalPaid: number; totalOutstanding: number }>();
  for (const inv of allInvoices) {
    const existing = grouped.get(inv.accountId) ?? { name: inv.account.name, invoiceCount: 0, totalRevenue: 0, totalPaid: 0, totalOutstanding: 0 };
    existing.invoiceCount++;
    existing.totalRevenue += Number(inv.totalAmount);
    existing.totalPaid += Number(inv.amountPaid);
    existing.totalOutstanding += Number(inv.amountDue);
    grouped.set(inv.accountId, existing);
  }

  return Array.from(grouped.entries())
    .map(([accountId, data]) => ({ accountId, ...data }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);
}

export async function getOutstandingInvoicesReport() {
  const invoices = await prisma.invoice.findMany({
    where: { status: { in: ["sent", "viewed", "partially_paid", "overdue"] } },
    include: { account: { select: { name: true } } },
    orderBy: { dueDate: "asc" },
  });

  const now = new Date();
  return invoices.map(inv => ({
    id: inv.id,
    invoiceRef: inv.invoiceRef,
    accountName: inv.account.name,
    totalAmount: Number(inv.totalAmount),
    amountDue: Number(inv.amountDue),
    dueDate: inv.dueDate,
    daysOverdue: Math.max(0, Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86400000)),
    status: inv.status,
  }));
}

export function exportReportToCsv(headers: string[], rows: string[][]): string {
  const escape = (val: string) => val.includes(",") || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;
  const lines = [headers.map(escape).join(","), ...rows.map(row => row.map(escape).join(","))];
  return lines.join("\n");
}
