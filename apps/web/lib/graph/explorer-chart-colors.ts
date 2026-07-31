// Category palette for the admin graph explorer canvas (BI-89A149A9).
//
// An approved home for raw colour values, in the sense the style-drift guard
// means it (`scripts/check-style-drift.mjs` APPROVED_NAME_RE): these are series
// colours painted onto a `<canvas>` through `ctx.fillStyle` / `ctx.strokeStyle`,
// which cannot resolve `var(--dpf-*)`. Keeping them in one file means
// `explorer-vocabulary.ts` stays free of literals and there is a single place to
// retune the palette.
//
// The report-kit `statusColors` registry is deliberately not used: it maps
// status → semantic intent, a different axis from graph node category.

/** Node-category colours, keyed by the descriptor key in explorer-vocabulary.ts. */
export const NODE_CATEGORY_COLORS = {
  CodeRoute: "#a78bfa",
  CodeTool: "#f472b6",
  TestFile: "#34d399",
  CodeFile: "#38bdf8",
  CodeSymbol: "#7dd3fc",
  ExternalModule: "#94a3b8",
  PrismaModel: "#fbbf24",
  PrismaField: "#fcd34d",
  EaElement: "#4ade80",
  InfraCI: "#22d3ee",
  Portfolio: "#818cf8",
  DigitalProduct: "#4ade80",
  TaxonomyNode: "#fb923c",
} as const satisfies Record<string, string>;

/** Any ArchiMate type without a curated entry of its own. */
export const ARCHIMATE_DEFAULT_COLOR = "#86efac";

/** Unknown node label or relationship type — deliberately the muted neutral. */
export const UNKNOWN_CATEGORY_COLOR = "#8888a0";

/** Relationship colours, keyed by `graph_edge.rel_type`. */
export const REL_TYPE_COLORS: Record<string, string> = {
  IMPORTS: "#38bdf8",
  DEFINES: "#7dd3fc",
  HAS_FIELD: "#fcd34d",
  TESTED_BY: "#34d399",
  ASSOCIATED_WITH: "#86efac",
  RELATES_TO: "#4ade80",
  IMPLEMENTS_ROUTE: "#a78bfa",
  EXPOSES_TOOL: "#f472b6",
  BELONGS_TO: "#818cf8",
  DEPENDS_ON: "#22d3ee",
  MEMBER_OF: "#a78bfa",
  MONITORS: "#fbbf24",
  HOSTS: "#22d3ee",
  RUNS_ON: "#34d399",
  ROUTES_THROUGH: "#f472b6",
};
