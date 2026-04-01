"use client";

import { useMetricQuery } from "./useMetricQuery";

type Props = {
  query: string;
  label: string;
  unit?: string;
  format?: (v: number) => string;
  className?: string;
};

export function MetricStat({
  query,
  label,
  unit = "",
  format,
  className = "",
}: Props) {
  const { data, loading, offline } = useMetricQuery(query);

  const value = data?.[0]?.value?.[1];
  const numValue = value !== undefined ? parseFloat(value) : null;

  const displayValue = loading
    ? "..."
    : offline
      ? "--"
      : numValue !== null
        ? format
          ? format(numValue)
          : `${Number.isInteger(numValue) ? numValue : numValue.toFixed(1)}${unit}`
        : "--";

  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <span className="text-lg font-bold text-[var(--dpf-text)]">{displayValue}</span>
      <span className="text-[10px] text-[var(--dpf-muted)]">{label}</span>
    </div>
  );
}
