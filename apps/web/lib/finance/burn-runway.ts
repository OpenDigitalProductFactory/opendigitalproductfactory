// Burn, revenue, and runway with an EXPLICIT unknown state (BI-090221E7).
//
// The finance dashboard used to coalesce "nothing recorded" into $0.00 and
// declare "all up to date" — absence of bookkeeping rendered as good news. This
// module computes burn/revenue/runway from what is actually recorded and says
// "unknown" out loud when the books are empty, naming what to record to make
// the number real. Pure core (unit-testable) + a thin server loader.

import { prisma } from "@dpf/db";

const WINDOW_DAYS = 90;
const MONTHS_IN_WINDOW = WINDOW_DAYS / 30;

export type BurnRunwayInput = {
  /** null = no bank accounts recorded (cash position unknown). */
  totalCash: number | null;
  /** Paid supplier bills in the trailing window. */
  paidBills: { total: number; count: number };
  /** Paid/approved expense claims in the trailing window. */
  paidExpenses: { total: number; count: number };
  /** Paid customer invoices in the trailing window. */
  paidInvoices: { total: number; count: number };
  /** Known monthly commitments from supplier contracts (subscriptions etc.). */
  monthlyCommittedRecurring: number;
};

export type BurnRunway = {
  /** Trailing-average monthly spend; null = no spend recorded anywhere. */
  monthlyBurn: number | null;
  burnBasis: "measured" | "committed-only" | "unknown";
  /** Trailing-average monthly revenue; null = no revenue recorded. */
  monthlyRevenue: number | null;
  /** Months of cash left at current net burn; null unless cash AND burn known. */
  runwayMonths: number | null;
  runwayState: "measured" | "cash-growing" | "unknown-burn" | "unknown-cash";
  /** Money is going out and nothing has ever come in — worth saying plainly. */
  preRevenueWithBurn: boolean;
  /** What to record to turn each unknown into a number. */
  gaps: string[];
};

export function computeBurnRunway(input: BurnRunwayInput): BurnRunway {
  const gaps: string[] = [];

  const recordedSpend = input.paidBills.total + input.paidExpenses.total;
  const hasRecordedSpend = input.paidBills.count + input.paidExpenses.count > 0;

  let monthlyBurn: number | null;
  let burnBasis: BurnRunway["burnBasis"];
  if (hasRecordedSpend) {
    monthlyBurn = recordedSpend / MONTHS_IN_WINDOW + input.monthlyCommittedRecurring;
    burnBasis = "measured";
  } else if (input.monthlyCommittedRecurring > 0) {
    monthlyBurn = input.monthlyCommittedRecurring;
    burnBasis = "committed-only";
    gaps.push(
      "Only supplier-contract commitments are known — record paid bills and expenses to measure real burn.",
    );
  } else {
    monthlyBurn = null;
    burnBasis = "unknown";
    gaps.push("No spend recorded — record supplier bills and expenses to measure burn.");
  }

  const monthlyRevenue =
    input.paidInvoices.count > 0
      ? input.paidInvoices.total / MONTHS_IN_WINDOW
      : null;
  if (monthlyRevenue === null) {
    gaps.push("No revenue recorded — record paid invoices to measure revenue.");
  }

  const preRevenueWithBurn = monthlyRevenue === null && monthlyBurn !== null && monthlyBurn > 0;

  let runwayMonths: number | null = null;
  let runwayState: BurnRunway["runwayState"];
  if (monthlyBurn === null) {
    runwayState = "unknown-burn";
  } else if (input.totalCash === null) {
    runwayState = "unknown-cash";
    gaps.push("No bank account recorded — add one to compute runway from cash.");
  } else {
    const netBurn = monthlyBurn - (monthlyRevenue ?? 0);
    if (netBurn <= 0) {
      runwayState = "cash-growing";
    } else {
      runwayState = "measured";
      runwayMonths = input.totalCash / netBurn;
    }
  }

  return {
    monthlyBurn,
    burnBasis,
    monthlyRevenue,
    runwayMonths,
    runwayState,
    preRevenueWithBurn,
    gaps,
  };
}

/** Server loader: assemble the input from the books and compute. */
export async function loadBurnRunway(): Promise<BurnRunway> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  const [bankAccounts, paidBills, paidExpenses, paidInvoices, contracts] =
    await Promise.all([
      prisma.bankAccount.findMany({
        where: { status: "active" },
        select: { currentBalance: true },
      }),
      prisma.bill.aggregate({
        where: { status: "paid", updatedAt: { gte: since } },
        _sum: { totalAmount: true },
        _count: true,
      }),
      prisma.expenseClaim.aggregate({
        // Same "money actually left" filter as period-summary.ts.
        where: { status: "paid", paidAt: { gte: since } },
        _sum: { totalAmount: true },
        _count: true,
      }),
      prisma.invoice.aggregate({
        where: { status: "paid", paidAt: { gte: since } },
        _sum: { totalAmount: true },
        _count: true,
      }),
      prisma.supplierContract.aggregate({
        where: { status: "active" },
        _sum: { monthlyCommittedAmount: true },
      }),
    ]);

  return computeBurnRunway({
    totalCash:
      bankAccounts.length === 0
        ? null
        : bankAccounts.reduce((sum, a) => sum + Number(a.currentBalance), 0),
    paidBills: {
      total: Number(paidBills._sum.totalAmount ?? 0),
      count: paidBills._count,
    },
    paidExpenses: {
      total: Number(paidExpenses._sum.totalAmount ?? 0),
      count: paidExpenses._count,
    },
    paidInvoices: {
      total: Number(paidInvoices._sum.totalAmount ?? 0),
      count: paidInvoices._count,
    },
    monthlyCommittedRecurring: Number(contracts._sum.monthlyCommittedAmount ?? 0),
  });
}
