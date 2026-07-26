import { describe, it, expect } from "vitest";
import {
  normalBalanceForType,
  isLedgerAccountType,
  validateJournalEntry,
  computeTrialBalance,
  deriveFinancialStatements,
  buildInvoicePostingLines,
  buildPaymentPostingLines,
  buildBillPostingLines,
  computeMonthlyDepreciation,
  buildDepreciationPostingLines,
  buildReversalPostingLines,
  isPeriodLocked,
  validatePostingPeriod,
  periodKeyOf,
  toMinorUnits,
  LEDGER_ACCOUNT_TYPES,
  type TrialBalanceAccount,
} from "./ledger";

describe("normalBalanceForType", () => {
  it("assets and expenses are debit-normal", () => {
    expect(normalBalanceForType("asset")).toBe("debit");
    expect(normalBalanceForType("expense")).toBe("debit");
  });
  it("liabilities, equity and revenue are credit-normal", () => {
    expect(normalBalanceForType("liability")).toBe("credit");
    expect(normalBalanceForType("equity")).toBe("credit");
    expect(normalBalanceForType("revenue")).toBe("credit");
  });
  it("covers every account type in the registry", () => {
    for (const t of LEDGER_ACCOUNT_TYPES) {
      expect(["debit", "credit"]).toContain(normalBalanceForType(t));
    }
  });
});

describe("isLedgerAccountType", () => {
  it("accepts known types and rejects unknown", () => {
    expect(isLedgerAccountType("asset")).toBe(true);
    expect(isLedgerAccountType("goodwill")).toBe(false);
  });
});

