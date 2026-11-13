import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accounts: vi.fn(), entries: vi.fn(), lines: vi.fn(), transaction: vi.fn(), currency: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: {
  ledgerAccount: { findMany: mocks.accounts }, journalEntry: { findMany: mocks.entries },
  journalLine: { findMany: mocks.lines }, $transaction: mocks.transaction,
} }));
vi.mock("@/lib/org-locale/org-currency.server", () => ({ getOrgBaseCurrency: mocks.currency }));
import { getScopedLedgerPeriodReport, getGeneralLedgerReport } from "./ledger-service";

const chart = [
  { id: "ar", type: "asset" }, { id: "income", type: "revenue" },
  { id: "expense", type: "expense" }, { id: "ap", type: "liability" },
].map(a => ({ ...a, organizationId: "org-a", code: a.id, name: a.id, currency: "EUR" }));
const meta = (id: string, periodKey: string, status = "posted") => ({
  id, organizationId: "org-a", periodKey, status, currency: "EUR", sourceType: null as string | null,
  sourceId: null as string | null, reversalOfId: null as string | null, _count: { lines: 2 },
});
const rawLine = (journalEntryId: string, accountId: string, debit: string, credit: string) => ({
  journalEntryId, accountId, debit, credit, currency: "EUR",
});

describe("canonical scoped ledger period persistence adapter", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.accounts.mockResolvedValue(chart);
    mocks.entries.mockResolvedValue([meta("sale", "2026-10")]);
    mocks.lines.mockResolvedValue([rawLine("sale", "ar", "1200", "0"), rawLine("sale", "income", "0", "1200")]);
    mocks.transaction.mockImplementation(async (fn: (db: unknown) => unknown) => fn({
      ledgerAccount: { findMany: mocks.accounts }, journalEntry: { findMany: mocks.entries },
      journalLine: { findMany: mocks.lines },
    }));
  });

  it("reads an exact organization/month in a repeatable snapshot with bounded selects", async () => {
    const result = await getScopedLedgerPeriodReport("org-a", "2026-10", new Date("2026-10-31T12:00:00Z"));
    expect(result).toMatchObject({ availability: "available", currency: "EUR", incomeStatement: { revenue: 1200, expenses: 0, netIncome: 1200 } });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "RepeatableRead" }));
    expect(mocks.accounts).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-a" }, take: 1001 }));
    expect(mocks.entries).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: "org-a", periodKey: "2026-10", status: { in: ["posted", "reversed"] } }), take: 2001,
    }));
    expect(mocks.lines).toHaveBeenCalledWith(expect.objectContaining({
      where: { journalEntry: expect.objectContaining({ organizationId: "org-a", periodKey: "2026-10", status: { in: ["posted", "reversed"] } }) }, take: 10001,
    }));
    expect(mocks.currency).not.toHaveBeenCalled();
  });

  it("uses actual sourceType/sourceId provenance across months without requiring reversalOfId", async () => {
    const original = meta("sale", "2026-10", "reversed");
    const reversal = { ...meta("reversal", "2026-11"), sourceType: "JournalEntry", sourceId: "sale" };
    mocks.entries.mockResolvedValueOnce([original]).mockResolvedValueOnce([reversal]);
    mocks.lines.mockResolvedValueOnce([rawLine("sale", "ar", "1200", "0"), rawLine("sale", "income", "0", "1200")])
      .mockResolvedValueOnce([rawLine("reversal", "ar", "0", "1200"), rawLine("reversal", "income", "1200", "0")]);
    expect(await getScopedLedgerPeriodReport("org-a", "2026-10")).toMatchObject({
      availability: "available", incomeStatement: { revenue: 1200 },
    });
    expect(mocks.entries.mock.calls[1]![0]).toMatchObject({ where: { organizationId: "org-a" }, take: 2001 });
    expect(mocks.lines.mock.calls[1]![0]).toMatchObject({ where: { journalEntry: { organizationId: "org-a" } }, take: 10001 });
  });

  it.each(["2026-00", "2026-13", "2026-1", "all"])("refuses invalid period %s before querying", async period => {
    expect(await getScopedLedgerPeriodReport("org-a", period)).toMatchObject({ availability: "unavailable" });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.entries).not.toHaveBeenCalled();
  });

  it("does not fall back to another organization when scope is absent", async () => {
    expect(await getScopedLedgerPeriodReport("", "2026-10")).toMatchObject({ availability: "unavailable" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("refuses an oversized source rather than reporting its partial sum", async () => {
    mocks.accounts.mockResolvedValue(Array.from({ length: 1001 }, (_, i) => ({ ...chart[0]!, id: `a-${i}` })));
    expect(await getScopedLedgerPeriodReport("org-a", "2026-10")).toMatchObject({ availability: "unavailable", reason: expect.stringMatching(/size|exceed/i) });
  });

  it("propagates a failed source read so aggregation cannot persist a successful zero refresh", async () => {
    mocks.lines.mockRejectedValue(new Error("fixture source unavailable"));
    await expect(getScopedLedgerPeriodReport("org-a", "2026-10")).rejects.toThrow("fixture source unavailable");
  });

it("all-recorded shares explicit scope, snapshot and bounds rather than a first organization query", async () => {
  const result = await getGeneralLedgerReport("org-a", null);
  expect(result).toMatchObject({ availability: "available", periodKey: null, currency: "EUR" });
  expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "RepeatableRead" }));
  expect(mocks.entries).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-a", status: { in: ["posted", "reversed"] } }, take: 2001 }));
  expect(mocks.currency).not.toHaveBeenCalled();
});

});
