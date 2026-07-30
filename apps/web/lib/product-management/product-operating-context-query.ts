import { prisma } from "@dpf/db";
import {
  assembleProductOperatingContext,
  collectProductLineSubtreeIds,
  createContextSlice,
  type EnablingDigitalProductContextItem,
  type IntelligenceContextItem,
  type ProductOperatingContext,
  type ProductOperatingScope,
  type ProductSoldContextItem,
  type ScheduledPlaybookContextItem,
} from "./product-operating-context";
import {
  buildProductIntelligenceProjectionWhere,
  buildScheduledProductIntelligenceVisibilityWhere,
} from "./product-intelligence-scope";
import { SCHEDULED_AGENT_TASK_KINDS } from "@/lib/operate/scheduled-jobs/agent-task-kind";
import {
  ProductOperatingContextNotFoundError,
  numberOf,
  productScopeRows,
  recordOf,
  stringOf,
  type BattlecardRow,
  type DependencyRow, type DigitalProductRow,
  type EaElementRow,
  type KnowledgeArticleRow,
  type ProductLineRow,
  type ProductOperatingContextQueryClient,
  type ProductOperatingContextQueryProfile,
  type ProductRow,
  type ResearchProposalRow,
  type ReviewedResearchSourceRow,
  type ScheduledAgentTaskRow,
} from "./product-operating-context-query-types";
import {
  dedupeIntelligenceItems,
  intelligenceScopeOf,
  productSoldConsumers,
  researchEvidenceOf,
  researchLocatorEvidenceOf,
  reviewedResearchScopeOf,
  scopeIsVisible,
} from "./product-operating-context-query-evidence";
export {
  ProductOperatingContextNotFoundError,
  type ProductOperatingContextQueryClient,
  type ProductOperatingContextQueryProfile,
} from "./product-operating-context-query-types";
async function resolveBusinessScope(input: {
  db: ProductOperatingContextQueryClient;
  organizationId: string;
  scope: ProductOperatingScope;
}) {
  const [organization, productLines] = await Promise.all([
    input.db.organization.findFirst({
      where: { id: input.organizationId },
      select: { id: true, name: true, updatedAt: true },
    }),
    input.db.productLine.findMany({
      where: { organizationId: input.organizationId, effectiveTo: null },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      take: 100,
      select: {
        id: true,
        name: true,
        parentId: true,
        updatedAt: true,
      },
    }),
  ]);
  if (!organization) throw new ProductOperatingContextNotFoundError(input.scope);
  let products: ProductRow[];
  let selectedProductLine: ProductLineRow | null = null;
  if (input.scope.kind === "product") {
    const product = await input.db.product.findFirst({
      where: { id: input.scope.id, organizationId: input.organizationId },
      select: {
        id: true,
        productId: true,
        productLineId: true,
        name: true,
        updatedAt: true,
      },
    });
    if (!product) throw new ProductOperatingContextNotFoundError(input.scope);
    products = [product];
    selectedProductLine =
      productLines.find((line) => line.id === product.productLineId) ?? null;
    if (!selectedProductLine) {
      selectedProductLine = await input.db.productLine.findFirst({
        where: {
          id: product.productLineId,
          organizationId: input.organizationId,
        },
        select: {
          id: true,
          name: true,
          parentId: true,
          updatedAt: true,
        },
      });
    }
  } else if (input.scope.kind === "product-line") {
    selectedProductLine = await input.db.productLine.findFirst({
      where: { id: input.scope.id, organizationId: input.organizationId },
      select: {
        id: true,
        name: true,
        parentId: true,
        updatedAt: true,
      },
    });
    if (!selectedProductLine) {
      throw new ProductOperatingContextNotFoundError(input.scope);
    }
    products = await input.db.product.findMany({
      where: {
        organizationId: input.organizationId,
        productLineId: {
          in: collectProductLineSubtreeIds(productLines, input.scope.id),
        },
        effectiveTo: null,
      },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      take: 100,
      select: {
        id: true,
        productId: true,
        productLineId: true,
        name: true,
        updatedAt: true,
      },
    });
  } else {
    products = await input.db.product.findMany({
      where: { organizationId: input.organizationId, effectiveTo: null },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      take: 250,
      select: {
        id: true,
        productId: true,
        productLineId: true,
        name: true,
        updatedAt: true,
      },
    });
  }
  return { organization, productLines, selectedProductLine, products };
}
export async function loadProductOperatingContext(input: {
  db?: ProductOperatingContextQueryClient;
  organizationId: string;
  scope: ProductOperatingScope;
  authorize: (scope: { organizationId: string }) => Promise<void>;
  requestedAt?: Date;
  profile?: ProductOperatingContextQueryProfile;
}): Promise<ProductOperatingContext> {
  const db =
    input.db ??
    (prisma as unknown as ProductOperatingContextQueryClient);
  const requestedAt = input.requestedAt ?? new Date();
  const fullProfile = (input.profile ?? "full") === "full";
  // Authorization is deliberately resolved once at the boundary. Every query
  // still carries the organization predicate as defense in depth.
  await input.authorize({ organizationId: input.organizationId });
  const identity = await resolveBusinessScope({
    db,
    organizationId: input.organizationId,
    scope: input.scope,
  });
  const productIds = identity.products.map((product) => product.id);
  const [offerings, soldRows] = await Promise.all([
    fullProfile
      ? db.productOffering.findMany({
          where: {
            organizationId: input.organizationId,
            productId: { in: productIds },
          },
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          take: 100,
          select: {
            id: true,
            productId: true,
            providerOrganizationId: true,
            name: true,
            status: true,
            updatedAt: true,
            catalogItems: {
              orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
              take: 100,
              select: {
                id: true,
                name: true,
                status: true,
                updatedAt: true,
              },
            },
            operationalServiceOffering: {
              select: {
                digitalProduct: {
                  select: {
                    id: true,
                    productId: true,
                    name: true,
                    updatedAt: true,
                  },
                },
              },
            },
          },
        })
      : Promise.resolve([]),
    db.productSold.findMany({
      where: {
        organizationId: input.organizationId,
        productId: { in: productIds },
      },
      orderBy: [{ purchasedAt: "desc" }, { id: "asc" }],
      take: 250,
      select: {
        id: true,
        productId: true,
        status: true,
        quantity: true,
        totalAmount: true,
        currency: true,
        purchasedAt: true,
        parties: {
          orderBy: [{ observedAt: "desc" }, { id: "asc" }],
          select: {
            id: true,
            role: true,
            observedAt: true,
            displaySnapshot: true,
          },
        },
        evidence: {
          orderBy: [{ observedAt: "desc" }, { id: "asc" }],
          select: {
            id: true,
            evidenceKind: true,
            observedAt: true,
            evidenceSnapshot: true,
          },
        },
        componentAllocations: {
          orderBy: { componentCatalogItemId: "asc" },
          select: {
            componentCatalogItemId: true,
            allocatedAmount: true,
            allocationMode: true,
          },
        },
      },
    }),
  ]);

  const enablingById = new Map<string, DigitalProductRow>();
  for (const offering of offerings) {
    const digitalProduct =
      offering.operationalServiceOffering?.digitalProduct ?? null;
    if (digitalProduct) enablingById.set(digitalProduct.id, digitalProduct);
  }
  const enablingDigitalProducts = [...enablingById.values()];
  const digitalProductIds = enablingDigitalProducts.map((product) => product.id);
  const productLineIds =
    input.scope.kind === "organization"
      ? identity.productLines.map((line) => line.id)
      : input.scope.kind === "product-line"
        ? collectProductLineSubtreeIds(identity.productLines, input.scope.id)
        : identity.selectedProductLine
          ? [identity.selectedProductLine.id]
          : [];
  const intelligenceWhere = buildProductIntelligenceProjectionWhere({
    organizationId: input.organizationId,
    productLineIds,
    businessProductIds: productIds,
    digitalProductIds,
  });
  const scheduledIntelligenceWhere =
    buildScheduledProductIntelligenceVisibilityWhere({
      organizationId: input.organizationId,
      productLineIds,
      businessProductIds: productIds,
    });

  const [
    research,
    battlecards,
    scheduledWatches,
    reviewedResearchSources,
    knowledge,
    demand,
    changes,
    elements,
    dependencies,
  ] = await Promise.all([
    fullProfile
      ? db.researchProposal.findMany({
          where: intelligenceWhere,
          orderBy: [{ updatedAt: "desc" }, { proposalId: "asc" }],
          take: 50,
          select: {
            proposalId: true,
            digitalProductId: true,
            productLineId: true,
            businessProductId: true,
            topic: true,
            query: true,
            status: true,
            resultSummary: true,
            metadata: true,
            updatedAt: true,
          },
        })
      : Promise.resolve([]),
    fullProfile
      ? db.marketingBattlecard.findMany({
          where: intelligenceWhere,
          orderBy: [{ updatedAt: "desc" }, { battlecardId: "asc" }],
          take: 50,
          select: {
            battlecardId: true,
            digitalProductId: true,
            productLineId: true,
            businessProductId: true,
            competitorName: true,
            status: true,
            updatedAt: true,
          },
        })
      : Promise.resolve([]),
    fullProfile
      ? db.scheduledAgentTask.findMany({
          where: {
            taskKind: SCHEDULED_AGENT_TASK_KINDS[0],
            ...scheduledIntelligenceWhere,
          },
          orderBy: [{ nextRunAt: "asc" }, { taskId: "asc" }],
          take: 50,
          select: {
            taskId: true,
            title: true,
            productLineId: true,
            businessProductId: true,
            schedule: true,
            isActive: true,
            nextRunAt: true,
            lastRunAt: true,
            lastStatus: true,
            updatedAt: true,
          },
        })
      : Promise.resolve([]),
    fullProfile
      ? db.rawSource.findMany({
          where: {
            organizationId: input.organizationId,
            sourceType: "research",
            pageSources: {
              some: {
                page: {
                  status: "published",
                  lastReviewedAt: { not: null },
                },
              },
            },
          },
          orderBy: [{ retrievedAt: "desc" }, { sourceKey: "asc" }],
          take: 100,
          select: {
            sourceKey: true,
            locator: true,
            retrievedAt: true,
            pageSources: {
              where: {
                page: {
                  status: "published",
                  lastReviewedAt: { not: null },
                },
              },
              select: {
                page: {
                  select: {
                    id: true,
                    title: true,
                    abstract: true,
                    status: true,
                    lastReviewedAt: true,
                    updatedAt: true,
                  },
                },
              },
            },
          },
        })
      : Promise.resolve([]),
    fullProfile && digitalProductIds.length > 0
      ? db.knowledgeArticle.findMany({
          where: {
            products: {
              some: { digitalProductId: { in: digitalProductIds } },
            },
          },
          orderBy: [{ updatedAt: "desc" }, { articleId: "asc" }],
          take: 50,
          select: {
            articleId: true,
            title: true,
            status: true,
            updatedAt: true,
            products: {
              where: { digitalProductId: { in: digitalProductIds } },
              select: { digitalProductId: true },
            },
          },
        })
      : Promise.resolve([]),
    fullProfile && digitalProductIds.length > 0
      ? db.backlogItem.findMany({
          where: { digitalProductId: { in: digitalProductIds } },
          orderBy: [{ updatedAt: "desc" }, { itemId: "asc" }],
          take: 100,
          select: {
            itemId: true,
            title: true,
            status: true,
            demandStage: true,
            demandScore: true,
            updatedAt: true,
            epic: {
              select: {
                epicId: true,
                title: true,
                status: true,
                updatedAt: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    fullProfile && digitalProductIds.length > 0
      ? db.changeItem.findMany({
          where: { digitalProductId: { in: digitalProductIds } },
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          take: 50,
          select: {
            id: true,
            title: true,
            status: true,
            updatedAt: true,
          },
        })
      : Promise.resolve([]),
    fullProfile && digitalProductIds.length > 0
      ? db.eaElement.findMany({
          where: { digitalProductId: { in: digitalProductIds } },
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          take: 100,
          select: {
            id: true,
            name: true,
            lifecycleStatus: true,
            updatedAt: true,
          },
        })
      : Promise.resolve([]),
    fullProfile && digitalProductIds.length > 0
      ? db.productDependency.findMany({
          where: {
            OR: [
              { fromProductId: { in: digitalProductIds } },
              { toProductId: { in: digitalProductIds } },
            ],
          },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take: 100,
          select: {
            id: true,
            relationType: true,
            createdAt: true,
            fromProduct: { select: { name: true } },
            toProduct: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const intelligenceItems: IntelligenceContextItem[] = [
    ...research.map((row) => {
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
    ...battlecards.map((row) => ({
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
    ...reviewedResearchSources.flatMap((row) => {
      const scope = reviewedResearchScopeOf(row.locator, input.organizationId);
      if (
        !scope ||
        !scopeIsVisible(scope, {
          productLineIds,
          productIds,
          digitalProductIds,
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
    ...knowledge.flatMap((row) =>
      row.products.map((link) => ({
        id: row.articleId,
        sourceKind: "knowledge-article",
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

  const scheduledPlaybooks: ScheduledPlaybookContextItem[] =
    scheduledWatches.map((row) => ({
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
      lastStatus: row.lastStatus,
    }));

  const sold: ProductSoldContextItem[] = soldRows.map((row) => ({
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

  const roadmapById = new Map<
    string,
    { id: string; sourceKind: string; asOf: Date; title: string; status: string }
  >();
  for (const row of demand) {
    if (row.epic) {
      roadmapById.set(row.epic.epicId, {
        id: row.epic.epicId,
        sourceKind: "epic",
        asOf: row.epic.updatedAt,
        title: row.epic.title,
        status: row.epic.status,
      });
    }
  }

  const architectureItems = [
    ...elements.map((row) => ({
      id: row.id,
      sourceKind: "ea-element",
      asOf: row.updatedAt,
      title: row.name,
      status: row.lifecycleStatus ?? "unknown",
    })),
    ...dependencies.map((row) => ({
      id: row.id,
      sourceKind: "product-dependency",
      asOf: row.createdAt,
      title: `${row.fromProduct.name} ${row.relationType} ${row.toProduct.name}`,
      status: "active",
    })),
  ];

  return assembleProductOperatingContext({
    requestedAt,
    scope: input.scope,
    organization: {
      id: identity.organization.id,
      sourceKind: "organization",
      asOf: identity.organization.updatedAt,
      name: identity.organization.name,
    },
    productLines: identity.productLines.map((line) => ({
      id: line.id,
      sourceKind: "product-line",
      asOf: line.updatedAt,
      name: line.name,
      parentId: line.parentId,
    })),
    productLine: identity.selectedProductLine
      ? {
          id: identity.selectedProductLine.id,
          sourceKind: "product-line",
          asOf: identity.selectedProductLine.updatedAt,
          name: identity.selectedProductLine.name,
          parentId: identity.selectedProductLine.parentId,
        }
      : null,
    products: productScopeRows(identity.products),
    enablingDigitalProducts: createContextSlice({
      requestedAt,
      sourceKind: "operational-service-offering",
      items: enablingDigitalProducts.map(
        (product): EnablingDigitalProductContextItem => ({
          id: product.id,
          sourceKind: "digital-product",
          asOf: product.updatedAt,
          productId: product.productId,
          name: product.name,
        }),
      ),
      unavailableReason:
        !fullProfile
          ? "Enabling digital products are outside the commercial-summary query profile."
          : productIds.length > 0 && enablingDigitalProducts.length === 0
          ? "No explicit operational offering links this business product scope to a DigitalProduct."
          : undefined,
    }),
    offerings: createContextSlice({
      requestedAt,
      sourceKind: "product-offering",
      items: offerings.map((offering) => ({
        id: offering.id,
        sourceKind: "product-offering",
        asOf: offering.updatedAt,
        productId: offering.productId,
        providerOrganizationId: offering.providerOrganizationId,
        name: offering.name,
        status: offering.status,
      })),
      unavailableReason: !fullProfile
        ? "Offerings are outside the commercial-summary query profile."
        : undefined,
    }),
    catalogItems: createContextSlice({
      requestedAt,
      sourceKind: "catalog-item",
      items: offerings.flatMap((offering) =>
        offering.catalogItems.map((catalogItem) => ({
          id: catalogItem.id,
          sourceKind: "catalog-item",
          asOf: catalogItem.updatedAt,
          productId: offering.productId,
          name: catalogItem.name,
          status: catalogItem.status,
        })),
      ),
      unavailableReason: !fullProfile
        ? "Catalog items are outside the commercial-summary query profile."
        : undefined,
    }),
    productSold: createContextSlice({
      requestedAt,
      sourceKind: "product-sold",
      items: sold,
    }),
    intelligence: createContextSlice({
      requestedAt,
      sourceKind: "research-battlecard-knowledge",
      items: dedupeIntelligenceItems(intelligenceItems),
      unavailableReason: !fullProfile
        ? "Intelligence is outside the commercial-summary query profile."
        : undefined,
    }),
    demand: createContextSlice({
      requestedAt,
      sourceKind: "backlog-item",
      items: demand.map((row) => ({
        id: row.itemId,
        sourceKind: "backlog-item",
        asOf: row.updatedAt,
        title: row.title,
        status: row.status,
        demandStage: row.demandStage,
        score: row.demandScore,
      })),
      unavailableReason: !fullProfile
        ? "Demand is outside the commercial-summary query profile."
        : undefined,
    }),
    decisions: createContextSlice({
      requestedAt,
      sourceKind: "decision-interaction",
      items: [],
      unavailableReason:
        "No typed business-product decision association exists yet.",
    }),
    objectives: createContextSlice({
      requestedAt,
      sourceKind: "product-objective",
      items: [],
      unavailableReason:
        "The product objective and outcome contract is introduced in Phase 9.",
    }),
    roadmapInputs: createContextSlice({
      requestedAt,
      sourceKind: "epic",
      items: [...roadmapById.values()],
      unavailableReason: !fullProfile
        ? "Roadmap inputs are outside the commercial-summary query profile."
        : undefined,
    }),
    deliveryChanges: createContextSlice({
      requestedAt,
      sourceKind: "change-item",
      items: changes.map((row) => ({
        id: row.id,
        sourceKind: "change-item",
        asOf: row.updatedAt,
        title: row.title,
        status: row.status,
      })),
      unavailableReason: !fullProfile
        ? "Delivery changes are outside the commercial-summary query profile."
        : undefined,
    }),
    architecture: createContextSlice({
      requestedAt,
      sourceKind: "ea-element-and-product-dependency",
      items: architectureItems,
      unavailableReason: !fullProfile
        ? "Architecture is outside the commercial-summary query profile."
        : undefined,
    }),
    scheduledPlaybooks: createContextSlice({
      requestedAt,
      sourceKind: "scheduled-agent-task",
      items: scheduledPlaybooks,
      unavailableReason: !fullProfile
        ? "Scheduled product intelligence is outside the commercial-summary query profile."
        : undefined,
    }),
  });
}
