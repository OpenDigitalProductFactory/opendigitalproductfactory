// apps/web/components/ui/report-kit/Chart.tsx
//
// Business-data charting for the reporting palette — a thin, token-themed
// wrapper over recharts (line / bar / area). Distinct from the Prometheus-bound
// monitoring SVG charts: this takes arbitrary in-memory data via props.
//
// Client component (recharts measures its container). A server page passes
// already-fetched, serialized data down — same pattern as DataTable.

"use client";

import {
  ResponsiveContainer,
  LineChart,
  BarChart,
  AreaChart,
  Line,
  Bar,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

import {
  axisTick,
  gridStroke,
  resolveSeriesColor,
  tooltipStyle,
  type ChartSeries,
} from "./chartTheme";

export type { ChartSeries } from "./chartTheme";

export interface ChartProps {
  type: "line" | "bar" | "area";
  data: Record<string, unknown>[];
  /** Row key for the X axis. */
  xKey: string;
  series: ChartSeries[];
  height?: number;
  showGrid?: boolean;
  showLegend?: boolean;
  className?: string;
}

export function Chart({
  type,
  data,
  xKey,
  series,
  height = 240,
  showGrid = true,
  showLegend = false,
  className = "",
}: ChartProps) {
  const grid = showGrid ? (
    <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
  ) : null;
  const axes = (
    <>
      <XAxis dataKey={xKey} tick={axisTick} stroke={gridStroke} />
      <YAxis tick={axisTick} stroke={gridStroke} width={36} />
    </>
  );
  const tooltip = <Tooltip contentStyle={tooltipStyle} />;
  const legend = showLegend ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null;

  return (
    <div className={className} style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        {type === "line" ? (
          <LineChart data={data}>
            {grid}
            {axes}
            {tooltip}
            {legend}
            {series.map((s, i) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label ?? s.key}
                stroke={resolveSeriesColor(s, i)}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        ) : type === "bar" ? (
          <BarChart data={data}>
            {grid}
            {axes}
            {tooltip}
            {legend}
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label ?? s.key}
                fill={resolveSeriesColor(s, i)}
                radius={[2, 2, 0, 0]}
              />
            ))}
          </BarChart>
        ) : (
          <AreaChart data={data}>
            {grid}
            {axes}
            {tooltip}
            {legend}
            {series.map((s, i) => {
              const color = resolveSeriesColor(s, i);
              return (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label ?? s.key}
                  stroke={color}
                  fill={color}
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
              );
            })}
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
