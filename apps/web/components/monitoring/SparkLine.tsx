"use client";

import { useMetricRangeQuery } from "./useMetricRangeQuery";

type Props = {
  query: string;
  duration?: string;
  color?: string;
  width?: number;
  height?: number;
  className?: string;
};

export function SparkLine({
  query,
  duration = "1h",
  color = "var(--dpf-accent)",
  width = 80,
  height = 20,
  className = "",
}: Props) {
  const { data, offline } = useMetricRangeQuery(query, duration, "60s", 30_000);

  if (offline || !data || data.length === 0) {
    return <div className={`inline-block ${className}`} style={{ width, height }} />;
  }

  const values = (data[0]?.values ?? []).map(([, v]) => parseFloat(v));
  if (values.length === 0) return <div className={`inline-block ${className}`} style={{ width, height }} />;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 2) - 1;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={`inline-block ${className}`}
      style={{ width, height }}
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
