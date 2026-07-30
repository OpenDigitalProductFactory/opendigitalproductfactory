import { createContextSlice } from "./product-operating-context";
import {
  PRODUCT_OBJECTIVE_STATUSES,
  PRODUCT_OUTCOME_MEASURE_KINDS,
  projectProductObjective,
  type ProductObjectiveStatus,
  type ProductOutcomeMeasureKind,
} from "./outcomes";
import type {
  ProductObjectiveRow,
  ProductOperatingContextQueryClient,
} from "./product-operating-context-query-types";

function canonicalObjectiveStatus(value: string): ProductObjectiveStatus {
  return PRODUCT_OBJECTIVE_STATUSES.includes(value as ProductObjectiveStatus)
    ? (value as ProductObjectiveStatus)
    : "draft";
}

function canonicalMeasureKind(value: string): ProductOutcomeMeasureKind {
  return PRODUCT_OUTCOME_MEASURE_KINDS.includes(value as ProductOutcomeMeasureKind)
    ? (value as ProductOutcomeMeasureKind)
    : "qualitative";
}

function optionalNumberOf(
  value: ProductObjectiveRow["baselineValue"],
): number | null {
  if (value == null) return null;
  return typeof value === "number" ? value : value.toNumber();
}

export function loadProductObjectives(input: {
  db: ProductOperatingContextQueryClient;
  fullProfile: boolean;
  organizationId: string;
  productIds: string[];
}): Promise<ProductObjectiveRow[]> {
  if (!input.fullProfile || !input.db.productObjective) {
    return Promise.resolve([]);
  }
  return input.db.productObjective.findMany({
    where: {
      organizationId: input.organizationId,
      productId: { in: input.productIds },
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
        select: { principalId: true, displayName: true },
      },
      contributingWork: {
        orderBy: { createdAt: "asc" },
        select: {
          contributionKind: true,
          backlogItem: {
            select: { itemId: true, title: true, status: true },
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
            select: { principalId: true, displayName: true },
          },
        },
      },
    },
  });
}

export function projectProductObjectives(input: {
  objectives: ProductObjectiveRow[];
  requestedAt: Date;
  fullProfile: boolean;
  delegateAvailable: boolean;
}) {
  return createContextSlice({
    requestedAt: input.requestedAt,
    sourceKind: "product-objective",
    items: input.objectives.map((objective) => {
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
        supersedesObservationId: observation.supersedes?.observationId ?? null,
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
          input.requestedAt,
        ),
      };
    }),
    partialReason:
      input.objectives.length >= 100
        ? "Product objectives are bounded to the first 100 records in review order."
        : undefined,
    unavailableReason: !input.fullProfile
      ? "Objectives are outside the commercial-summary query profile."
      : input.delegateAvailable
        ? undefined
        : "The product objective query delegate is unavailable.",
  });
}
