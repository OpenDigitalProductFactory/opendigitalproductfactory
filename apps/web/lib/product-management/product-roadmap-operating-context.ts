import type {
  ContextAvailability,
  ContextFreshness,
  ContextSlice,
  ProductOperatingContext,
} from "./product-operating-context";
import {
  projectProductRoadmap,
  type ProductRoadmapProjection,
  type RoadmapCoordinationEvidence,
} from "./product-roadmap";

export type ProductRoadmapSourcePosture = {
  availability: ContextAvailability;
  freshness: ContextFreshness;
  reason: string | null;
  count: number;
};

export type ProductRoadmapWorkspace = {
  roadmap: ProductRoadmapProjection;
  sources: {
    demand: ProductRoadmapSourcePosture;
    objectives: ProductRoadmapSourcePosture;
    delivery: ProductRoadmapSourcePosture;
    architecture: ProductRoadmapSourcePosture;
  };
};

function sourcePosture<T extends { id: string }>(
  slice: ContextSlice<T & { sourceKind: string; asOf: Date }>,
): ProductRoadmapSourcePosture {
  return {
    availability: slice.availability,
    freshness: slice.freshness,
    reason: slice.reason,
    count: slice.items.length,
  };
}
function scopeName(context: ProductOperatingContext): string {
  if (context.scope.kind === "organization") return context.provider.name;
  if (context.scope.kind === "product-line") {
    return context.productLine?.name ?? context.scope.id;
  }
  return (
    context.products.find(
      (product) =>
        product.id === context.scope.id || product.productId === context.scope.id,
    )?.name ?? context.scope.id
  );
}

function coordinationEvidence(
  context: ProductOperatingContext,
): RoadmapCoordinationEvidence[] {
  return [...context.deliveryChanges.items, ...context.architecture.items].map(
    (item) => ({
      id: item.id,
      kind: item.coordinationKind,
      title: item.title,
      status: item.status,
      asOf: item.asOf,
      plannedStartAt: item.plannedStartAt,
      plannedEndAt: item.plannedEndAt,
      fromProductId: item.fromProductId,
      toProductId: item.toProductId,
      relationType: item.relationType,
    }),
  );
}

/**
 * The sole ProductOperatingContext -> roadmap adapter. The pure projection,
 * every UI view, and the portable export all consume this boundary.
 *
 * DigitalProduct dependency and change evidence remains coordination context.
 * It is deliberately not converted into BacklogItem dependency edges because
 * the canonical substrate does not establish that association.
 */
export function projectProductRoadmapFromOperatingContext(
  context: ProductOperatingContext,
): ProductRoadmapWorkspace {
  const roadmap = projectProductRoadmap({
    requestedAt: context.requestedAt,
    scope: {
      kind: context.scope.kind,
      id: context.scope.id,
      name: scopeName(context),
    },
    demand: context.demand.items.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      demandStage: item.demandStage ?? null,
      score: item.score ?? null,
      investmentBucket: item.investmentBucket ?? null,
      evidenceCount: item.evidenceCount ?? 0,
      asOf: item.asOf,
      lastEvidenceChange: item.lastEvidenceChange
        ? {
            kind: item.lastEvidenceChange.kind,
            summary: item.lastEvidenceChange.summary,
            at: item.lastEvidenceChange.recordedAt,
          }
        : null,
      delivery: item.delivery
        ? {
            sourceId: item.delivery.sourceId,
            phase: item.delivery.phase,
            asOf: item.delivery.asOf,
            shippedAt: item.delivery.shippedAt,
          }
        : null,
    })),
    objectives: context.objectives.items.map((objective) => ({
      id: objective.objectiveId,
      title: objective.title,
      status: objective.status,
      workItemIds: objective.contributingWork.map((work) => work.itemId),
      asOf: objective.asOf,
    })),
    // The current business-product substrate has no canonical work-item
    // dependency relation. Do not fabricate one from a DigitalProduct edge.
    dependencies: [],
    architectureConstraints: [],
    coordinationEvidence: coordinationEvidence(context),
  });

  return {
    roadmap,
    sources: {
      demand: sourcePosture(context.demand),
      objectives: sourcePosture(context.objectives),
      delivery: sourcePosture(context.deliveryChanges),
      architecture: sourcePosture(context.architecture),
    },
  };
}
