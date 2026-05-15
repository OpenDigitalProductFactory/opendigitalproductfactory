import { prisma } from "@dpf/db";

export type FinancePeriodPreset =
  | "month-to-date"
  | "last-month"
  | "quarter-to-date"
  | "year-to-date";

export type FinancePeriodInput = {
  period?: FinancePeriodPreset;
  startDate?: string;
  endDate?: string;
  now?: Date;
};

export type FinancePeriodWindow = {
  preset: FinancePeriodPreset | "custom";
  label: string;
  start: Date;
  end: Date;
};

/**
 * Resolve a finance period input into a concrete [start, end] window.
 *
 * `now` is injectable so tests are deterministic without freezing the global clock.
 */
export function resolveFinancePeriod(input: FinancePeriodInput = {}): FinancePeriodWindow {
  const now = input.now ?? new Date();

  if (input.startDate || input.endDate) {
    const start = input.startDate ? new Date(input.startDate) : startOfMonth(now);
    const end = input.endDate ? new Date(input.endDate) : now;
    if (Number.isNaN(start.getTime())) {
      throw new Error(`Invalid startDate: ${input.startDate}`);
    }
    if (Number.isNaN(end.getTime())) {
      throw new Error(`Invalid endDate: ${input.endDate}`);
    }
    if (end < start) {
      throw new Error("endDate must be on or after startDate");
    }
    return {
      preset: "custom",
      label: `${formatIsoDate(start)} to ${formatIsoDate(end)}`,
      start,
      end,
    };
  }

  const preset: FinancePeriodPreset = input.period ?? "month-to-date";

  switch (preset) {
    case "month-to-date": {
      return {
        preset,
        label: `Month-to-date (${formatIsoDate(startOfMonth(now))} to ${formatIsoDate(now)})`,
        start: startOfMonth(now),
        end: now,
      };
    }
    case "last-month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = endOfMonth(start);
      return {
        preset,
        label: `Last month (${formatIsoDate(start)} to ${formatIsoDate(end)})`,
        start,
        end,
      };
    }
    case "quarter-to-date": {
      const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
      const start = new Date(now.getFullYear(), quarterStartMonth, 1);
      return {
        preset,
        label: `Quarter-to-date (${formatIsoDate(start)} to ${formatIsoDate(now)})`,
        start,
        end: now,
      };
    }
    case "year-to-date": {
      const start = new Date(now.getFullYear(), 0, 1);
      return {
        preset,
        label: `Year-to-date (${formatIsoDate(start)} to ${formatIsoDate(now)})`,
        start,
        end: now,
      };
    }
  }
}

export type FinancePeriodComponent = {
  total: number;
  count: number;
  source: string;
};

export type FinancePeriodVerificationStatus = "verified" | "partial" | "no_current_data";

export type FinancePeriodSummary = {
  period: { preset: string; label: string; start: string; end: string };
  currency: string;
  income: FinancePeriodComponent;
  expenses: {
    total: number;
    count: number;
    bills: FinancePeriodComponent;
    expenseClaims: FinancePeriodComponent;
  };
  net: number;
  pending: {
    receivables: { total: number; count: number; source: string };
    payables: { total: number; count: number; source: string };
    expenseClaims: { count: number; source: string };
  };
  currencies: { distinctCount: number; codes: string[] };
  gaps: string[];
  verificationStatus: FinancePeriodVerificationStatus;
  sourceLanguage: string;
  provenance: {
    description: string;
    sources: string[];
    notes: string[];
  };
};

/**
 * Aggregate canonical finance data for a period into income, expenses, and net.
 *
 * Income = sum(Invoice.totalAmount) where status="paid" AND paidAt in window.
 * Expenses = sum(Bill.totalAmount) where status="paid" AND updatedAt in window
 *          + sum(ExpenseClaim.totalAmount) where status="paid" AND paidAt in window.
 *
 * The query shape matches `getProfitAndLoss` in lib/actions/reports.ts so coworker
 * answers stay consistent with the Reports surface.
 *
 * Totals are summed in raw currency units. Multi-currency installs see a `gaps`
 * entry flagging the mix; the platform-wide convention is to display in
 * `OrgSettings.baseCurrency` (matches the finance dashboard).
 */
