import type { PerformanceMetricDefinition } from "@dpf/storefront-templates";

export type MetricUnit = PerformanceMetricDefinition["unit"];

export function formatMetricValue(value: number | null, unit: MetricUnit): string {
  if (value === null) return "Not available";
  switch (unit) {
    case "currency":
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(value);
    case "percent":
    case "rate":
      return new Intl.NumberFormat("en-US", {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(value);
    case "duration": {
      const hours = Math.floor(value / 60);
      const minutes = Math.round(value % 60);
      return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    }
    default:
      return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
  }
}

export function formatComparisonDelta(delta: number): string {
  return `${delta > 0 ? "+" : ""}${new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(delta)}`;
}

export function formatComparisonMagnitude(delta: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(Math.abs(delta));
}

export function chartMetricValue(value: number | null, unit: MetricUnit): number | null {
  return value !== null && (unit === "percent" || unit === "rate") ? value * 100 : value;
}
