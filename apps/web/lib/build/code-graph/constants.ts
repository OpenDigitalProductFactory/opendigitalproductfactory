export const CODE_GRAPH_JOB_ID = "code-graph-reconcile";
export const CODE_GRAPH_JOB_NAME = "Code Graph Reconcile";
export const CODE_GRAPH_JOB_SCHEDULE = "every-15m";
export const CODE_GRAPH_EVENT_NAME = "ops/code-graph.reconcile";
export const CODE_GRAPH_GRAPH_KEY = "source-code";
export const CODE_GRAPH_PROJECTION_VERSION = 3;

export const CODE_GRAPH_FILE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".prisma",
  ".sql",
  ".svg",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

export const CODE_GRAPH_TRACKED_FILE_EXCLUDES = [
  ".pnpm-store",
  "**/.pnpm-store/**",
  ".next",
  "**/.next/**",
  "packages/db/generated",
  "packages/db/generated/**",
  "node_modules",
  "**/node_modules/**",
];