export async function getFinancePeriodSummary(
  input: FinancePeriodInput = {},
): Promise<FinancePeriodSummary> {
  const window = resolveFinancePeriod(input);

  const [
    invoicesPaid,
    billsPaid,
    expensesPaid,
    receivablesPending,
    payablesPending,
    expenseClaimsPending,
    invoiceCurrencies,
    billCurrencies,
    expenseCurrencies,
    orgSettings,
  ] = await Promise.all([
    prisma.invoice.aggregate({
      where: { status: "paid", paidAt: { gte: window.start, lte: window.end } },
      _sum: { totalAmount: true },
      _count: true,
    }),
    prisma.bill.aggregate({
      where: { status: "paid", updatedAt: { gte: window.start, lte: window.end } },
      _sum: { totalAmount: true },
      _count: true,
    }),
    prisma.expenseClaim.aggregate({
      where: { status: "paid", paidAt: { gte: window.start, lte: window.end } },
      _sum: { totalAmount: true },
      _count: true,
    }),
    prisma.invoice.aggregate({
      where: {
        status: { in: ["sent", "viewed", "partially_paid", "overdue"] },
        issueDate: { gte: window.start, lte: window.end },
      },
      _sum: { amountDue: true },
      _count: true,
    }),
    prisma.bill.aggregate({
      where: {
        status: { in: ["approved", "partially_paid", "draft"] },
        issueDate: { gte: window.start, lte: window.end },
      },
      _sum: { amountDue: true },
      _count: true,
    }),
    prisma.expenseClaim.count({
      where: {
        status: { in: ["submitted", "approved"] },
        submittedAt: { gte: window.start, lte: window.end },
      },
    }),
    prisma.invoice.groupBy({
      by: ["currency"],
      where: { status: "paid", paidAt: { gte: window.start, lte: window.end } },
    }),
    prisma.bill.groupBy({
      by: ["currency"],
      where: { status: "paid", updatedAt: { gte: window.start, lte: window.end } },
    }),
    prisma.expenseClaim.groupBy({
      by: ["currency"],
      where: { status: "paid", paidAt: { gte: window.start, lte: window.end } },
    }),
    prisma.orgSettings.findFirst(),
  ]);

  const income: FinancePeriodComponent = {
    total: toNumber(invoicesPaid._sum.totalAmount),
    count: invoicesPaid._count,
    source: 'Invoice.totalAmount where status="paid" AND paidAt in period',
  };

  const billsComponent: FinancePeriodComponent = {
    total: toNumber(billsPaid._sum.totalAmount),
    count: billsPaid._count,
    source: 'Bill.totalAmount where status="paid" AND updatedAt in period',
  };

  const claimsComponent: FinancePeriodComponent = {
    total: toNumber(expensesPaid._sum.totalAmount),
    count: expensesPaid._count,
    source: 'ExpenseClaim.totalAmount where status="paid" AND paidAt in period',
  };

  const expensesTotal = billsComponent.total + claimsComponent.total;
  const expensesCount = billsComponent.count + claimsComponent.count;

  const distinctCurrencies = collectCurrencies([
    invoiceCurrencies,
    billCurrencies,
    expenseCurrencies,
  ]);

  const gaps: string[] = [];
  if (income.count === 0 && billsComponent.count === 0 && claimsComponent.count === 0) {
    gaps.push(
      "No paid invoices, bills, or expense claims were recorded in this period. Either no activity occurred or transactions have not yet been marked paid.",
    );
  } else {
    if (income.count === 0) {
      gaps.push("No invoices were marked paid in this period; recorded income is zero.");
    }
    if (billsComponent.count === 0 && claimsComponent.count === 0) {
      gaps.push(
        "No bills or expense claims were marked paid in this period; recorded expenses are zero.",
      );
    }
  }

  const receivablesAmount = toNumber(receivablesPending._sum.amountDue);
  if (receivablesPending._count > 0) {
    gaps.push(
      `${receivablesPending._count} invoice(s) issued in this period are still outstanding (${receivablesAmount.toFixed(2)} ${orgSettings?.baseCurrency ?? "GBP"} not yet collected). Income only counts payments received.`,
    );
  }

  const payablesAmount = toNumber(payablesPending._sum.amountDue);
  if (payablesPending._count > 0) {
    gaps.push(
      `${payablesPending._count} bill(s) issued in this period are still unpaid (${payablesAmount.toFixed(2)} ${orgSettings?.baseCurrency ?? "GBP"} not yet disbursed). Expenses only count payments made.`,
    );
  }

  if (expenseClaimsPending > 0) {
    gaps.push(
      `${expenseClaimsPending} expense claim(s) submitted in this period are awaiting approval or payment.`,
    );
  }

  if (distinctCurrencies.length > 1) {
    gaps.push(
      `Transactions span ${distinctCurrencies.length} currencies (${distinctCurrencies.join(", ")}). Totals are raw sums; FX conversion to base currency is not applied.`,
    );
  }

  const verificationStatus: FinancePeriodVerificationStatus =
    income.count === 0 && expensesCount === 0
      ? "no_current_data"
      : gaps.length > 0
        ? "partial"
        : "verified";

  const summary: FinancePeriodSummary = {
    period: {
      preset: window.preset,
      label: window.label,
      start: window.start.toISOString(),
      end: window.end.toISOString(),
    },
    currency: orgSettings?.baseCurrency ?? "GBP",
    income,
    expenses: {
      total: expensesTotal,
      count: expensesCount,
      bills: billsComponent,
      expenseClaims: claimsComponent,
    },
    net: income.total - expensesTotal,
    pending: {
      receivables: {
        total: receivablesAmount,
        count: receivablesPending._count,
        source:
          'Invoice.amountDue where status in [sent, viewed, partially_paid, overdue] AND issueDate in period',
      },
      payables: {
        total: payablesAmount,
        count: payablesPending._count,
        source:
          'Bill.amountDue where status in [draft, approved, partially_paid] AND issueDate in period',
      },
      expenseClaims: {
        count: expenseClaimsPending,
        source:
          'ExpenseClaim count where status in [submitted, approved] AND submittedAt in period',
      },
    },
    currencies: {
      distinctCount: distinctCurrencies.length,
      codes: distinctCurrencies,
    },
    gaps,
    verificationStatus,
    sourceLanguage: "",
    provenance: {
      description:
        "Cash-basis aggregation from the canonical Invoice, Bill, and ExpenseClaim tables. Matches the lib/actions/reports.ts profit-loss aggregation used by the Finance reports surface.",
      sources: [income.source, billsComponent.source, claimsComponent.source],
      notes: [
        "Income recognizes paid invoices only — outstanding receivables surface in `pending.receivables` instead.",
        "Bills lack a paidAt column in the schema; the existing platform convention uses Bill.updatedAt as the proxy for the paid transition.",
        "Currency presented (`currency` field) is OrgSettings.baseCurrency. Totals are raw sums and ignore FX conversion when transactions span multiple currencies.",
      ],
    },
  };
  summary.sourceLanguage = formatFinancePeriodSummary(summary);
  return summary;
}

