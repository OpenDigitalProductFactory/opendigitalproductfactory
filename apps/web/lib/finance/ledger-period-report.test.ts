import { describe, expect, it } from "vitest";
import { buildScopedLedgerPeriodReport } from "./ledger-period-report";

const checkedAt = new Date("2026-10-31T12:00:00Z");
const account = (id: string, type: string) => ({
  id, organizationId: "org-a", code: id, name: id, type, currency: "EUR",
});
const line = (accountId: string, debit: string, credit: string) => ({ accountId, debit, credit, currency: "EUR" });
const entry = (id: string, lines: ReturnType<typeof line>[]) => ({
  id, organizationId: "org-a", periodKey: "2026-10", status: "posted", currency: "EUR",
  sourceType: null as string | null, sourceId: null as string | null, reversalOfId: null as string | null,
  lineCount: lines.length, lines,
});
function source() {
  return { organizationId: "org-a", periodKey: "2026-10", checkedAt,
    accounts: [account("ar", "asset"), account("bank", "asset"), account("income", "revenue"),
      account("expense", "expense"), account("ap", "liability"), account("capital", "equity")],
    entries: [entry("sale", [line("ar", "1200", "0"), line("income", "0", "1200")]),
      entry("cost", [line("expense", "200", "0"), line("ap", "0", "200")])],
    linkedEntries: [] as ReturnType<typeof entry>[], truncated: false,
  };
}
function statement(input = source()) {
  const result = buildScopedLedgerPeriodReport(input);
  expect(result.availability).toBe("available");
  if (result.availability !== "available") throw new Error(result.reason);
  return result;
}

