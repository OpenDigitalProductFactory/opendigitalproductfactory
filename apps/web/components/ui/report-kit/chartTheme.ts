// apps/web/components/ui/report-kit/chartTheme.ts
//
// Pure theming helpers for the report-kit charts. Kept free of any recharts
// import so it is safe to unit-test in the node test environment (recharts is
// browser-oriented and renders via a sized container, not in SSR/node).
//
// All colors resolve to --dpf-* design tokens — never raw hex.

import { intentStyle, type Intent } from "./statusColors";

/** Default series color ramp, drawn from the design tokens. */
export const DEFAULT_SERIES_PALETTE: string[] = [
  "var(--dpf-accent)",
  "var(--dpf-info)",
  "var(--dpf-success)",
  "var(--dpf-warning)",
  "var(--dpf-error)",
];

export interface ChartSeries {
  /** Key into each data row. */
  key: string;
  /** Legend/tooltip label (defaults to `key`). */
  label?: string;
  /** Explicit color, or an intent to resolve from tokens; else palette by index. */
  color?: string;
  intent?: Intent;
}

/** Resolve the stroke/fill color for a series at a given index. */
export function resolveSeriesColor(series: ChartSeries, index: number): string {
  if (series.color) return series.color;
  if (series.intent) return intentStyle(series.intent).fg;
  return DEFAULT_SERIES_PALETTE[index % DEFAULT_SERIES_PALETTE.length];
}

/** Axis tick styling shared by every chart type. */
export const axisTick = { fill: "var(--dpf-muted)", fontSize: 11 } as const;

/** Cartesian grid stroke. */
export const gridStroke = "var(--dpf-border)";

/** Tooltip container styling (token-backed surface). */
export const tooltipStyle = {
  background: "var(--dpf-surface-1)",
  border: "1px solid var(--dpf-border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--dpf-text)",
} as const;
