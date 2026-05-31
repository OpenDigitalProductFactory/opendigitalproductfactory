// apps/web/lib/canonical-primitives.ts
//
// Single source of truth for canonical, first-party REUSABLE component palettes.
// Consumed by `analyze_reusability` (Ideate-time reusability analysis) and the
// codebase manifest, so agents (Build Studio / Claude / Codex) and humans
// DISCOVER the blessed primitive instead of hand-rolling a parallel one-off.
//
// Keep in lockstep with the kernel principle each entry cites
// (docs/founder-kernel/wiki/principles/<principleSlug>.md). The API contract
// itself lives in the palette's own README/types — this registry only points
// to it, so the two can't drift.

export interface CanonicalPrimitive {
  /** Registry key, e.g. "report-kit". */
  name: string;
  /** Repo-relative path to the palette. */
  path: string;
  /** One-line purpose. */
  purpose: string;
  /** Exported primitives an agent should compose. */
  exports: string[];
  /** Lowercase keywords whose presence means this palette should be composed. */
  triggers: string[];
  /** Kernel principle slug that makes composing it normative. */
  principleSlug: string;
  /** Where the API contract is documented. */
  docs: string;
}

export const CANONICAL_PRIMITIVES: CanonicalPrimitive[] = [
  {
    name: "report-kit",
    path: "apps/web/components/ui/report-kit",
    purpose:
      "Shared reporting & data-display palette: status/severity badges, sortable tables, KPI cards, filter bars, CSV export, and business-data charts.",
    exports: ["StatusBadge", "DataTable", "FilterBar", "StatCard", "ExportButton", "Chart", "statusColors"],
    triggers: [
      "status badge",
      "severity badge",
      "badge",
      "kpi",
      "metric card",
      "stat card",
      "summary card",
      "dashboard",
      "data table",
      "list page",
      "filter bar",
      "csv export",
      "export to csv",
      "download csv",
      "chart",
      "trend chart",
      "line chart",
      "bar chart",
      "status color",
      "severity color",
    ],
    principleSlug: "compose-report-kit-for-reporting-ux",
    docs: "apps/web/components/ui/report-kit/README.md",
  },
];

/**
 * Return the canonical primitives whose triggers appear anywhere in `text`
 * (case-insensitive). Used to tell an agent "compose this existing palette
 * rather than hand-rolling" during reusability analysis.
 */
export function matchCanonicalPrimitives(text: string): CanonicalPrimitive[] {
  const hay = (text ?? "").toLowerCase();
  if (!hay.trim()) return [];
  return CANONICAL_PRIMITIVES.filter((p) => p.triggers.some((t) => hay.includes(t)));
}