describe("scoped recorded ledger period", () => {
  it("uses canonical income and expense meaning with explicit EUR scope", () => {
    const result = statement();
    expect(result.incomeStatement).toEqual({ revenue: 1200, expenses: 200, netIncome: 1000 });
    expect(result.currency).toBe("EUR");
    expect(result.organizationId).toBe("org-a");
    expect(result.periodKey).toBe("2026-10");
    expect(result.checkedAt).toEqual(checkedAt);
    expect(result.trialBalance.balanced).toBe(true);
  });

  it("distinguishes covered expense-only, balance-only and zero-net records from empty", () => {
    const input = source();
    input.entries = [input.entries[1]!];
    expect(statement(input).incomeStatement).toEqual({ revenue: 0, expenses: 200, netIncome: -200 });
    input.entries = [entry("funding", [line("bank", "5000", "0"), line("capital", "0", "5000")])];
    expect(statement(input).incomeStatement).toEqual({ revenue: 0, expenses: 0, netIncome: 0 });
    input.entries = [entry("sale", [line("ar", "200", "0"), line("income", "0", "200")]), source().entries[1]!];
    expect(statement(input).incomeStatement.netIncome).toBe(0);
    input.entries = [];
    expect(buildScopedLedgerPeriodReport(input)).toMatchObject({ availability: "unavailable", reason: expect.stringMatching(/no.*period|no.*entries/i) });
  });

  it("retains a reversed original and its actual writer-linked compensation", () => {
    const input = source();
    const original = input.entries[0]!;
    original.status = "reversed";
    const reversal = entry("reverse-sale", [line("ar", "0", "1200"), line("income", "1200", "0")]);
    reversal.sourceType = "JournalEntry";
    reversal.sourceId = original.id; // The real writer does not populate reversalOfId.
    input.entries = [original, reversal];
    expect(statement(input).incomeStatement.revenue).toBe(0);
    reversal.periodKey = "2026-11";
    input.entries = [original]; input.linkedEntries = [reversal];
    expect(statement(input).incomeStatement.revenue).toBe(1200);
    input.periodKey = "2026-11"; input.entries = [reversal]; input.linkedEntries = [original];
    expect(statement(input).incomeStatement.revenue).toBe(-1200);
  });

  it("does not count drafts as eligible coverage", () => {
    const input = source(); input.entries.forEach(row => { row.status = "draft"; });
    expect(buildScopedLedgerPeriodReport(input)).toMatchObject({ availability: "unavailable" });
  });

  it.each(["2026-00", "2026-13", "2026-1", "2026-10-01", ""]) ("rejects invalid month %s", periodKey => {
    expect(buildScopedLedgerPeriodReport({ ...source(), periodKey })).toMatchObject({ availability: "unavailable" });
  });

  it.each([
    ["missing chart", (s: ReturnType<typeof source>) => { s.accounts = []; }],
    ["missing expense class", (s: ReturnType<typeof source>) => { s.accounts = s.accounts.filter(a => a.type !== "expense"); }],
    ["foreign account", (s: ReturnType<typeof source>) => { s.accounts[0]!.organizationId = "org-b"; }],
    ["foreign entry", (s: ReturnType<typeof source>) => { s.entries[0]!.organizationId = "org-b"; }],
    ["wrong period", (s: ReturnType<typeof source>) => { s.entries[0]!.periodKey = "2026-09"; }],
    ["unknown account", (s: ReturnType<typeof source>) => { s.entries[0]!.lines[0]!.accountId = "missing"; }],
    ["unknown account class", (s: ReturnType<typeof source>) => { s.accounts[0]!.type = "unknown"; }],
    ["entry currency mismatch", (s: ReturnType<typeof source>) => { s.entries[0]!.currency = "USD"; }],
    ["line currency mismatch", (s: ReturnType<typeof source>) => { s.entries[0]!.lines[0]!.currency = "USD"; }],
    ["chart currency mismatch", (s: ReturnType<typeof source>) => { s.accounts[0]!.currency = "USD"; }],
    ["fractional minor units", (s: ReturnType<typeof source>) => { s.entries[0]!.lines[0]!.debit = "1200.001"; }],
    ["nonfinite amount", (s: ReturnType<typeof source>) => { s.entries[0]!.lines[0]!.debit = "NaN"; }],
    ["negative amount", (s: ReturnType<typeof source>) => { s.entries[0]!.lines[0]!.debit = "-1200"; }],
    ["both sides", (s: ReturnType<typeof source>) => { s.entries[0]!.lines[0]!.credit = "1"; }],
    ["unbalanced entry", (s: ReturnType<typeof source>) => { s.entries[0]!.lines[0]!.debit = "1199"; }],
    ["unsafe amount", (s: ReturnType<typeof source>) => { s.entries[0]!.lines[0]!.debit = "9007199254740992"; }],
    ["missing lines", (s: ReturnType<typeof source>) => { s.entries[0]!.lineCount += 1; }],
    ["truncated read", (s: ReturnType<typeof source>) => { s.truncated = true; }],
    ["reversed without counterpart", (s: ReturnType<typeof source>) => { s.entries[0]!.status = "reversed"; }],
    ["reversal without original", (s: ReturnType<typeof source>) => { s.entries[0]!.sourceType = "JournalEntry"; s.entries[0]!.sourceId = "missing"; }],
  ])("keeps %s unavailable without a numeric result", (_name, mutate) => {
    const input = source(); mutate(input);
    const result = buildScopedLedgerPeriodReport(input);
    expect(result.availability).toBe("unavailable");
    expect(result).not.toHaveProperty("incomeStatement");
  });

  it.each(["JPY", "BHD", "ZZZ"])("refuses unsupported currency precision/identity %s", currency => {
    const input = source(); input.accounts.forEach(a => { a.currency = currency; });
    input.entries.forEach(e => { e.currency = currency; e.lines.forEach(l => { l.currency = currency; }); });
    expect(buildScopedLedgerPeriodReport(input)).toMatchObject({ availability: "unavailable" });
  });
});

it("all-recorded keeps prior capital while a month remains only its recorded movements", () => {
  const input = source();
  const funding = entry("funding", [line("bank", "5000", "0"), line("capital", "0", "5000")]);
  funding.periodKey = "2026-09";
  const report = buildScopedLedgerPeriodReport({ ...input, periodKey: null, entries: [funding, input.entries[1]!] });
  expect(report.availability).toBe("available");
  if (report.availability !== "available") throw new Error(report.reason);
  expect(report.periodKey).toBeNull();
  expect(report.incomeStatement).toEqual({ revenue: 0, expenses: 200, netIncome: -200 });
  expect(report.trialBalance.rows.find(row => row.accountId === "bank")?.debitTotal).toBe(5000);
  expect(statement({ ...input, entries: [input.entries[1]!] }).incomeStatement).toEqual({ revenue: 0, expenses: 200, netIncome: -200 });
});
