import type {
  BusinessProductContextItem,
  ProductOperatingScope,
} from "./product-operating-context";

export type QueryDelegate<T> = {
  findMany(args: unknown): Promise<T[]>;
};

export type OptionalQueryDelegate<T> = QueryDelegate<T> & {
  findFirst(args: unknown): Promise<T | null>;
};

export type OrganizationRow = { id: string; name: string; updatedAt: Date };
export type ProductLineRow = {
  id: string;
  name: string;
  parentId: string | null;
  updatedAt: Date;
};
export type ProductRow = {
  id: string;
  productId: string;
  productLineId: string;
  name: string;
  updatedAt: Date;
};
export type DigitalProductRow = {
  id: string;
  productId: string;
  name: string;
  updatedAt: Date;
};
export type OfferingRow = {
  id: string;
  productId: string;
  providerOrganizationId: string;
  name: string;
  status: string;
  updatedAt: Date;
  catalogItems: Array<{
    id: string;
    name: string;
    status: string;
    updatedAt: Date;
  }>;
  operationalServiceOffering: {
    digitalProduct: DigitalProductRow;
  } | null;
};
export type NumberLike = number | { toNumber(): number };
export type ProductSoldRow = {
  id: string;
  productId: string;
  status: string;
  quantity: NumberLike;
  totalAmount: NumberLike;
  currency: string;
  purchasedAt: Date;
  parties: Array<{
    id: string;
    role: string;
    observedAt: Date;
    displaySnapshot: unknown;
  }>;
  evidence: Array<{
    id: string;
    evidenceKind: string;
    observedAt: Date;
    evidenceSnapshot: unknown;
  }>;
  componentAllocations: Array<{
    componentCatalogItemId: string;
    allocatedAmount: NumberLike | null;
    allocationMode: string;
  }>;
};
export type ResearchProposalRow = {
  proposalId: string;
  digitalProductId: string | null;
  productLineId: string | null;
  businessProductId: string | null;
  topic: string;
  query: string;
  status: string;
  resultSummary: string | null;
  metadata: unknown;
  updatedAt: Date;
};
export type BattlecardRow = {
  battlecardId: string;
  digitalProductId: string | null;
  productLineId: string | null;
  businessProductId: string | null;
  competitorName: string;
  status: string;
  updatedAt: Date;
};
export type ScheduledAgentTaskRow = {
  taskId: string;
  title: string;
  productLineId: string | null;
  businessProductId: string | null;
  schedule: string;
  isActive: boolean;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastStatus: string | null;
  updatedAt: Date;
};
export type KnowledgeArticleRow = {
  articleId: string;
  title: string;
  status: string;
  updatedAt: Date;
  products: Array<{ digitalProductId: string }>;
};
export type ReviewedResearchSourceRow = {
  sourceKey: string;
  locator: unknown;
  retrievedAt: Date | null;
  pageSources: Array<{
    page: {
      id: string;
      title: string;
      abstract: string | null;
      status: string;
      lastReviewedAt: Date | null;
      updatedAt: Date;
    };
  }>;
};
export type BacklogRow = {
  itemId: string;
  title: string;
  body: string | null;
  status: string;
  workType: string | null;
  organizationId: string | null;
  productLineId: string | null;
  businessProductId: string | null;
  digitalProductId: string | null;
  demandStage: string | null;
  demandScore: number | null;
  demandScoreFramework: string | null;
  effortSize: string | null;
  jobSize: number | null;
  reach: number | null;
  occurrenceCount: number | null;
  impact: number | null;
  confidence: number | null;
  businessValue: number | null;
  timeCriticality: number | null;
  riskOpportunity: number | null;
  investmentBucket: string | null;
  estimateAiJobSize: number | null;
  estimateHumanJobSize: number | null;
  estimateSource: string | null;
  estimateAgreed: boolean | null;
  claimStatus: string | null;
  claimedByAgentId: string | null;
  demandEvidenceLinks: Array<{
    evidenceLinkId: string;
    sourceKind: string;
    sourceRef: string;
    title: string;
    summary: string | null;
    confidence: number | null;
    reviewedAt: Date | null;
  }>;
  activities: Array<{
    kind: string;
    summary: string;
    recordedAt: Date;
    payload: unknown;
  }>;
  updatedAt: Date;
  epic: { epicId: string; title: string; status: string; updatedAt: Date } | null;
};
export type ChangeRow = {
  id: string;
  title: string;
  status: string;
  updatedAt: Date;
};
export type EaElementRow = {
  id: string;
  name: string;
  lifecycleStatus: string | null;
  updatedAt: Date;
};
export type DependencyRow = {
  id: string;
  relationType: string;
  createdAt: Date;
  fromProduct: { name: string };
  toProduct: { name: string };
};
export type ProductObjectiveRow = {
  objectiveId: string;
  title: string;
  problemStatement: string | null;
  outcomeHypothesis: string;
  status: string;
  measureKind: string;
  measureDefinition: string;
  measureUnit: string | null;
  baselineValue: NumberLike | null;
  targetValue: NumberLike | null;
  baselineNarrative: string | null;
  targetNarrative: string | null;
  reviewCadence: string | null;
  reviewAt: Date | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  ownerPrincipal: {
    principalId: string;
    displayName: string;
  } | null;
  contributingWork: Array<{
    contributionKind: string;
    backlogItem: {
      itemId: string;
      title: string;
      status: string;
    };
  }>;
  observations: Array<{
    observationId: string;
    observedAt: Date;
    numericValue: NumberLike | null;
    narrative: string | null;
    measureKind: string;
    measureUnit: string | null;
    sourceKind: string;
    sourceRef: string | null;
    confidence: number | null;
    supersedes: { observationId: string } | null;
    supersededBy: { observationId: string } | null;
    createdAt: Date;
    recordedByPrincipal: {
      principalId: string;
      displayName: string;
    } | null;
  }>;
};

