import type { ProductOperatingContext } from "./product-operating-context";

export type ProductManagementAdoptionMeasure = {
  id:
    | "playbook-freshness"
    | "decision-latency"
    | "outcome-review-cadence"
    | "recommendation-response"
    | "product-line-movement";
  label: string;
  availability: "available" | "partial" | "unavailable";
  value: number | null;
  unit: "percent" | "hours" | "days" | "count" | null;
  numerator: number | null;
  denominator: number | null;
  asOf: Date;
  sourceIds: string[];
  reason: string | null;
};

export type ProductManagementAdoptionInput = {
  context: ProductOperatingContext;
  decisionWindows?: Array<{
    demandItemId: string;
    proposedAt: Date;
    decidedAt: Date;
  }>;
  recommendationResponses?: Array<{
    interactionId: string;
    outcome: "accepted" | "corrected";
    resolvedAt: Date;
  }>;
  productLineMovements?: Array<{
    productLineId: string;
    metric: string;
    previousAsOf: Date;
    currentAsOf: Date;
    previousValue: number;
    currentValue: number;
  }>;
};

function newest(values: Date[], fallback: Date): Date {
  return values.reduce(
    (latest, candidate) => (candidate > latest ? candidate : latest),
    fallback,
  );
}

function playbookFreshness(
  context: ProductOperatingContext,
): ProductManagementAdoptionMeasure {
  const typed = context.scheduledPlaybooks.items.filter(
    (task) => task.taskKind === "product-management-playbook",
  );
  const current = typed.filter(
    (task) =>
      task.isActive &&
      task.permissionsCurrent !== false &&
      (task.lastStatus === "ok" || task.lastStatus === "unchanged"),
  );
  return {
    id: "playbook-freshness",
    label: "Current recurring playbooks",
    availability: typed.length > 0 ? "available" : "unavailable",
    value: typed.length > 0 ? (current.length / typed.length) * 100 : null,
    unit: typed.length > 0 ? "percent" : null,
    numerator: typed.length > 0 ? current.length : null,
    denominator: typed.length > 0 ? typed.length : null,
    asOf: newest(
      typed.map((task) => task.asOf),
      context.requestedAt,
    ),
    sourceIds: typed.map(
      (task) => `scheduled-agent-task:${task.taskId}`,
    ),
    reason:
      typed.length > 0
        ? null
        : "No product-management playbook has been explicitly scheduled.",
  };
}

function decisionLatency(
  input: ProductManagementAdoptionInput,
): ProductManagementAdoptionMeasure {
  const windows = (input.decisionWindows ?? []).filter(
    (window) => window.decidedAt >= window.proposedAt,
  );
  return {
    id: "decision-latency",
    label: "Demand decision latency",
    availability: windows.length > 0 ? "available" : "unavailable",
    value:
      windows.length > 0
        ? windows.reduce(
            (total, window) =>
              total +
              (window.decidedAt.getTime() - window.proposedAt.getTime()) /
                3_600_000,
            0,
          ) / windows.length
        : null,
    unit: windows.length > 0 ? "hours" : null,
    numerator: windows.length > 0 ? windows.length : null,
    denominator: windows.length > 0 ? windows.length : null,
    asOf: newest(
      windows.map((window) => window.decidedAt),
      input.context.requestedAt,
    ),
    sourceIds: windows.map(
      (window) => `backlog-item:${window.demandItemId}`,
    ),
    reason:
      windows.length > 0
        ? null
        : "No canonical demand intake-to-decision timestamp pair is available.",
  };
}

function outcomeReviewCadence(
  context: ProductOperatingContext,
): ProductManagementAdoptionMeasure {
  const reviewable = context.objectives.items.filter(
    (objective) => objective.status === "active" && objective.reviewAt,
  );
  const reviewed = reviewable.filter(
    (objective) =>
      objective.reviewedAt &&
      objective.reviewAt &&
      objective.reviewedAt <= objective.reviewAt,
  );
  return {
    id: "outcome-review-cadence",
    label: "Outcome reviews completed by due date",
    availability:
      reviewable.length > 0
        ? context.objectives.availability === "partial"
          ? "partial"
          : "available"
        : "unavailable",
    value:
      reviewable.length > 0 ? (reviewed.length / reviewable.length) * 100 : null,
    unit: reviewable.length > 0 ? "percent" : null,
    numerator: reviewable.length > 0 ? reviewed.length : null,
    denominator: reviewable.length > 0 ? reviewable.length : null,
    asOf: newest(
      reviewable.map((objective) => objective.asOf),
      context.objectives.asOf,
    ),
    sourceIds: reviewable.map(
      (objective) => `product-objective:${objective.objectiveId}`,
    ),
    reason:
      reviewable.length > 0
        ? context.objectives.reason
        : "No active objective has a canonical review date.",
  };
}

function recommendationResponse(
  input: ProductManagementAdoptionInput,
): ProductManagementAdoptionMeasure {
  const responses = input.recommendationResponses ?? [];
  const accepted = responses.filter(
    (response) => response.outcome === "accepted",
  );
  return {
    id: "recommendation-response",
    label: "Recommendations accepted",
    availability: responses.length > 0 ? "available" : "unavailable",
    value:
      responses.length > 0 ? (accepted.length / responses.length) * 100 : null,
    unit: responses.length > 0 ? "percent" : null,
    numerator: responses.length > 0 ? accepted.length : null,
    denominator: responses.length > 0 ? responses.length : null,
    asOf: newest(
      responses.map((response) => response.resolvedAt),
      input.context.requestedAt,
    ),
    sourceIds: responses.map(
      (response) => `decision-interaction:${response.interactionId}`,
    ),
    reason:
      responses.length > 0
        ? null
        : "No canonical recommendation acceptance or correction outcome is linked.",
  };
}

function productLineMovement(
  input: ProductManagementAdoptionInput,
): ProductManagementAdoptionMeasure {
  const movements = input.productLineMovements ?? [];
  return {
    id: "product-line-movement",
    label: "Comparable ProductLine movements",
    availability: movements.length > 0 ? "available" : "unavailable",
    value: movements.length > 0 ? movements.length : null,
    unit: movements.length > 0 ? "count" : null,
    numerator: movements.length > 0 ? movements.length : null,
    denominator: movements.length > 0 ? movements.length : null,
    asOf: newest(
      movements.map((movement) => movement.currentAsOf),
      input.context.requestedAt,
    ),
    sourceIds: movements.map(
      (movement) =>
        `product-line:${movement.productLineId}:${movement.metric}:${movement.previousAsOf.toISOString()}:${movement.currentAsOf.toISOString()}`,
    ),
    reason:
      movements.length > 0
        ? null
        : "No comparable canonical ProductLine snapshots are available; movement is not inferred from current totals.",
  };
}

export function buildProductManagementAdoptionEvidence(
  input: ProductManagementAdoptionInput,
): ProductManagementAdoptionMeasure[] {
  return [
    playbookFreshness(input.context),
    decisionLatency(input),
    outcomeReviewCadence(input.context),
    recommendationResponse(input),
    productLineMovement(input),
  ];
}
