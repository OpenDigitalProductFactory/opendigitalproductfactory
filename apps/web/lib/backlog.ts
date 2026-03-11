// Pure utility library — no server imports. Safe in tests and client components.

export type BacklogItemInput = {
  title: string;
  type: "product" | "portfolio";
  status: "open" | "in-progress" | "done" | "deferred";
  priority?: number;
  body?: string;
  taxonomyNodeId?: string;
  digitalProductId?: string;
};

export type BacklogItemWithRelations = {
  id: string;
  itemId: string;
  title: string;
  status: string;
  type: string;
  body: string | null;
  priority: number | null;
  digitalProduct: { id: string; productId: string; name: string } | null;
  taxonomyNode: { id: string; nodeId: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DigitalProductSelect = {
  id: string;
  productId: string;
  name: string;
  lifecycleStage: string;
};

export type TaxonomyNodeSelect = {
  id: string;
  nodeId: string;
  name: string;
};

/** Returns null if valid, or an error message if invalid. */
export function validateBacklogInput(input: BacklogItemInput): string | null {
  if (!input.title.trim()) return "Title is required";
  if (input.type === "product" && !input.digitalProductId) {
    return "A digital product is required for product-type items";
  }
  return null;
}

/** Status badge colours (Tailwind inline styles). */
export const BACKLOG_STATUS_COLOURS: Record<string, string> = {
  "open":        "#38bdf8",
  "in-progress": "#fb923c",
  "done":        "#4ade80",
  "deferred":    "#555566",
};

/** Human-readable labels for CSDM lifecycle stages. */
export const LIFECYCLE_STAGE_LABELS: Record<string, string> = {
  plan:       "Plan",
  design:     "Design",
  build:      "Build",
  production: "Production",
  retirement: "Retirement",
};

/** Human-readable labels for CSDM lifecycle statuses. */
export const LIFECYCLE_STATUS_LABELS: Record<string, string> = {
  draft:    "Draft",
  active:   "Active",
  inactive: "Inactive",
};
