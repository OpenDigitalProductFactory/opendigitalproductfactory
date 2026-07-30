import { prisma } from "@dpf/db";
import {
  assembleProductOperatingContext,
  collectProductLineSubtreeIds,
  createContextSlice,
  type EnablingDigitalProductContextItem,
  type ProductOperatingContext,
  type ProductOperatingScope,
} from "./product-operating-context";
import {
  buildProductIntelligenceProjectionWhere,
  buildScheduledProductIntelligenceVisibilityWhere,
} from "./product-intelligence-scope";
import { SCHEDULED_AGENT_TASK_KINDS } from "@/lib/operate/scheduled-jobs/agent-task-kind";
import { buildProductManagementProjectionWhere } from "./product-management-scope";
import { mapDemandRows } from "@/lib/demand/demand-data";
import { projectProductObjective } from "./outcomes";
import {
  canonicalMeasureKind,
  canonicalObjectiveStatus,
  collectEnablingDigitalProducts,
  dedupeIntelligenceItems,
  loadCommercialOperatingRows,
  optionalNumberOf,
  productScopeRows,
  resolveBusinessScope,
  type ProductOperatingContextQueryClient,
  type ProductOperatingContextQueryProfile,
} from "./product-operating-context-query-support";
import {
  projectArchitectureItems,
  projectOperatingIntelligence,
  projectProductSold,
  projectScheduledPlaybooks,
} from "./product-operating-context-query-projection";

