import type { ScopedLedgerPeriodReport } from "@/lib/finance/ledger-period-report";
import { isSupportedLedgerCurrency, ledgerMonthWindow } from "@/lib/finance/ledger-period-report";
import { toMinorUnits } from "@/lib/finance/ledger";
import { resolvePerformanceMetricPack } from "@dpf/storefront-templates";
import type { PersistedMetricRow } from "./business-performance-provider";

export const SOFTWARE_LEDGER_DEFINITION_VERSION = "software-ledger-v1";

type SoftwareLedgerLineage = {
  sourceModels: string[]; sourceRows: number | null; currency: string | null;
  generation: string; coverage: string;
  refreshFailure?: { at: string; kind: "source-unavailable" };
};

/** One contract for atomic writes and persisted reads; extra source metadata never reaches the owner projection. */
export function inspectSoftwareLedgerPack(rows: readonly PersistedMetricRow[]):
  { valid: true; currency: string | null; lineage: SoftwareLedgerLineage }
  | { valid: false; reason: string } {
  const invalid = () => ({ valid: false as const, reason: "Recorded results are incomplete or inconsistent. Review the ledger before using them." });
  const keys = resolvePerformanceMetricPack("software-platform").headline;
  const first = rows[0];
  if (!first || rows.length !== keys.length || new Set(rows.map(r => r.metricKey)).size !== keys.length) return invalid();
  const validDate = (d: Date) => d instanceof Date && Number.isFinite(d.getTime());
  if (![first.periodStart, first.periodEnd, first.computedAt, first.sourceWatermark].every(validDate)) return invalid();
  const window = ledgerMonthWindow(first.periodStart);
  if (window.start.getTime() !== first.periodStart.getTime() || window.end.getTime() !== first.periodEnd.getTime()) return invalid();
  const metadata = (row: PersistedMetricRow): Record<string, unknown> | null =>
    row.sourceLineage && typeof row.sourceLineage === "object" && !Array.isArray(row.sourceLineage)
      ? row.sourceLineage as Record<string, unknown> : null;
  const base = metadata(first);
  if (!base || typeof base.generation !== "string" || base.generation !== first.computedAt.toISOString()
    || base.coverage !== "recorded-postings-only") return invalid();
  const failure = base.refreshFailure;
  let refreshFailure: { at: string; kind: "source-unavailable" } | undefined;
  if (failure !== undefined) {
    if (!failure || typeof failure !== "object" || Array.isArray(failure)) return invalid();
    const marker = failure as Record<string, unknown>;
    if (marker.kind !== "source-unavailable" || typeof marker.at !== "string"
      || !Number.isFinite(Date.parse(marker.at)) || new Date(marker.at).toISOString() !== marker.at
      || Date.parse(marker.at) < first.computedAt.getTime()) return invalid();
    refreshFailure = { at: marker.at, kind: "source-unavailable" };
  }
  const models = ["LedgerAccount", "JournalEntry", "JournalLine"];
  for (const row of rows) {
    const meta = metadata(row);
    if (!meta || !keys.includes(row.metricKey) || row.definitionVersion !== SOFTWARE_LEDGER_DEFINITION_VERSION
      || row.unit !== "currency" || row.timezone !== "UTC"
      || ![row.periodStart, row.periodEnd, row.sourceWatermark, row.computedAt].every(validDate)
      || row.periodStart.getTime() !== first.periodStart.getTime() || row.periodEnd.getTime() !== first.periodEnd.getTime()
      || row.computedAt.getTime() !== first.computedAt.getTime() || row.sourceWatermark.getTime() !== first.sourceWatermark.getTime()
      || row.sourceWatermark.getTime() > row.computedAt.getTime() || row.availability !== first.availability
      || meta.generation !== base.generation || meta.currency !== base.currency || meta.sourceRows !== base.sourceRows
      || JSON.stringify(meta.refreshFailure) !== JSON.stringify(base.refreshFailure)
      || meta.coverage !== base.coverage || JSON.stringify(meta.sourceModels) !== JSON.stringify(models)) return invalid();
    if (row.availability === "available") {
      if (typeof meta.currency !== "string" || !isSupportedLedgerCurrency(meta.currency)
        || typeof meta.sourceRows !== "number" || !Number.isInteger(meta.sourceRows) || meta.sourceRows < 1 || meta.sourceRows > 13000
        || typeof row.value !== "number" || !Number.isFinite(row.value) || !Number.isSafeInteger(toMinorUnits(row.value))
        || toMinorUnits(row.value) / 100 !== row.value) return invalid();
    } else if (row.value !== null || meta.currency !== null || meta.sourceRows !== null
      || !row.unavailableReason?.trim()) return invalid();
  }
  if (first.availability === "available") {
    const values = new Map(rows.map(r => [r.metricKey, toMinorUnits(r.value!)]));
    const net = values.get("posted-ledger-income")! - values.get("posted-ledger-expenses")!;
    if (!Number.isSafeInteger(net) || net !== values.get("posted-ledger-net-result")) return invalid();
  }
  return { valid: true, currency: base.currency as string | null, lineage: {
    sourceModels: models, sourceRows: base.sourceRows as number | null, currency: base.currency as string | null,
    generation: base.generation, coverage: "recorded-postings-only", ...(refreshFailure ? { refreshFailure } : {}),
  } };
}

/** Preserve the canonical ledger's meaning and evidence; no invoice/payment/build proxies. */
export function projectSoftwareLedgerMetrics(
  report: ScopedLedgerPeriodReport,
  expected: { organizationId: string; periodKey: string },
) {
  if (report.organizationId !== expected.organizationId || report.periodKey !== expected.periodKey) {
    throw new Error("Ledger report does not match the requested organization and period.");
  }
  const statement = report.availability === "available" ? report.incomeStatement : null;
  return {
    values: {
      "posted-ledger-income": statement?.revenue ?? null,
      "posted-ledger-expenses": statement?.expenses ?? null,
      "posted-ledger-net-result": statement?.netIncome ?? null,
    },
    reason: report.availability === "unavailable" ? report.reason : null,
    currency: report.availability === "available" ? report.currency : null,
    sourceRows: report.availability === "available"
      ? report.sourceRows.accounts + report.sourceRows.entries + report.sourceRows.lines : null,
    checkedAt: report.checkedAt,
  };
}