describe("validateJournalEntry", () => {
  it("accepts a balanced two-line entry", () => {
    const r = validateJournalEntry([
      { accountId: "cash", debit: 100 },
      { accountId: "revenue", credit: 100 },
    ]);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
    expect(r.totalDebit).toBe(100);
    expect(r.totalCredit).toBe(100);
  });

  it("tolerates floating-point amounts that sum via minor units", () => {
    // 0.1 + 0.2 !== 0.3 in binary float; minor-unit comparison must still balance.
    const r = validateJournalEntry([
      { accountId: "a", debit: 0.1 },
      { accountId: "b", debit: 0.2 },
      { accountId: "c", credit: 0.3 },
    ]);
    expect(r.ok).toBe(true);
  });

  it("rejects an unbalanced entry", () => {
    const r = validateJournalEntry([
      { accountId: "cash", debit: 100 },
      { accountId: "revenue", credit: 90 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/unbalanced/i);
  });

  it("rejects a single-line entry", () => {
    const r = validateJournalEntry([{ accountId: "cash", debit: 100 }]);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/at least two lines/i);
  });

  it("rejects a line that is both debit and credit", () => {
    const r = validateJournalEntry([
      { accountId: "cash", debit: 50, credit: 50 },
      { accountId: "revenue", credit: 50 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/single-sided/i);
  });

  it("rejects negative amounts", () => {
    const r = validateJournalEntry([
      { accountId: "cash", debit: -100 },
      { accountId: "revenue", credit: -100 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/non-negative/i);
  });

  it("rejects a zero-amount line", () => {
    const r = validateJournalEntry([
      { accountId: "cash", debit: 0 },
      { accountId: "revenue", credit: 0 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/non-zero/i);
  });

  it("flags a missing account id", () => {
    const r = validateJournalEntry([
      { accountId: "", debit: 100 },
      { accountId: "revenue", credit: 100 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/ledger account is required/i);
  });
});

describe("buildInvoicePostingLines", () => {
  const accounts = {
    revenueAccountId: "4000",
    receivablesAccountId: "1100",
    taxPayableAccountId: "2200",
  };

  it("produces a balanced Dr AR / Cr Revenue + Tax entry", () => {
    const lines = buildInvoicePostingLines(
      { subtotal: 1000, taxAmount: 200, customerAccountId: "cust-1" },
      accounts,
    );
    const v = validateJournalEntry(lines);
    expect(v.ok).toBe(true);

    const ar = lines.find((l) => l.accountId === "1100");
    const rev = lines.find((l) => l.accountId === "4000");
    const tax = lines.find((l) => l.accountId === "2200");
    expect(ar?.debit).toBe(1200); // gross
    expect(rev?.credit).toBe(1000); // net
    expect(tax?.credit).toBe(200);
    expect(ar?.customerAccountId).toBe("cust-1");
  });

  it("omits the tax line when there is no tax", () => {
    const lines = buildInvoicePostingLines({ subtotal: 500, taxAmount: 0 }, accounts);
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.accountId === "2200")).toBeUndefined();
    expect(validateJournalEntry(lines).ok).toBe(true);
  });

  it("throws when tax applies but no tax account is resolved", () => {
    expect(() =>
      buildInvoicePostingLines(
        { subtotal: 500, taxAmount: 50 },
        { revenueAccountId: "4000", receivablesAccountId: "1100" },
      ),
    ).toThrow(/tax/i);
  });
});

describe("computeTrialBalance", () => {
  const accounts: TrialBalanceAccount[] = [
    { accountId: "1100", code: "1100", name: "Accounts Receivable", type: "asset" },
    { accountId: "4000", code: "4000", name: "Revenue", type: "revenue" },
    { accountId: "2200", code: "2200", name: "Tax Payable", type: "liability" },
  ];

  it("balances and orients each account to its normal side", () => {
    const lines = buildInvoicePostingLines({ subtotal: 1000, taxAmount: 200 }, {
      revenueAccountId: "4000",
      receivablesAccountId: "1100",
      taxPayableAccountId: "2200",
    });
    const tb = computeTrialBalance(accounts, lines);

    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(1200);
    expect(tb.totalCredit).toBe(1200);

    const ar = tb.rows.find((r) => r.accountId === "1100")!;
    const rev = tb.rows.find((r) => r.accountId === "4000")!;
    expect(ar.balance).toBe(1200); // debit-normal asset, positive
    expect(rev.balance).toBe(1000); // credit-normal revenue, positive
  });

  it("ignores lines that reference accounts outside the requested set", () => {
    const tb = computeTrialBalance(accounts, [
      { accountId: "1100", debit: 100 },
      { accountId: "9999", credit: 100 }, // not in the account set
    ]);
    expect(tb.totalDebit).toBe(100);
    expect(tb.totalCredit).toBe(0);
    expect(tb.balanced).toBe(false);
  });
});

describe("periodKeyOf", () => {
  it("buckets a date into its YYYY-MM fiscal period (UTC)", () => {
    expect(periodKeyOf(new Date("2026-07-01T00:00:00Z"))).toBe("2026-07");
    expect(periodKeyOf(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12");
  });
});

describe("toMinorUnits", () => {
  it("rounds to integer pence without float drift", () => {
    expect(toMinorUnits(0.1 + 0.2)).toBe(30);
    expect(toMinorUnits(19.99)).toBe(1999);
  });
});

describe("buildPaymentPostingLines", () => {
  const resolver = {
    bankAccountId: "acc-bank",
    receivablesAccountId: "acc-ar",
    payablesAccountId: "acc-ap",
  };

  it("posts an inbound customer receipt Dr Bank / Cr AR and balances", () => {
    const lines = buildPaymentPostingLines(
      { direction: "inbound", amount: 250, customerAccountId: "cust-1" },
      resolver,
    );
    expect(validateJournalEntry(lines).ok).toBe(true);
    const bank = lines.find((l) => l.accountId === "acc-bank")!;
    const ar = lines.find((l) => l.accountId === "acc-ar")!;
    expect(bank.debit).toBe(250);
    expect(ar.credit).toBe(250);
    expect(bank.customerAccountId).toBe("cust-1");
  });

  it("posts an outbound supplier payment Dr AP / Cr Bank and balances", () => {
    const lines = buildPaymentPostingLines({ direction: "outbound", amount: 400 }, resolver);
    expect(validateJournalEntry(lines).ok).toBe(true);
    const ap = lines.find((l) => l.accountId === "acc-ap")!;
    const bank = lines.find((l) => l.accountId === "acc-bank")!;
    expect(ap.debit).toBe(400);
    expect(bank.credit).toBe(400);
  });

  it("throws if the control account the direction needs is unresolved", () => {
    expect(() =>
      buildPaymentPostingLines({ direction: "inbound", amount: 10 }, { bankAccountId: "acc-bank" }),
    ).toThrow(/receivablesAccountId/);
    expect(() =>
      buildPaymentPostingLines({ direction: "outbound", amount: 10 }, { bankAccountId: "acc-bank" }),
    ).toThrow(/payablesAccountId/);
  });

  it("never emits a negative amount", () => {
    const lines = buildPaymentPostingLines({ direction: "inbound", amount: -5 }, resolver);
    expect(lines.every((l) => (l.debit ?? 0) >= 0 && (l.credit ?? 0) >= 0)).toBe(true);
  });
});

describe("buildBillPostingLines", () => {
  const resolver = {
    payablesAccountId: "acc-ap",
    expenseAccountId: "acc-exp",
    inputTaxAccountId: "acc-input-tax",
  };

  it("splits Dr Expense (net) + Dr Input Tax / Cr AP (gross) when tax + input-tax account", () => {
    const lines = buildBillPostingLines({ subtotal: 1000, taxAmount: 200 }, resolver);
    expect(validateJournalEntry(lines).ok).toBe(true);
    expect(lines.find((l) => l.accountId === "acc-exp")!.debit).toBe(1000);
    expect(lines.find((l) => l.accountId === "acc-input-tax")!.debit).toBe(200);
    expect(lines.find((l) => l.accountId === "acc-ap")!.credit).toBe(1200);
  });

  it("folds tax into the expense (tax-inclusive) when no input-tax account, still balancing", () => {
    const lines = buildBillPostingLines(
      { subtotal: 1000, taxAmount: 200 },
      { payablesAccountId: "acc-ap", expenseAccountId: "acc-exp" },
    );
    expect(validateJournalEntry(lines).ok).toBe(true);
    expect(lines.find((l) => l.accountId === "acc-exp")!.debit).toBe(1200);
    expect(lines.find((l) => l.accountId === "acc-input-tax")).toBeUndefined();
    expect(lines.find((l) => l.accountId === "acc-ap")!.credit).toBe(1200);
  });

  it("handles a zero-tax bill (Dr Expense / Cr AP only)", () => {
    const lines = buildBillPostingLines({ subtotal: 500, taxAmount: 0 }, resolver);
    expect(validateJournalEntry(lines).ok).toBe(true);
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.accountId === "acc-exp")!.debit).toBe(500);
    expect(lines.find((l) => l.accountId === "acc-ap")!.credit).toBe(500);
  });
});

describe("deriveFinancialStatements", () => {
  const accounts: TrialBalanceAccount[] = [
    { accountId: "1000", code: "1000", name: "Bank", type: "asset" },
    { accountId: "1100", code: "1100", name: "Accounts Receivable", type: "asset" },
    { accountId: "2000", code: "2000", name: "Accounts Payable", type: "liability" },
    { accountId: "3000", code: "3000", name: "Retained Earnings", type: "equity" },
    { accountId: "4000", code: "4000", name: "Sales", type: "revenue" },
    { accountId: "5000", code: "5000", name: "Expenses", type: "expense" },
  ];

  it("derives a balanced income statement + balance sheet from a balanced ledger", () => {
    // Sell 1000 on credit, pay 400 of expenses from the bank, open with 500 equity.
    const tb = computeTrialBalance(accounts, [
      { accountId: "1000", debit: 500 }, // opening equity injection
      { accountId: "3000", credit: 500 },
      { accountId: "1100", debit: 1000 }, // AR from a sale
      { accountId: "4000", credit: 1000 }, // revenue
      { accountId: "5000", debit: 400 }, // expense
      { accountId: "1000", credit: 400 }, // paid from bank
    ]);
    expect(tb.balanced).toBe(true);

    const { incomeStatement: is, balanceSheet: bs } = deriveFinancialStatements(tb);
    expect(is.revenue).toBe(1000);
    expect(is.expenses).toBe(400);
    expect(is.netIncome).toBe(600);

    expect(bs.assets).toBe(1100); // bank 100 + AR 1000
    expect(bs.liabilities).toBe(0);
    expect(bs.equity).toBe(500);
    expect(bs.netIncome).toBe(600);
    // Assets 1100 = Liabilities 0 + Equity 500 + NetIncome 600
    expect(bs.balanced).toBe(true);
  });

  it("reports a net loss when expenses exceed revenue", () => {
    const tb = computeTrialBalance(accounts, [
      { accountId: "4000", credit: 100 },
      { accountId: "1100", debit: 100 },
      { accountId: "5000", debit: 300 },
      { accountId: "2000", credit: 300 },
    ]);
    const { incomeStatement: is } = deriveFinancialStatements(tb);
    expect(is.netIncome).toBe(-200);
  });

  it("an empty ledger yields all-zero, balanced statements", () => {
    const { incomeStatement: is, balanceSheet: bs } = deriveFinancialStatements(
      computeTrialBalance(accounts, []),
    );
    expect(is.netIncome).toBe(0);
    expect(bs.balanced).toBe(true);
  });
});

describe("computeMonthlyDepreciation", () => {
  const base = {
    purchaseCost: 12000,
    residualValue: 0,
    usefulLifeMonths: 12,
    depreciationMethod: "straight_line" as const,
    accumulatedDepreciation: 0,
  };

  it("straight-line spreads (cost − residual) evenly", () => {
    expect(computeMonthlyDepreciation(base)).toBe(1000);
    expect(computeMonthlyDepreciation({ ...base, residualValue: 1200 })).toBe(900);
  });

  it("stops at the residual — never over-depreciates", () => {
    // 11 months booked (11000); only 1000 of the 12000 base remains.
    expect(computeMonthlyDepreciation({ ...base, accumulatedDepreciation: 11500 })).toBe(500);
    expect(computeMonthlyDepreciation({ ...base, accumulatedDepreciation: 12000 })).toBe(0);
  });

  it("reducing-balance charges more early, on book value", () => {
    // double-declining rate = 2/12; first period = 12000 × 2/12 = 2000.
    const rb = { ...base, depreciationMethod: "reducing_balance" as const };
    expect(computeMonthlyDepreciation(rb)).toBe(2000);
    // after 2000 booked, next = (12000−2000) × 2/12 = 1666.67
    expect(computeMonthlyDepreciation({ ...rb, accumulatedDepreciation: 2000 })).toBeCloseTo(1666.67, 2);
  });

  it("returns 0 for a zero-life asset", () => {
    expect(computeMonthlyDepreciation({ ...base, usefulLifeMonths: 0 })).toBe(0);
  });
});

describe("buildDepreciationPostingLines", () => {
  it("posts a balanced Dr Depreciation / Cr Accumulated Depreciation entry", () => {
    const lines = buildDepreciationPostingLines(1000, {
      depreciationExpenseAccountId: "acc-dep-exp",
      accumulatedDepreciationAccountId: "acc-accum-dep",
    });
    expect(validateJournalEntry(lines).ok).toBe(true);
    expect(lines.find((l) => l.accountId === "acc-dep-exp")!.debit).toBe(1000);
    expect(lines.find((l) => l.accountId === "acc-accum-dep")!.credit).toBe(1000);
  });
});

describe("buildReversalPostingLines", () => {
  it("swaps debit and credit for each line and balances", () => {
    const original = [
      { accountId: "1100", debit: 1200, description: "Accounts receivable" },
      { accountId: "4000", credit: 1000, description: "Revenue" },
      { accountId: "2200", credit: 200, description: "Tax payable" },
    ];
    const reversed = buildReversalPostingLines(original);
    expect(reversed).toHaveLength(3);
    expect(reversed[0]).toEqual({
      accountId: "1100",
      credit: 1200,
      debit: undefined,
      description: "Reversal: Accounts receivable",
      customerAccountId: null,
      contactId: null,
    });
    expect(reversed[1]).toEqual({
      accountId: "4000",
      debit: 1000,
      credit: undefined,
      description: "Reversal: Revenue",
      customerAccountId: null,
      contactId: null,
    });
    expect(validateJournalEntry(reversed).ok).toBe(true);
  });
});

describe("isPeriodLocked and validatePostingPeriod", () => {
  it("detects locked periods accurately", () => {
    const locked = new Set(["2026-05", "2026-06"]);
    expect(isPeriodLocked("2026-05", locked)).toBe(true);
    expect(isPeriodLocked("2026-07", locked)).toBe(false);
  });

  it("validates posting dates against locked periods", () => {
    const locked = ["2026-05"];
    const v1 = validatePostingPeriod(new Date("2026-05-15T12:00:00Z"), locked);
    expect(v1.ok).toBe(false);
    expect(v1.error).toMatch(/locked/i);

    const v2 = validatePostingPeriod(new Date("2026-07-01T12:00:00Z"), locked);
    expect(v2.ok).toBe(true);
  });
});
