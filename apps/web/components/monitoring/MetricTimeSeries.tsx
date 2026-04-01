"use client";

import { useMetricRangeQuery } from "./useMetricRangeQuery";

type Props = {
  query: string;
  label: string;
  unit?: string;
  duration?: string;
  step?: string;
  className?: string;
};

export function MetricTimeSeries({
  query,
  label,
  unit = "",
  duration = "1h",
  step = "15s",
  className = "",
}: Props) {
  const { data, loading, offline } = useMetricRangeQuery(query, duration, step);

  if (offline) {
    return (
      <div className={`p-3 rounded-lg bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] ${className}`}>
        <span className="text-xs text-[var(--dpf-muted)]">{label} -- Monitoring offline</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={`p-3 rounded-lg bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] ${className}`}>
        <span className="text-xs text-[var(--dpf-muted)]">{label} -- Loading...</span>
      </div>
    );
  }

  // Collect all series
  const series = (data ?? []).map((d) => ({
    label: d.metric.instance || d.metric.name || d.metric.job || label,
    values: d.values.map(([ts, v]) => ({ ts, v: parseFloat(v) })),
  }));

  if (series.length === 0 || series[0]!.values.length === 0) {
    return (
      <div className={`p-3 rounded-lg bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] ${className}`}>
        <span className="text-xs text-[var(--dpf-muted)]">{label} -- No data</span>
      </div>
    );
  }

  // Chart dimensions
  const w = 400;
  const h = 100;
  const pad = { top: 5, right: 5, bottom: 15, left: 40 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  // Global min/max across all series
  const allValues = series.flatMap((s) => s.values.map((v) => v.v));
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const range = maxVal - minVal || 1;

  const colors = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6"];

  // Time range
  const firstTs = series[0]!.values[0]!.ts;
  const lastTs = series[0]!.values[series[0]!.values.length - 1]!.ts;
  const tsRange = lastTs - firstTs || 1;

  return (
    <div className={`p-3 rounded-lg bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] ${className}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-[var(--dpf-text)]">{label}</span>
        {series.length === 1 && series[0]!.values.length > 0 && (
          <span className="text-xs text-[var(--dpf-muted)]">
            {formatValue(series[0]!.values[series[0]!.values.length - 1]!.v, unit)}
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: 120 }}>
        {/* Y-axis labels */}
        <text x={pad.left - 4} y={pad.top + 8} textAnchor="end" fontSize="8" fill="var(--dpf-muted)">
          {formatValue(maxVal, unit)}
        </text>
        <text x={pad.left - 4} y={h - pad.bottom} textAnchor="end" fontSize="8" fill="var(--dpf-muted)">
          {formatValue(minVal, unit)}
        </text>

        {/* Grid lines */}
        <line x1={pad.left} y1={pad.top} x2={w - pad.right} y2={pad.top} stroke="var(--dpf-border)" strokeWidth="0.5" />
        <line x1={pad.left} y1={h - pad.bottom} x2={w - pad.right} y2={h - pad.bottom} stroke="var(--dpf-border)" strokeWidth="0.5" />

        {/* Data lines */}
        {series.map((s, si) => {
          const points = s.values
            .map((pt) => {
              const x = pad.left + ((pt.ts - firstTs) / tsRange) * chartW;
              const y = pad.top + chartH - ((pt.v - minVal) / range) * chartH;
              return `${x},${y}`;
            })
            .join(" ");
          return (
            <polyline
              key={si}
              points={points}
              fill="none"
              stroke={colors[si % colors.length]}
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          );
        })}

        {/* X-axis time labels */}
        <text x={pad.left} y={h - 2} fontSize="7" fill="var(--dpf-muted)">
          {formatTime(firstTs)}
        </text>
        <text x={w - pad.right} y={h - 2} textAnchor="end" fontSize="7" fill="var(--dpf-muted)">
          {formatTime(lastTs)}
        </text>
      </svg>

      {/* Legend for multiple series */}
      {series.length > 1 && (
        <div className="flex flex-wrap gap-2 mt-1">
          {series.map((s, i) => (
            <span key={i} className="flex items-center gap-1 text-[10px] text-[var(--dpf-muted)]">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: colors[i % colors.length] }}
              />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function formatValue(v: number, unit: string): string {
  if (unit === "s") return v >= 1 ? `${v.toFixed(1)}s` : `${Math.round(v * 1000)}ms`;
  if (unit === "bytes") {
    if (v >= 1e9) return `${(v / 1e9).toFixed(1)}GB`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(0)}MB`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(0)}KB`;
    return `${Math.round(v)}B`;
  }
  if (unit === "%") return `${Math.round(v)}%`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return Number.isInteger(v) ? v.toString() : v.toFixed(2);
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}
