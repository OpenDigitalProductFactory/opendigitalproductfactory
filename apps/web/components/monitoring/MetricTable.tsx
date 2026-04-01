"use client";

import { useMetricQuery } from "./useMetricQuery";
import { SparkLine } from "./SparkLine";

type MetricRow = {
  label: string;
  query: string;
  sparkQuery?: string;
  unit?: string;
  format?: (v: number) => string;
};

type Props = {
  rows: MetricRow[];
  className?: string;
};

function MetricCell({ query, unit = "", format }: { query: string; unit?: string; format?: (v: number) => string }) {
  const { data, loading, offline } = useMetricQuery(query);
  const value = data?.[0]?.value?.[1];
  const numValue = value !== undefined ? parseFloat(value) : null;

  if (offline) return <span className="text-[var(--dpf-muted)]">--</span>;
  if (loading) return <span className="text-[var(--dpf-muted)]">...</span>;
  if (numValue === null) return <span className="text-[var(--dpf-muted)]">--</span>;

  const display = format
    ? format(numValue)
    : `${Number.isInteger(numValue) ? numValue : numValue.toFixed(1)}${unit}`;

  return <span className="font-mono">{display}</span>;
}

export function MetricTable({ rows, className = "" }: Props) {
  return (
    <div className={`rounded-lg border border-[var(--dpf-border)] overflow-hidden ${className}`}>
      <table className="w-full text-xs">
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-[var(--dpf-border)] last:border-b-0">
              <td className="px-3 py-1.5 text-[var(--dpf-muted)] bg-[var(--dpf-surface-2)]">
                {row.label}
              </td>
              <td className="px-3 py-1.5 text-[var(--dpf-text)] text-right">
                <MetricCell query={row.query} unit={row.unit} format={row.format} />
              </td>
              <td className="px-2 py-1.5 w-20">
                {row.sparkQuery && <SparkLine query={row.sparkQuery} width={80} height={16} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
