// Standalone type module so the enrichment logic can declare the
// SupportStatus union without dragging in apps/web (where the canonical
// type lives next to the lifecycle evaluator). Keep this list in sync
// with apps/web/lib/customer-estate/lifecycle-evaluation.ts.

export type SupportStatus =
  | "supported"
  | "approaching_end"
  | "expired"
  | "coverage_gap"
  | "unknown";