export type {
  ProductOperatingContextQueryClient,
  ProductOperatingContextQueryProfile,
} from "./product-operating-context-query-support";
export { ProductOperatingContextNotFoundError } from "./product-operating-context-query-support";

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

  const { offerings, soldRows } = await loadCommercialOperatingRows({
    db,
    organizationId: input.organizationId,
    productIds,
    fullProfile,
  });

  const enablingDigitalProducts = collectEnablingDigitalProducts(offerings);
  const digitalProductIds = enablingDigitalProducts.map((product) => product.id);
  const productLineIds =
    input.scope.kind === "organization"
      ? identity.productLines.map((line) => line.id)
      : input.scope.kind === "product-line"
        ? collectProductLineSubtreeIds(
            identity.productLines,
            identity.selectedProductLine?.id ?? input.scope.id,
          )
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
  const demandWhere = buildProductManagementProjectionWhere({
    organizationId: input.organizationId,
    productLineIds,
    businessProductIds: productIds,
    digitalProductIds,
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
    objectives,
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
            taskKind: { in: [...SCHEDULED_AGENT_TASK_KINDS] },
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
            taskRunId: true,
            lastStatus: true,
            lastError: true,
            taskKind: true,
            taskConfig: true,
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
    fullProfile
      ? db.backlogItem.findMany({
          where: demandWhere,
          orderBy: [{ updatedAt: "desc" }, { itemId: "asc" }],
          take: 100,
          select: {
            itemId: true,
            title: true,
            body: true,
            status: true,
            workType: true,
            organizationId: true,
            productLineId: true,
            businessProductId: true,
            digitalProductId: true,
            demandStage: true,
            demandScore: true,
            demandScoreFramework: true,
            effortSize: true,
            jobSize: true,
            reach: true,
            occurrenceCount: true,
            impact: true,
            confidence: true,
            businessValue: true,
            timeCriticality: true,
            riskOpportunity: true,
            investmentBucket: true,
            estimateAiJobSize: true,
            estimateHumanJobSize: true,
            estimateSource: true,
            estimateAgreed: true,
            claimStatus: true,
            claimedByAgentId: true,
            activeBuild: {
              select: {
                buildId: true,
                phase: true,
                updatedAt: true,
                productVersions: {
                  orderBy: { shippedAt: "desc" },
                  take: 1,
                  select: {
                    id: true,
                    shippedAt: true,
                  },
                },
              },
            },
            demandEvidenceLinks: {
              where: { status: "active" },
              orderBy: { createdAt: "desc" },
              select: {
                evidenceLinkId: true,
                sourceKind: true,
                sourceRef: true,
                title: true,
                summary: true,
                confidence: true,
                reviewedAt: true,
              },
            },
            activities: {
              where: {
                kind: {
                  in: [
                    "demand_stage_transition",
                    "demand_scored",
                    "demand_funding_decision",
                    "demand_evidence_linked",
                    "demand_evidence_superseded",
                  ],
                },
              },
              orderBy: { recordedAt: "desc" },
              take: 20,
              select: {
                kind: true,
                summary: true,
                recordedAt: true,
                payload: true,
              },
            },
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
            changeRequest: {
              select: {
                id: true,
                plannedStartAt: true,
                plannedEndAt: true,
              },
            },
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
            fromProduct: { select: { id: true, name: true } },
            toProduct: { select: { id: true, name: true } },
          },
        })
      : Promise.resolve([]),
    fullProfile && db.productObjective
      ? db.productObjective.findMany({
          where: {
            organizationId: input.organizationId,
            productId: { in: productIds },
          },
          orderBy: [
            { reviewAt: "asc" },
            { updatedAt: "desc" },
            { objectiveId: "asc" },
          ],
          take: 100,
          select: {
            objectiveId: true,
            productId: true,
            title: true,
            problemStatement: true,
            outcomeHypothesis: true,
            status: true,
            measureKind: true,
            measureDefinition: true,
            measureUnit: true,
            baselineValue: true,
            targetValue: true,
            baselineNarrative: true,
            targetNarrative: true,
            reviewCadence: true,
            reviewAt: true,
            reviewedAt: true,
            createdAt: true,
            updatedAt: true,
            ownerPrincipal: {
              select: {
                principalId: true,
                displayName: true,
              },
            },
            contributingWork: {
              orderBy: { createdAt: "asc" },
              select: {
                contributionKind: true,
                backlogItem: {
                  select: {
                    itemId: true,
                    title: true,
                    status: true,
                  },
                },
              },
            },
            observations: {
              orderBy: [
                { observedAt: "desc" },
                { createdAt: "desc" },
                { observationId: "asc" },
              ],
              select: {
                observationId: true,
                observedAt: true,
                numericValue: true,
                narrative: true,
                measureKind: true,
                measureUnit: true,
                sourceKind: true,
                sourceRef: true,
                confidence: true,
                createdAt: true,
                supersedes: { select: { observationId: true } },
                supersededBy: { select: { observationId: true } },
                recordedByPrincipal: {
                  select: {
                    principalId: true,
                    displayName: true,
                  },
                },
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const intelligenceItems = projectOperatingIntelligence({
    organizationId: input.organizationId,
    productLineIds,
    productIds,
    digitalProductIds,
    research,
    battlecards,
    reviewedResearchSources,
    knowledge,
  });
  const scheduledPlaybooks = projectScheduledPlaybooks(scheduledWatches);
  const sold = projectProductSold(soldRows);

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
  const demandViews = new Map(
    mapDemandRows(demand).map((view) => [view.itemId, view]),
  );
  const productLineByProductId = new Map(
    identity.products.map((product) => [product.id, product.productLineId]),
  );

  const architectureItems = projectArchitectureItems(elements, dependencies);

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
      partialReason:
        sold.length >= 250
          ? "Product Sold evidence is bounded to the 250 newest records."
          : undefined,
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
        ...(demandViews.get(row.itemId)?.activation
          ? {
              evidenceCount:
                demandViews.get(row.itemId)!.activation!.score.evidenceCount,
              readiness:
                demandViews.get(row.itemId)!.activation!.readiness,
              blockers:
                demandViews.get(row.itemId)!.activation!.blockers,
              latestDecision: demandViews.get(row.itemId)!.decisionHistory?.[0]
                ? {
                    summary:
                      demandViews.get(row.itemId)!.decisionHistory![0]!.summary,
                    recordedAt: new Date(
                      demandViews.get(row.itemId)!.decisionHistory![0]!.recordedAt,
                    ),
                    payload:
                      demandViews.get(row.itemId)!.decisionHistory![0]!.payload,
                  }
                : null,
            }
          : {}),
        id: row.itemId,
        sourceKind: "backlog-item",
        asOf: row.updatedAt,
        title: row.title,
        status: row.status,
        workType: row.workType,
        productLineId:
          row.productLineId ??
          (row.businessProductId
            ? productLineByProductId.get(row.businessProductId) ?? null
            : null),
        businessProductId: row.businessProductId,
        demandStage: row.demandStage,
        score: row.demandScore,
        effortSize: row.effortSize,
        investmentBucket: row.investmentBucket,
        lastEvidenceChange: row.activities[0]
          ? {
              kind: row.activities[0].kind,
              summary: row.activities[0].summary,
              recordedAt: row.activities[0].recordedAt,
            }
          : null,
        delivery: row.activeBuild
          ? {
              sourceId:
                row.activeBuild.productVersions?.[0]?.id ??
                row.activeBuild.buildId,
              phase: row.activeBuild.phase,
              asOf:
                row.activeBuild.productVersions?.[0]?.shippedAt ??
                row.activeBuild.updatedAt,
              shippedAt:
                row.activeBuild.productVersions?.[0]?.shippedAt ?? null,
            }
          : null,
      })),
      partialReason:
        demand.length >= 100
          ? "Demand evidence is bounded to the 100 newest records."
          : undefined,
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
      items: objectives.map((objective) => {
        const measureKind = canonicalMeasureKind(objective.measureKind);
        const observations = objective.observations.map((observation) => ({
          observationId: observation.observationId,
          observedAt: observation.observedAt,
          numericValue: optionalNumberOf(observation.numericValue),
          narrative: observation.narrative,
          sourceKind: observation.sourceKind,
          sourceRef: observation.sourceRef,
          confidence: observation.confidence,
          recordedBy: observation.recordedByPrincipal,
          supersedesObservationId:
            observation.supersedes?.observationId ?? null,
          supersededByObservationId:
            observation.supersededBy?.observationId ?? null,
          createdAt: observation.createdAt,
        }));
        return {
          id: objective.objectiveId,
          sourceKind: "product-objective",
          asOf: objective.updatedAt,
          productId: objective.productId,
          ...projectProductObjective(
            {
              objectiveId: objective.objectiveId,
              title: objective.title,
              problemStatement: objective.problemStatement,
              outcomeHypothesis: objective.outcomeHypothesis,
              status: canonicalObjectiveStatus(objective.status),
              owner: objective.ownerPrincipal,
              measureKind,
              measureDefinition: objective.measureDefinition,
              measureUnit: objective.measureUnit,
              baselineValue: optionalNumberOf(objective.baselineValue),
              targetValue: optionalNumberOf(objective.targetValue),
              baselineNarrative: objective.baselineNarrative,
              targetNarrative: objective.targetNarrative,
              reviewCadence: objective.reviewCadence,
              reviewAt: objective.reviewAt,
              reviewedAt: objective.reviewedAt,
              createdAt: objective.createdAt,
              updatedAt: objective.updatedAt,
              observations,
              contributingWork: objective.contributingWork.map((work) => ({
                itemId: work.backlogItem.itemId,
                title: work.backlogItem.title,
                status: work.backlogItem.status,
                contributionKind: work.contributionKind,
              })),
              observationMeasures: objective.observations
                .filter((observation) => observation.supersededBy === null)
                .map((observation) => ({
                  numericValue: optionalNumberOf(observation.numericValue),
                  narrative: observation.narrative,
                  measureKind: canonicalMeasureKind(observation.measureKind),
                  measureUnit: observation.measureUnit,
                })),
            },
            requestedAt,
          ),
        };
      }),
      partialReason:
        objectives.length >= 100
          ? "Product objectives are bounded to the first 100 records in review order."
          : undefined,
      unavailableReason: !fullProfile
        ? "Objectives are outside the commercial-summary query profile."
        : db.productObjective
          ? undefined
          : "The product objective query delegate is unavailable.",
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
        coordinationKind: "delivery" as const,
        plannedStartAt: row.changeRequest?.plannedStartAt ?? null,
        plannedEndAt: row.changeRequest?.plannedEndAt ?? null,
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
