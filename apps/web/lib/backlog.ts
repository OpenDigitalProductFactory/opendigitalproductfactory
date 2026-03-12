// Pure utility library — no server imports. Safe in tests and client components.

export type BacklogItemInput = {
  title: string;
  type: "product" | "portfolio";
  status: "open" | "in-progress" | "done" | "deferred";
  priority?: number;
  body?: string;
  taxonomyNodeId?: string;
  digitalProductId?: string;
  epicId?: string;
};

export type BacklogItemWithRelations = {
  id: string;
  itemId: string;
  title: string;
  status: string;
  type: string;
  body: string | null;
  priority: number | null;
  epicId: string | null;
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

export type PortfolioForSelect = {
  id: string;
  slug: string;
  name: string;
};

export type EpicInput = {
  title: string;
  description?: string;
  status: "open" | "in-progress" | "done";
  portfolioIds: string[];
};

export type EpicForSelect = {
  id: string;
  epicId: string;
  title: string;
};

export type EpicPortfolioLink = {
  epicId: string;
  portfolioId: string;
  portfolio: { id: string; slug: string; name: string };
};

export type EpicWithRelations = {
  id: string;
  epicId: string;
  title: string;
  description: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  portfolios: EpicPortfolioLink[];
  items: BacklogItemWithRelations[];
};

/** Returns null if valid, or an error message if invalid. */
export function validateBacklogInput(input: BacklogItemInput): string | null {
  if (!input.title.trim()) return "Title is required";
  if (input.type === "product" && !input.digitalProductId) {
    return "A digital product is required for product-type items";
  }
  return null;
}

export const EPIC_STATUSES = ["open", "in-progress", "done"] as const;
export type EpicStatus = typeof EPIC_STATUSES[number];

/** Returns null if valid, or an error message if invalid. */
export function validateEpicInput(input: EpicInput): string | null {
  if (!input.title.trim()) return "Title is required";
  if (!(EPIC_STATUSES as readonly string[]).includes(input.status)) return "Invalid status";
  return null;
}

/** Status badge colours (inline styles). */
export const BACKLOG_STATUS_COLOURS: Record<string, string> = {
  "open":        "#38bdf8",
  "in-progress": "#fb923c",
  "done":        "#4ade80",
  "deferred":    "#555566",
};

/** Epic status badge colours (inline styles). */
export const EPIC_STATUS_COLOURS: Record<string, string> = {
  "open":        "#38bdf8",
  "in-progress": "#fb923c",
  "done":        "#4ade80",
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