export function formatFinancePeriodSummary(summary: FinancePeriodSummary): string {
  const incomeAmount = summary.income.total.toFixed(2);
  const expensesAmount = summary.expenses.total.toFixed(2);
  const netAmount = summary.net.toFixed(2);
  const verdict = summary.income.count === 0 && summary.expenses.count === 0
    ? `${summary.period.label}: no paid activity recorded yet. Net ${netAmount} ${summary.currency}.`
    : `${summary.period.label}: income ${incomeAmount} ${summary.currency} (${summary.income.count} invoice${summary.income.count === 1 ? "" : "s"}), expenses ${expensesAmount} ${summary.currency} (${summary.expenses.count} bill${summary.expenses.count === 1 ? "" : "s"}/claim${summary.expenses.count === 1 ? "" : "s"}), net ${netAmount} ${summary.currency}.`;
  const evidence = `Evidence: ${summary.provenance.description} Sources: ${summary.provenance.sources.join("; ")}.`;
  const caveats = summary.gaps.length > 0 ? ` Caveats: ${summary.gaps.join(" ")}` : "";
  return `${verdict} Verification status: ${summary.verificationStatus}. ${evidence}${caveats}`;
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function formatIsoDate(d: Date): string {
  const iso = d.toISOString().split("T")[0];
  return iso ?? "";
}

function collectCurrencies(groups: Array<Array<{ currency: string }>>): string[] {
  const set = new Set<string>();
  for (const group of groups) {
    for (const row of group) {
      if (row.currency) set.add(row.currency);
    }
  }
  return Array.from(set).sort();
}
