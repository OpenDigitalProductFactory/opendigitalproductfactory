import {
  classifyContextFreshness,
  sortContextItems,
  type IntelligenceContextItem,
  type ScheduledPlaybookContextItem,
} from "./product-operating-context";

export type ProductIntelligenceAudience = "guided" | "professional";

export type ProductIntelligenceViewInput = {
  requestedAt: Date;
  audience: ProductIntelligenceAudience;
  product: {
    id: string;
    name: string;
    productLineId: string;
  };
  intelligence: IntelligenceContextItem[];
  watches: ScheduledPlaybookContextItem[];
};

export type ProductIntelligenceViewItem = IntelligenceContextItem & {
  scopeLabel: string;
  freshness: "fresh" | "stale" | "unknown";
};

export type ProductIntelligenceView = {
  product: ProductIntelligenceViewInput["product"];
  audience: ProductIntelligenceAudience;
  firstRun: boolean;
  emptyState: string | null;
  evidencePreviewCount: number;
  primaryAction: {
    kind: "propose-research";
    label: string;
  };
  pending: ProductIntelligenceViewItem[];
  reviewed: ProductIntelligenceViewItem[];
  drafts: ProductIntelligenceViewItem[];
  noFindings: ProductIntelligenceViewItem[];
  failed: ProductIntelligenceViewItem[];
  battlecards: ProductIntelligenceViewItem[];
  stale: ProductIntelligenceViewItem[];
  watches: ScheduledPlaybookContextItem[];
};

function scopeLabel(
  item: IntelligenceContextItem,
  product: ProductIntelligenceViewInput["product"],
): string {
  if (
    item.scope === "business-product" &&
    item.businessProductId === product.id
  ) {
    return "This product";
  }
  if (item.scope === "product-line") return "Product line";
  if (item.scope === "digital-product") return "Enabling digital architecture";
  if (item.scope === "business-product") return "Related product";
  return "Whole business";
}

export function buildProductIntelligenceView(
  input: ProductIntelligenceViewInput,
): ProductIntelligenceView {
  const items = sortContextItems(input.intelligence).map((item) => ({
    ...item,
    scopeLabel: scopeLabel(item, input.product),
    freshness: classifyContextFreshness(item.asOf, input.requestedAt, 30),
  }));
  const pending = items.filter(
    (item) =>
      item.sourceKind === "research-proposal" && item.status === "pending",
  );
  const reviewed = items.filter(
    (item) =>
      (item.sourceKind === "wiki-page" ||
        item.sourceKind === "knowledge-article") &&
      item.status === "published",
  );
  const reviewedProposalIds = new Set(
    reviewed.flatMap((item) =>
      item.relatedProposalId ? [item.relatedProposalId] : [],
    ),
  );
  const drafts = items.filter(
    (item) =>
      item.sourceKind === "research-proposal" &&
      item.status === "executed" &&
      !item.emptyReason &&
      !reviewedProposalIds.has(item.id),
  );
  const noFindings = items.filter(
    (item) =>
      item.sourceKind === "research-proposal" &&
      item.status === "executed" &&
      Boolean(item.emptyReason),
  );
  const failed = items.filter(
    (item) =>
      item.sourceKind === "research-proposal" && item.status === "failed",
  );
  const battlecards = items.filter(
    (item) => item.sourceKind === "marketing-battlecard",
  );
  const stale = items.filter((item) => item.freshness === "stale");
  const watches = [...input.watches].sort(
    (left, right) =>
      Number(right.isActive) - Number(left.isActive) ||
      (left.nextRunAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
        (right.nextRunAt?.getTime() ?? Number.MAX_SAFE_INTEGER) ||
      left.taskId.localeCompare(right.taskId),
  );
  const firstRun = items.length === 0 && watches.length === 0;

  return {
    product: input.product,
    audience: input.audience,
    firstRun,
    emptyState: firstRun
      ? "No reviewed product research yet. Preview a focused research proposal to start an evidence trail."
      : null,
    evidencePreviewCount: input.audience === "professional" ? 12 : 4,
    primaryAction: {
      kind: "propose-research",
      label: "Propose research",
    },
    pending,
    reviewed,
    drafts,
    noFindings,
    failed,
    battlecards,
    stale,
    watches,
  };
}
