"use client";

// BI-FEDD8F45 — the two read-only tables on /ops/gate-efficacy. A client
// wrapper only because report-kit's DataTable takes cell renderers; every row
// arrives already computed and serializable from the server page.

import { DataTable, type Column } from "@/components/ui/report-kit/DataTable";
import { StatusBadge } from "@/components/ui/report-kit/StatusBadge";
import type { Measure } from "@/lib/gpp/efficacy/efficacy-measures";

export type GuardRow = {
  guardId: string;
  runs: number;
  totalDurationMs: number;
  medianDurationMs: number;
  catchRate: Measure;
  falseRefusalRate: Measure;
  overrideRate: Measure;
  undecidedShare: Measure;
};

function formatValue(m: Measure): string {
  if (m.value === null) return "Unknown";
  if (m.unit === "count") return m.value.toLocaleString();
  if (m.unit === "decisions/effect") return `${m.value.toFixed(2)} decisions per effect`;
  return `${(m.value * 100).toFixed(m.value < 0.1 ? 1 : 0)}%`;
}

function fraction(m: Measure): string {
  if (m.unit === "count" || m.numerator === null || m.denominator === null) return "";
  return `${m.numerator.toLocaleString()} of ${m.denominator.toLocaleString()}`;
}

function duration(ms: number): string {
  return ms >= 60_000 ? `${(ms / 60_000).toFixed(1)} min` : `${(ms / 1000).toFixed(1)} s`;
}

function ValueCell({ m }: { m: Measure }) {
  if (m.value === null) return <StatusBadge intent="warning" label="Unknown" />;
  return (
    <span>
      {formatValue(m)} <span className="text-[var(--dpf-muted)]">{fraction(m)}</span>
    </span>
  );
}

const MEASURE_COLUMNS: Column<Measure>[] = [
  { key: "id", header: "Measure", cell: (m) => `${m.id} ${m.label}`, sortAccessor: (m) => m.id },
  { key: "value", header: "Value", cell: (m) => <ValueCell m={m} /> },
  { key: "omits", header: "What it leaves out", cell: (m) => m.omits || "—" },
];

const GUARD_COLUMNS: Column<GuardRow>[] = [
  { key: "guard", header: "Guard", mono: true, cell: (g) => g.guardId, sortAccessor: (g) => g.guardId },
  { key: "runs", header: "Runs", align: "right", cell: (g) => g.runs.toLocaleString(), sortAccessor: (g) => g.runs },
  { key: "total", header: "Total time", align: "right", cell: (g) => duration(g.totalDurationMs), sortAccessor: (g) => g.totalDurationMs },
  { key: "median", header: "Median", align: "right", cell: (g) => duration(g.medianDurationMs) },
  { key: "caught", header: "Caught", cell: (g) => <ValueCell m={g.catchRate} /> },
  { key: "false", header: "False refusal", cell: (g) => <ValueCell m={g.falseRefusalRate} /> },
  { key: "override", header: "Overridden", cell: (g) => <ValueCell m={g.overrideRate} /> },
  { key: "undecided", header: "Undecided", cell: (g) => <ValueCell m={g.undecidedShare} /> },
];

export function MeasureTable({ rows, label }: { rows: Measure[]; label: string }) {
  return <DataTable columns={MEASURE_COLUMNS} rows={rows} getRowKey={(m) => m.id} ariaLabel={label} dense responsive />;
}

export function GuardTable({ rows }: { rows: GuardRow[] }) {
  return (
    <DataTable
      columns={GUARD_COLUMNS}
      rows={rows}
      getRowKey={(g) => g.guardId}
      ariaLabel="Guards by total time"
      initialSort={{ key: "total", dir: "desc" }}
      pageSize={25}
      dense
      responsive
      empty="No guard runs were recorded in this period."
    />
  );
}