export type ProductOperatingContextQueryClient = {
  organization: {
    findFirst(args: unknown): Promise<OrganizationRow | null>;
  };
  productLine: OptionalQueryDelegate<ProductLineRow>;
  product: OptionalQueryDelegate<ProductRow>;
  productOffering: QueryDelegate<OfferingRow>;
  productSold: QueryDelegate<ProductSoldRow>;
  researchProposal: QueryDelegate<ResearchProposalRow>;
  marketingBattlecard: QueryDelegate<BattlecardRow>;
  knowledgeArticle: QueryDelegate<KnowledgeArticleRow>;
  rawSource: QueryDelegate<ReviewedResearchSourceRow>;
  backlogItem: QueryDelegate<BacklogRow>;
  changeItem: QueryDelegate<ChangeRow>;
  eaElement: QueryDelegate<EaElementRow>;
  productDependency: QueryDelegate<DependencyRow>;
  scheduledAgentTask: QueryDelegate<ScheduledAgentTaskRow>;
  productObjective?: QueryDelegate<ProductObjectiveRow>;
};

export class ProductOperatingContextNotFoundError extends Error {
  constructor(scope: ProductOperatingScope) {
    super(`No ${scope.kind} ${scope.id} exists in the authorized organization`);
    this.name = "ProductOperatingContextNotFoundError";
  }
}

export type ProductOperatingContextQueryProfile =
  | "full"
  | "commercial-summary";

export function numberOf(value: NumberLike | null): number {
  if (value == null) return 0;
  return typeof value === "number" ? value : value.toNumber();
}

export function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function stringOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function dateOf(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function productScopeRows(
  rows: ProductRow[],
): BusinessProductContextItem[] {
  return rows.map((product) => ({
    id: product.id,
    productId: product.productId,
    productLineId: product.productLineId,
    name: product.name,
    sourceKind: "product",
    asOf: product.updatedAt,
  }));
}
