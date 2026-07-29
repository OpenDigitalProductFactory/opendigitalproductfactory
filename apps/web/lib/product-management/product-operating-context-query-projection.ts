import {
  buildPlaybookPermissionDigest,
  getProductManagementPlaybook,
  isProductManagementPlaybookId,
} from "./product-management-playbook";
import type {
  IntelligenceContextItem,
  ProductSoldContextItem,
  ScheduledPlaybookContextItem,
} from "./product-operating-context";
import {
  intelligenceScopeOf,
  numberOf,
  productSoldConsumers,
  recordOf,
  researchEvidenceOf,
  researchLocatorEvidenceOf,
  reviewedResearchScopeOf,
  scopeIsVisible,
  stringOf,
  type BattlecardRow,
  type DependencyRow,
  type EaElementRow,
  type KnowledgeArticleRow,
  type ProductSoldRow,
  type ResearchProposalRow,
  type ReviewedResearchSourceRow,
  type ScheduledAgentTaskRow,
} from "./product-operating-context-query-support";

export function projectOperatingIntelligence(input: {
  organizationId: string;
  productLineIds: string[];
  productIds: string[];
  digitalProductIds: string[];
  research: ResearchProposalRow[];
  battlecards: BattlecardRow[];
  reviewedResearchSources: ReviewedResearchSourceRow[];
  knowledge: KnowledgeArticleRow[];
}): IntelligenceContextItem[] {
  return [
    ...input.research.map((row) => {
      const evidence = researchEvidenceOf(row.metadata);
      return {
        id: row.proposalId,
        sourceKind: "research-proposal",
        asOf: row.updatedAt,
        title: row.topic,
        detail:
          row.status === "pending" ? row.query : row.resultSummary ?? row.query,
        scope: intelligenceScopeOf(row, input.organizationId),
        productLineId: row.productLineId,
        businessProductId: row.businessProductId,
        digitalProductId: row.digitalProductId,
        status: row.status,
        ...evidence,
      };
    }),
    ...input.battlecards.map((row) => ({
      id: row.battlecardId,
      sourceKind: "marketing-battlecard",
      asOf: row.updatedAt,
      title: row.competitorName,
      scope: intelligenceScopeOf(row, input.organizationId),
      productLineId: row.productLineId,
      businessProductId: row.businessProductId,
      digitalProductId: row.digitalProductId,
      status: row.status,
    })),
    ...input.reviewedResearchSources.flatMap((row) => {
      const scope = reviewedResearchScopeOf(
        row.locator,
        input.organizationId,
      );
      if (
        !scope ||
        !scopeIsVisible(scope, {
          productLineIds: input.productLineIds,
          productIds: input.productIds,
          digitalProductIds: input.digitalProductIds,
        })
      ) {
        return [];
      }
      const evidence = researchLocatorEvidenceOf(row.locator);
      const relatedProposalId = stringOf(recordOf(row.locator)["proposalId"]);
      return row.pageSources.map(({ page }) => ({
        id: page.id,
        sourceKind: "wiki-page",
        asOf: page.lastReviewedAt ?? page.updatedAt,
        title: page.title,
        detail: page.abstract,
        relatedProposalId,
        scope: scope.kind,
        productLineId: scope.productLineId,
        businessProductId: scope.businessProductId,
        digitalProductId: scope.digitalProductId,
        status: page.status,
        retrievedAt: row.retrievedAt,
        ...evidence,
      }));
    }),
    ...input.knowledge.flatMap((row) =>
      row.products.map((link) => ({
        id: row.articleId,
        sourceKind: "knowledge-article" as const,
        asOf: row.updatedAt,
        title: row.title,
        scope: "digital-product" as const,
        productLineId: null,
        businessProductId: null,
        digitalProductId: link.digitalProductId,
        status: row.status,
      })),
    ),
  ];
}

export function projectScheduledPlaybooks(
  rows: ScheduledAgentTaskRow[],
): ScheduledPlaybookContextItem[] {
  return rows.map((row) => {
    const taskConfig =
      row.taskConfig &&
      typeof row.taskConfig === "object" &&
      !Array.isArray(row.taskConfig)
        ? (row.taskConfig as Record<string, unknown>)
        : null;
    const recipeId = isProductManagementPlaybookId(taskConfig?.recipeId)
      ? taskConfig.recipeId
      : null;
    const permissionsDigest =
      typeof taskConfig?.permissionsDigest === "string"
        ? taskConfig.permissionsDigest
        : null;
    return {
      id: row.taskId,
      taskId: row.taskId,
      sourceKind: "scheduled-agent-task",
      asOf: row.updatedAt,
      title: row.title,
      status: row.isActive ? "active" : "paused",
      scope: row.businessProductId
        ? ("business-product" as const)
        : row.productLineId
          ? ("product-line" as const)
          : ("organization" as const),
      productLineId: row.productLineId,
      businessProductId: row.businessProductId,
      schedule: row.schedule,
      isActive: row.isActive,
      nextRunAt: row.nextRunAt,
      lastRunAt: row.lastRunAt,
      taskRunId: row.taskRunId,
      lastStatus: row.lastStatus,
      lastError: row.lastError,
      taskKind: row.taskKind,
      recipeId,
      permissionsDigest,
      permissionsCurrent:
        recipeId === null
          ? null
          : permissionsDigest ===
            buildPlaybookPermissionDigest(
              getProductManagementPlaybook(recipeId),
            ),
    };
  });
}

export function projectProductSold(
  rows: ProductSoldRow[],
): ProductSoldContextItem[] {
  return rows.map((row) => ({
    id: row.id,
    sourceKind: "product-sold",
    asOf: row.purchasedAt,
    productId: row.productId,
    status: row.status,
    quantity: numberOf(row.quantity),
    totalAmount: numberOf(row.totalAmount),
    currency: row.currency,
    consumerEvidence: productSoldConsumers(row),
    componentAllocations: row.componentAllocations.map((allocation) => ({
      catalogItemId: allocation.componentCatalogItemId,
      allocatedAmount:
        allocation.allocatedAmount === null
          ? null
          : numberOf(allocation.allocatedAmount),
      allocationMode: allocation.allocationMode,
    })),
  }));
}

export function projectArchitectureItems(
  elements: EaElementRow[],
  dependencies: DependencyRow[],
) {
  return [
    ...elements.map((row) => ({
      id: row.id,
      sourceKind: "ea-element",
      asOf: row.updatedAt,
      title: row.name,
      status: row.lifecycleStatus ?? "unknown",
      coordinationKind: "architecture" as const,
    })),
    ...dependencies.map((row) => ({
      id: row.id,
      sourceKind: "product-dependency",
      asOf: row.createdAt,
      title: `${row.fromProduct.name} ${row.relationType} ${row.toProduct.name}`,
      status: "active",
      coordinationKind: "architecture" as const,
      fromProductId: row.fromProduct.id ?? null,
      toProductId: row.toProduct.id ?? null,
      relationType: row.relationType,
    })),
  ];
}
