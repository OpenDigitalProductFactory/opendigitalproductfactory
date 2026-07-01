import { describe, it, expect } from "vitest";
import {
  normalBalanceForType,
  isLedgerAccountType,
  validateJournalEntry,
  computeTrialBalance,
  buildInvoicePostingLines,
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
