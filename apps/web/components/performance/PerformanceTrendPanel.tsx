"use client";

import { useMemo, useState } from "react";

import {
  DataTable,
  FilterBar,
  Notice,
  type Column,
} from "@/components/ui/report-kit";
import { Chart } from "@/components/ui/report-kit/Chart";
import type {
  BusinessPerformanceTrendPoint,
} from "@/lib/performance/business-performance-provider";
import {
  chartMetricValue,
  formatMetricValue,
  type MetricUnit,
} from "@/lib/performance/performance-format";

interface TrendTableRow {
  periodKey: string;
  periodLabel: string;
  value: number | null;
  formattedValue: string;
}

interface TrendMetricOption {
  key: string;
  label: string;
  unit: MetricUnit;
}

export function PerformanceTrendPanel({
  points,
  metrics,
  preferredKeys,
}: {
  points: readonly BusinessPerformanceTrendPoint[];
  metrics: readonly TrendMetricOption[];
  preferredKeys: readonly string[];
}) {
  const options = preferredKeys
    .map((key) => metrics.find((metric) => metric.key === key))
    .filter((metric): metric is TrendMetricOption => Boolean(metric))
    .slice(0, 4);
  const [selectedKey, setSelectedKey] = useState(options[0]?.key ?? "");
  const selected = metrics.find((metric) => metric.key === selectedKey) ?? options[0];

  const rows = useMemo<TrendTableRow[]>(() => {
    if (!selected) return [];
    return points.map((point) => {
      const value = point.values[selected.key] ?? null;
      return {
        periodKey: point.periodKey,
        periodLabel: point.periodLabel,
        value,
        formattedValue: formatMetricValue(value, selected.unit),
      };
    });
  }, [points, selected]);

  if (!selected) {
    return (
      <Notice title="Trend history is not ready">
        No metric definitions are available for this archetype.
      </Notice>
    );
  }

  const columns: Column<TrendTableRow>[] = [
    {
      key: "period",
      header: "Period",
      cell: (row) => row.periodLabel,
      sortAccessor: (row) => row.periodKey,
    },
    {
      key: "value",
      header: selected.label,
      cell: (row) => row.formattedValue,
      align: "right",
      sortAccessor: (row) => row.value ?? Number.NEGATIVE_INFINITY,
    },
  ];
  const chartRows = rows.map((row) => ({
    period: row.periodLabel,
    value: chartMetricValue(row.value, selected.unit),
  }));

  return (
    <section className="space-y-3" aria-labelledby="performance-trends">
      <div>
        <h2 id="performance-trends" className="text-base font-semibold text-[var(--dpf-text)]">
          Trends
        </h2>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
          Historical snapshots use the same versioned definition as the selected metric.
        </p>
      </div>
      <FilterBar
        facets={[{
          kind: "pills",
          key: "metric",
          label: "Metric",
          options: options.map((metric) => ({ value: metric.key, label: metric.label })),
        }]}
        value={{ metric: selected.key }}
        onChange={(next) => setSelectedKey(next.metric || options[0]!.key)}
      />
      <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <Chart
          type="line"
          data={chartRows}
          xKey="period"
          series={[{ key: "value", label: selected.label, intent: "info" }]}
          height={220}
        />
      </div>
      <details className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
        <summary className="cursor-pointer text-sm font-medium text-[var(--dpf-text)]">
          View trend as a table
        </summary>
        <DataTable
          className="mt-3"
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.periodKey}
          initialSort={{ key: "period", dir: "desc" }}
          dense
        />
      </details>
    </section>
  );
}
