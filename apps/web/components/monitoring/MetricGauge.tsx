"use client";

import { useMetricQuery } from "./useMetricQuery";

type Props = {
  query: string;
  label: string;
  unit?: string;
  thresholds?: { warning: number; critical: number };
  className?: string;
};

export function MetricGauge({
  query,
  label,
  unit = "%",
  thresholds = { warning: 70, critical: 85 },
  className = "",
}: Props) {
  const { data, loading, offline } = useMetricQuery(query);

  const value = data?.[0]?.value?.[1];
  const numValue = value !== undefined ? parseFloat(value) : null;

  const color =
    numValue === null
      ? "var(--dpf-muted)"
      : numValue >= thresholds.critical
        ? "var(--dpf-error)"
        : numValue >= thresholds.warning
          ? "var(--dpf-warning)"
          : "var(--dpf-success)";

  // SVG arc gauge
  const radius = 40;
  const circumference = Math.PI * radius; // half circle
  const pct = numValue !== null ? Math.min(numValue / 100, 1) : 0;
  const offset = circumference * (1 - pct);

  if (offline) {
    return (
      <div className={`flex flex-col items-center gap-1 p-3 rounded-lg bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] ${className}`}>
        <span className="text-xs text-[var(--dpf-muted)]">{label}</span>
        <span className="text-xs text-[var(--dpf-muted)]">Monitoring offline</span>
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center gap-1 p-3 rounded-lg bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] ${className}`}>
      <svg viewBox="0 0 100 60" className="w-24 h-14">
        {/* Background arc */}
        <path
          d="M 10 55 A 40 40 0 0 1 90 55"
          fill="none"
          stroke="var(--dpf-border)"
          strokeWidth="8"
          strokeLinecap="round"
        />
        {/* Value arc */}
        <path
          d="M 10 55 A 40 40 0 0 1 90 55"
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${circumference}`}
          strokeDashoffset={`${offset}`}
          className="transition-all duration-500"
        />
        {/* Value text */}
        <text
          x="50"
          y="50"
          textAnchor="middle"
          fontSize="14"
          fontWeight="bold"
          fill={color}
        >
          {loading ? "..." : numValue !== null ? `${Math.round(numValue)}${unit}` : "--"}
        </text>
      </svg>
      <span className="text-xs font-medium text-[var(--dpf-text)]">{label}</span>
    </div>
  );
}
