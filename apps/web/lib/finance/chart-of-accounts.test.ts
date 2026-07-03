import { describe, it, expect } from "vitest";
import {
  BASE_CONTROL_ACCOUNTS,
  POSTING_ACCOUNT_ROLES,
  buildOrgChartOfAccounts,
  resolvePostingAccounts,
  type DeterminableAccount,
} from "./chart-of-accounts";
import { buildInvoicePostingLines, validateJournalEntry, normalBalanceForType } from "./ledger";

// A commercial/trades-style archetype seed: revenue + expense only, no
// balance-sheet control accounts — the common SMB case.
const tradesProfile = {
  chartOfAccountsSeed: [
    { code: "4000", name: "Labour Revenue", type: "revenue" as const },
    { code: "4010", name: "Materials Revenue", type: "revenue" as const },
    { code: "5000", name: "Materials & Supplies", type: "expense" as const },
    { code: "5010", name: "Subcontractor Costs", type: "expense" as const },
  ],
};

// A municipal fund-accounting model that *does* define its own 1000/2000/3000.
const fundProfile = {
  chartOfAccountsSeed: [
    { code: "1000", name: "General Fund Cash", type: "asset" as const },
    { code: "3000", name: "Fund Balance — Unassigned", type: "equity" as const },
    { code: "4000", name: "Property Tax & Levy Revenue", type: "revenue" as const },
    { code: "5000", name: "General Government Expenditures", type: "expense" as const },
  ],
};

describe("BASE_CONTROL_ACCOUNTS", () => {
  it("covers every posting role that has a base account", () => {
    const roles = new Set(BASE_CONTROL_ACCOUNTS.map((a) => a.role).filter(Boolean));
    for (const r of ["bank", "receivables", "payables", "taxPayable", "salesRevenue"]) {
      expect(roles.has(r as never)).toBe(true);
    }
  });
  it("has unique codes", () => {
    const codes = BASE_CONTROL_ACCOUNTS.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("buildOrgChartOfAccounts", () => {
  it("adds the balance-sheet spine an archetype omits (trades)", () => {
    const coa = buildOrgChartOfAccounts(tradesProfile);
    const codes = coa.map((a) => a.code);
    // base spine present
    expect(codes).toEqual(expect.arrayContaining(["1000", "1100", "2000", "2200", "3000", "3900"]));
    // archetype accounts present
    expect(codes).toEqual(expect.arrayContaining(["4010", "5000", "5010"]));
    // no duplicate codes
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("lets the archetype override a base code but inherit its role (4000 → salesRevenue)", () => {
    const coa = buildOrgChartOfAccounts(tradesProfile);
    const acct4000 = coa.find((a) => a.code === "4000")!;
    expect(acct4000.name).toBe("Labour Revenue"); // archetype name wins
    expect(acct4000.role).toBe("salesRevenue"); // base role inherited
  });

  it("defers to a domain ledger model that defines its own control accounts (fund 1000)", () => {
    const coa = buildOrgChartOfAccounts(fundProfile);
    const cash = coa.find((a) => a.code === "1000")!;
    expect(cash.name).toBe("General Fund Cash"); // municipal name wins
    expect(cash.role).toBe("bank"); // still resolves as the bank account
  });

  it("derives normalBalance for every account", () => {
    for (const a of buildOrgChartOfAccounts(tradesProfile)) {
      expect(a.normalBalance).toBe(normalBalanceForType(a.type));
    }
  });
});

describe("resolvePostingAccounts", () => {
  it("resolves invoice-posting roles for a trades org with zero manual config", () => {
    const coa = buildOrgChartOfAccounts(tradesProfile).map((a, i) => ({ ...a, id: `acc-${i}` }));
    const { resolved, unresolved } = resolvePostingAccounts(coa);

    expect(resolved.receivables?.code).toBe("1100");
    expect(resolved.salesRevenue?.code).toBe("4000");
    expect(resolved.taxPayable?.code).toBe("2200");
    expect(resolved.bank?.code).toBe("1000");
    expect(unresolved).not.toContain("receivables");
    expect(unresolved).not.toContain("salesRevenue");
    expect(unresolved).not.toContain("taxPayable");
  });

  it("feeds buildInvoicePostingLines to produce a balanced entry end-to-end", () => {
    const coa = buildOrgChartOfAccounts(tradesProfile).map((a, i) => ({ ...a, id: `acc-${i}` }));
    const { resolved } = resolvePostingAccounts(coa);

    const lines = buildInvoicePostingLines(
      { subtotal: 1000, taxAmount: 200, customerAccountId: "cust-1" },
      {
        receivablesAccountId: resolved.receivables!.id!,
        revenueAccountId: resolved.salesRevenue!.id!,
        taxPayableAccountId: resolved.taxPayable!.id!,
      },
    );
    expect(validateJournalEntry(lines).ok).toBe(true);
  });

  it("prefers an explicit role tag over the heuristic", () => {
    const accounts: DeterminableAccount[] = [
      { id: "x", code: "1190", name: "Client Balances", type: "asset", role: "receivables" },
      { id: "y", code: "1100", name: "Accounts Receivable", type: "asset" },
    ];
    expect(resolvePostingAccounts(accounts).resolved.receivables?.id).toBe("x");
  });

  it("reports roles it cannot resolve instead of guessing", () => {
    const accounts: DeterminableAccount[] = [
      { code: "4000", name: "Sales", type: "revenue" },
    ];
    const { resolved, unresolved } = resolvePostingAccounts(accounts);
    expect(resolved.salesRevenue?.code).toBe("4000");
    expect(unresolved).toContain("receivables");
    expect(unresolved).toContain("bank");
  });

  it("exposes a stable role registry", () => {
    expect(POSTING_ACCOUNT_ROLES).toContain("receivables");
    expect(POSTING_ACCOUNT_ROLES).toContain("taxPayable");
  });
});
