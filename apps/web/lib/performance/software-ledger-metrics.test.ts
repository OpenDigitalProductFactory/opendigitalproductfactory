import { describe, expect, it } from "vitest";
import type { PersistedMetricRow } from "./business-performance-provider";
import { inspectSoftwareLedgerPack, projectSoftwareLedgerMetrics, SOFTWARE_LEDGER_DEFINITION_VERSION } from "./software-ledger-metrics";

const checkedAt = new Date("2026-11-01T12:00:00Z");
const keys = ["posted-ledger-income", "posted-ledger-expenses", "posted-ledger-net-result"];
function pack(): PersistedMetricRow[] {
  return keys.map((key, index) => ({ metricKey: key,
    periodStart: new Date("2026-10-01T00:00:00Z"), periodEnd: new Date("2026-11-01T00:00:00Z"), timezone: "UTC",
    unit: "currency", value: [1200, 200, 1000][index]!, availability: "available", unavailableReason: null,
    definitionVersion: SOFTWARE_LEDGER_DEFINITION_VERSION, sourceWatermark: checkedAt, computedAt: checkedAt,
    sourceLineage: { sourceModels: ["LedgerAccount", "JournalEntry", "JournalLine"], sourceRows: 16,
      currency: "EUR", generation: checkedAt.toISOString(), coverage: "recorded-postings-only" },
  }));
}

describe("software recorded-ledger metric contract", () => {
  it("maps canonical zero and unknown separately, without filling generic proxies", () => {
    const projected = projectSoftwareLedgerMetrics({ availability: "available", organizationId: "org-a", periodKey: "2026-10",
      checkedAt, currency: "EUR", incomeStatement: { revenue: 200, expenses: 200, netIncome: 0 },
      trialBalance: { rows: [], totalDebit: 400, totalCredit: 400, balanced: true }, sourceRows: { accounts: 6, entries: 2, lines: 4 },
    }, { organizationId: "org-a", periodKey: "2026-10" });
    expect(projected.values).toEqual({ "posted-ledger-income": 200, "posted-ledger-expenses": 200, "posted-ledger-net-result": 0 });
    expect(projected.currency).toBe("EUR");
    const missing = projectSoftwareLedgerMetrics({ availability: "unavailable", organizationId: "org-a", periodKey: "2026-10",
      checkedAt, currency: null, reason: "No eligible period entries." }, { organizationId: "org-a", periodKey: "2026-10" });
    expect(Object.values(missing.values)).toEqual([null, null, null]);
    expect(missing.sourceRows).toBeNull();
    expect(missing.reason).toBe("No eligible period entries.");
  });

  it("refuses a foreign report instead of persisting its aggregates", () => {
    expect(() => projectSoftwareLedgerMetrics({ availability: "unavailable", organizationId: "org-b", periodKey: "2026-10",
      checkedAt, currency: null, reason: "missing" }, { organizationId: "org-a", periodKey: "2026-10" })).toThrow(/organization|period/);
  });

  it("accepts only a complete coherent pack and returns allowlisted lineage", () => {
    const rows = pack();
    rows.forEach(row => { row.sourceLineage = { ...(row.sourceLineage as object), privateMemo: "not for projection", sourceId: "private-id" }; });
    const result = inspectSoftwareLedgerPack(rows);
    expect(result).toMatchObject({ valid: true, currency: "EUR" });
    expect(JSON.stringify(result)).not.toMatch(/privateMemo|private-id|not for projection/);
  });

  it.each<[string, (rows: PersistedMetricRow[]) => void]>([
    ["partial write", rows => { rows.pop(); }],
    ["duplicate key", rows => { rows[1]!.metricKey = rows[0]!.metricKey; }],
    ["wrong version", rows => { rows[0]!.definitionVersion = "restaurant-v1"; }],
    ["mixed generation", rows => { rows[0]!.computedAt = new Date("2026-11-01T13:00:00Z"); }],
    ["mixed source age", rows => { rows[0]!.sourceWatermark = new Date("2026-11-01T11:00:00Z"); }],
    ["wrong timezone", rows => { rows.forEach(row => { row.timezone = "America/Chicago"; }); }],
    ["wrong month boundary", rows => { rows.forEach(row => { row.periodStart = new Date("2026-10-02T00:00:00Z"); }); }],
    ["different currency", rows => { rows[0]!.sourceLineage = { ...(rows[0]!.sourceLineage as object), currency: "USD" }; }],
    ["unsupported currency", rows => { rows.forEach(row => { row.sourceLineage = { ...(row.sourceLineage as object), currency: "BHD" }; }); }],
    ["fractional minor value", rows => { rows[0]!.value = 1200.001; }],
    ["nonfinite value", rows => { rows[0]!.value = Infinity; }],
    ["wrong net result", rows => { rows[2]!.value = 999; }],
    ["missing lineage", rows => { rows[0]!.sourceLineage = null; }],
    ["missing availability", rows => { rows[0]!.availability = "unavailable"; rows[0]!.value = null; }],
  ])("refuses %s without a valid numeric pack", (_name, mutate) => {
    const rows = pack(); mutate(rows);
    expect(inspectSoftwareLedgerPack(rows)).toMatchObject({ valid: false });
  });

  it("retains an explicit unavailable pack without inventing a currency or zero", () => {
    const rows = pack().map(row => ({ ...row, availability: "unavailable" as const, value: null,
      unavailableReason: "No eligible entries in this period.",
      sourceLineage: { ...(row.sourceLineage as object), currency: null, sourceRows: null },
    }));
    expect(inspectSoftwareLedgerPack(rows)).toMatchObject({ valid: true, currency: null });
  });
});

it("refuses mixed failed-refresh markers and strips unrecognized nested metadata", () => {
  const rows = pack();
  rows.forEach(row => { row.sourceLineage = { ...(row.sourceLineage as object), refreshFailure: { at: "2026-11-01T12:15:00.000Z", kind: "source-unavailable", privateMemo: "secret-marker" } }; });
  const valid = inspectSoftwareLedgerPack(rows); expect(valid.valid).toBe(true); expect(JSON.stringify(valid)).not.toContain("secret-marker");
  rows[0]!.sourceLineage = { ...(rows[0]!.sourceLineage as object), refreshFailure: { at: "2026-11-01T12:16:00.000Z", kind: "source-unavailable" } };
  expect(inspectSoftwareLedgerPack(rows).valid).toBe(false);
});
