export const PRODUCT_ROADMAP_LANES = ["now", "next", "later"] as const;
export type ProductRoadmapLane = (typeof PRODUCT_ROADMAP_LANES)[number];

export const PRODUCT_ROADMAP_VIEWS = [
  "sequence",
  "timeline",
  "outcomes",
  "dependencies",
] as const;
export type ProductRoadmapView = (typeof PRODUCT_ROADMAP_VIEWS)[number];

export const PRODUCT_ROADMAP_AUDIENCES = [
  "owner-operator",
  "product-manager",
  "stakeholder",
] as const;
export type ProductRoadmapAudience =
  (typeof PRODUCT_ROADMAP_AUDIENCES)[number];

export function resolveProductRoadmapView(
  value: string | null | undefined,
): ProductRoadmapView {
  return (PRODUCT_ROADMAP_VIEWS as readonly string[]).includes(value ?? "")
    ? (value as ProductRoadmapView)
    : "sequence";
}

export function resolveProductRoadmapAudience(
  value: string | null | undefined,
  fallback: ProductRoadmapAudience,
): ProductRoadmapAudience {
  return (PRODUCT_ROADMAP_AUDIENCES as readonly string[]).includes(value ?? "")
    ? (value as ProductRoadmapAudience)
    : fallback;
}

export type ProductRoadmapConfidence = "high" | "medium" | "low" | "unknown";

export type RoadmapDemandEvidence = {
  id: string;
  title: string;
  status: string;
  demandStage: string | null;
  score: number | null;
  investmentBucket: string | null;
  evidenceCount: number;
  asOf: Date;
  lastEvidenceChange: {
    kind: string;
    summary: string;
    at: Date;
  } | null;
  delivery: {
    sourceId: string;
    phase: string;
    asOf: Date;
    plannedStartAt?: Date | null;
    plannedEndAt?: Date | null;
    shippedAt: Date | null;
  } | null;
};

export type RoadmapObjectiveEvidence = {
  id: string;
  title: string;
  status: string;
  workItemIds: string[];
  asOf: Date;
};

export type RoadmapDependencyEvidence = {
  id: string;
  fromDemandId: string;
  toDemandId: string;
  status: string;
  asOf: Date;
};

export type RoadmapArchitectureConstraint = {
  id: string;
  title: string;
  status: string;
  demandIds: string[];
  blocking: boolean;
  asOf: Date;
};

export type RoadmapCoordinationEvidence = {
  id: string;
  kind: "architecture" | "delivery";
  title: string;
  status: string;
  asOf: Date;
  plannedStartAt?: Date | null;
  plannedEndAt?: Date | null;
  fromProductId?: string | null;
  toProductId?: string | null;
  relationType?: string | null;
};

export type ProductRoadmapInput = {
  requestedAt: Date;
  scope: {
    kind: "organization" | "product-line" | "product";
    id: string;
    name: string;
  };
  demand: RoadmapDemandEvidence[];
  objectives: RoadmapObjectiveEvidence[];
  dependencies: RoadmapDependencyEvidence[];
  architectureConstraints: RoadmapArchitectureConstraint[];
  coordinationEvidence?: RoadmapCoordinationEvidence[];
};

export type ProductRoadmapBlockerCode =
  | "dependency-cycle"
  | "dependency-not-ready"
  | "architecture-constraint";

export type ProductRoadmapReadinessCode =
  | "demand-unclassified"
  | "funding-not-approved"
  | "objective-link-missing"
  | "objective-not-active"
  | "delivery-contradiction";

export type ProductRoadmapItem = {
  id: string;
  title: string;
  lane: ProductRoadmapLane;
  status: string;
  objectiveIds: string[];
  objectiveTitles: string[];
  score: number | null;
  investmentBucket: string | null;
  confidence: ProductRoadmapConfidence;
  blockers: Array<{
    code: ProductRoadmapBlockerCode;
    sourceId: string;
    summary: string;
  }>;
  movement: {
    summary: string;
    sourceKind: string;
    at: Date;
  };
  sourceIds: string[];
  canonicalHref: string;
};

export type ProductRoadmapReadinessItem = {
  id: string;
  title: string;
  code: ProductRoadmapReadinessCode;
  reason: string;
  actionLabel: string;
  actionHref: string;
  asOf: Date;
};

export type ProductRoadmapProjection = {
  asOf: Date;
  scope: ProductRoadmapInput["scope"];
  confidence: ProductRoadmapConfidence;
  lanes: Record<ProductRoadmapLane, ProductRoadmapItem[]>;
  completed: ProductRoadmapItem[];
  readiness: ProductRoadmapReadinessItem[];
  timeline: Array<{
    id: string;
    itemId: string;
    title: string;
    date: Date;
    dateKind: "planned-start" | "planned-end" | "shipped";
    sourceId: string;
    confidence: ProductRoadmapConfidence;
  }>;
  outcomes: Array<{
    objectiveId: string;
    title: string;
    itemIds: string[];
    confidence: ProductRoadmapConfidence;
  }>;
  dependencies: Array<{
    id: string;
    fromItemId: string;
    toItemId: string;
    status: string;
    cyclic: boolean;
    sourceId: string;
  }>;
  coordinationEvidence: RoadmapCoordinationEvidence[];
  sourceIds: string[];
};

const ACTIVE_DELIVERY_PHASES = new Set([
  "ideate",
  "plan",
  "build",
  "review",
  "ship",
]);

const CONFIDENCE_RANK: Record<ProductRoadmapConfidence, number> = {
  unknown: 0,
  low: 1,
  medium: 2,
  high: 3,
};

function demandHref(itemId: string): string {
  return `/delivery/demand?item=${encodeURIComponent(itemId)}`;
}

function objectiveHref(scope: ProductRoadmapInput["scope"]): string {
  return scope.kind === "product"
    ? `/portfolio/product/${encodeURIComponent(scope.id)}/direction/outcomes`
    : "/delivery/demand";
}

function confidenceForDemand(
  demand: RoadmapDemandEvidence,
): ProductRoadmapConfidence {
  if (
    demand.score !== null &&
    demand.evidenceCount >= 2 &&
    demand.lastEvidenceChange?.kind === "demand_funding_decision"
  ) {
    return "high";
  }
  if (demand.score !== null && demand.evidenceCount > 0) return "medium";
  if (demand.evidenceCount > 0 || demand.score !== null) return "low";
  return "unknown";
}

function lowestConfidence(
  values: ProductRoadmapConfidence[],
): ProductRoadmapConfidence {
  if (values.length === 0) return "unknown";
  return [...values].sort(
    (left, right) => CONFIDENCE_RANK[left] - CONFIDENCE_RANK[right],
  )[0]!;
}

function compareRoadmapItems(
  left: ProductRoadmapItem,
  right: ProductRoadmapItem,
): number {
  const scoreDelta = (right.score ?? -Infinity) - (left.score ?? -Infinity);
  if (scoreDelta !== 0) return scoreDelta;
  return left.id.localeCompare(right.id);
}

function findCycleMembers(
  nodes: readonly string[],
  dependencies: readonly RoadmapDependencyEvidence[],
): Set<string> {
  const nodeSet = new Set(nodes);
  const adjacency = new Map<string, string[]>();
  for (const dependency of dependencies) {
    if (
      dependency.status !== "active" ||
      !nodeSet.has(dependency.fromDemandId) ||
      !nodeSet.has(dependency.toDemandId)
    ) {
      continue;
    }
    const adjacent = adjacency.get(dependency.fromDemandId) ?? [];
    adjacent.push(dependency.toDemandId);
    adjacency.set(dependency.fromDemandId, adjacent);
  }

  const cycleMembers = new Set<string>();
  const path: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (node: string) => {
    if (visiting.has(node)) {
      const cycleStart = path.lastIndexOf(node);
      for (const member of path.slice(cycleStart)) cycleMembers.add(member);
      cycleMembers.add(node);
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    path.push(node);
    for (const next of adjacency.get(node) ?? []) visit(next);
    path.pop();
    visiting.delete(node);
    visited.add(node);
  };

  for (const node of nodes) visit(node);
  return cycleMembers;
}

function readiness(
  demand: RoadmapDemandEvidence,
  code: ProductRoadmapReadinessCode,
  scope: ProductRoadmapInput["scope"],
): ProductRoadmapReadinessItem {
  const values: Record<
    ProductRoadmapReadinessCode,
    Pick<ProductRoadmapReadinessItem, "reason" | "actionLabel" | "actionHref">
  > = {
    "demand-unclassified": {
      reason:
        "This demand has no canonical funnel stage, so its funding state is unknown.",
      actionLabel: "Classify demand",
      actionHref: demandHref(demand.id),
    },
    "funding-not-approved": {
      reason:
        "Only demand at the governed ready stage is an approved, funded bet.",
      actionLabel: "Review demand evidence",
      actionHref: demandHref(demand.id),
    },
    "objective-link-missing": {
      reason:
        "Funded work must be explicitly linked to an active product objective before it is committed.",
      actionLabel: "Link an objective",
      actionHref: objectiveHref(scope),
    },
    "objective-not-active": {
      reason:
        "The linked objective is not active, so this work is not a current committed bet.",
      actionLabel: "Review the objective",
      actionHref: objectiveHref(scope),
    },
    "delivery-contradiction": {
      reason:
        "The backlog status and delivery phase disagree. Resolve the canonical delivery records before publishing this bet.",
      actionLabel: "Review delivery state",
      actionHref: demandHref(demand.id),
    },
  };
  return {
    id: demand.id,
    title: demand.title,
    code,
    ...values[code],
    asOf: demand.asOf,
  };
}

function isDeliveryContradictory(demand: RoadmapDemandEvidence): boolean {
  if (!demand.delivery) return false;
  return (
    demand.status === "done" &&
    ACTIVE_DELIVERY_PHASES.has(demand.delivery.phase)
  );
}

function movementFor(
  demand: RoadmapDemandEvidence,
): ProductRoadmapItem["movement"] {
  if (demand.lastEvidenceChange) {
    return {
      summary: demand.lastEvidenceChange.summary,
      sourceKind: demand.lastEvidenceChange.kind,
      at: demand.lastEvidenceChange.at,
    };
  }
  if (demand.delivery) {
    return {
      summary: `Delivery is ${demand.delivery.phase}.`,
      sourceKind: "feature-build",
      at: demand.delivery.asOf,
    };
  }
  return {
    summary: "No later evidence change is recorded.",
    sourceKind: "backlog-item",
    at: demand.asOf,
  };
}

export function projectProductRoadmap(
  input: ProductRoadmapInput,
): ProductRoadmapProjection {
  const linkedObjectivesByWork = new Map<string, RoadmapObjectiveEvidence[]>();
  for (const objective of input.objectives) {
    for (const workItemId of objective.workItemIds) {
      const linked = linkedObjectivesByWork.get(workItemId) ?? [];
      linked.push(objective);
      linkedObjectivesByWork.set(workItemId, linked);
    }
  }

  const readinessItems: ProductRoadmapReadinessItem[] = [];
  const eligible: Array<{
    demand: RoadmapDemandEvidence;
    objectives: RoadmapObjectiveEvidence[];
  }> = [];

  for (const demand of input.demand) {
    const linkedObjectives = linkedObjectivesByWork.get(demand.id) ?? [];
    const activeObjectives = linkedObjectives.filter(
      (objective) => objective.status === "active",
    );
    let excluded = false;

    if (!["raw", "screened", "shaped", "ready"].includes(demand.demandStage ?? "")) {
      readinessItems.push(readiness(demand, "demand-unclassified", input.scope));
      excluded = true;
    } else if (demand.demandStage !== "ready") {
      readinessItems.push(readiness(demand, "funding-not-approved", input.scope));
      excluded = true;
    }

    if (demand.demandStage === "ready") {
      if (linkedObjectives.length === 0) {
        readinessItems.push(
          readiness(demand, "objective-link-missing", input.scope),
        );
        excluded = true;
      } else if (activeObjectives.length === 0) {
        readinessItems.push(
          readiness(demand, "objective-not-active", input.scope),
        );
        excluded = true;
      }
    }

    if (isDeliveryContradictory(demand)) {
      readinessItems.push(
        readiness(demand, "delivery-contradiction", input.scope),
      );
      excluded = true;
    }

    if (!excluded) eligible.push({ demand, objectives: activeObjectives });
  }

  const eligibleIds = eligible.map(({ demand }) => demand.id);
  const eligibleIdSet = new Set(eligibleIds);
  const cycleMembers = findCycleMembers(eligibleIds, input.dependencies);
  const provisionalItems = new Map<string, ProductRoadmapItem>();

  for (const { demand, objectives } of eligible) {
    const blockers: ProductRoadmapItem["blockers"] = [];
    if (cycleMembers.has(demand.id)) {
      const dependency = input.dependencies.find(
        (candidate) =>
          candidate.status === "active" &&
          (candidate.fromDemandId === demand.id ||
            candidate.toDemandId === demand.id),
      );
      blockers.push({
        code: "dependency-cycle",
        sourceId: dependency?.id ?? demand.id,
        summary:
          "This bet participates in a dependency cycle; sequence is unsafe until the canonical dependency evidence is corrected.",
      });
    }

    for (const constraint of input.architectureConstraints) {
      if (!constraint.blocking || !constraint.demandIds.includes(demand.id)) {
        continue;
      }
      blockers.push({
        code: "architecture-constraint",
        sourceId: constraint.id,
        summary: constraint.title,
      });
    }

    for (const dependency of input.dependencies) {
      if (
        dependency.status !== "active" ||
        dependency.fromDemandId !== demand.id ||
        cycleMembers.has(demand.id)
      ) {
        continue;
      }
      if (!eligibleIdSet.has(dependency.toDemandId)) {
        blockers.push({
          code: "dependency-not-ready",
          sourceId: dependency.id,
          summary:
            "A canonical dependency is not an eligible committed bet in this projection.",
        });
      }
    }

    const confidence = confidenceForDemand(demand);
    const deliveryActive =
      demand.status === "in-progress" ||
      (demand.delivery
        ? ACTIVE_DELIVERY_PHASES.has(demand.delivery.phase)
        : false);
    const lane: ProductRoadmapLane = deliveryActive
      ? "now"
      : blockers.length > 0 ||
          confidence === "unknown" ||
          confidence === "low"
        ? "later"
        : "next";
    const sourceIds = [
      demand.id,
      ...objectives.map((objective) => objective.id),
      ...(demand.delivery ? [demand.delivery.sourceId] : []),
      ...blockers.map((blocker) => blocker.sourceId),
    ];

    provisionalItems.set(demand.id, {
      id: demand.id,
      title: demand.title,
      lane,
      status: demand.status,
      objectiveIds: objectives.map((objective) => objective.id),
      objectiveTitles: objectives.map((objective) => objective.title),
      score: demand.score,
      investmentBucket: demand.investmentBucket,
      confidence,
      blockers,
      movement: movementFor(demand),
      sourceIds: [...new Set(sourceIds)].sort(),
      canonicalHref: demandHref(demand.id),
    });
  }

  const lanes: ProductRoadmapProjection["lanes"] = {
    now: [],
    next: [],
    later: [],
  };
  const completed: ProductRoadmapItem[] = [];
  for (const { demand } of eligible) {
    const item = provisionalItems.get(demand.id)!;
    if (demand.status === "done") completed.push(item);
    else lanes[item.lane].push(item);
  }
  for (const lane of PRODUCT_ROADMAP_LANES) {
    lanes[lane].sort(compareRoadmapItems);
  }
  completed.sort(compareRoadmapItems);
  const sequenceRank = new Map(
    [
      ...lanes.now,
      ...lanes.next,
      ...lanes.later,
      ...completed,
    ].map((item, index) => [item.id, index]),
  );

  const timeline = eligible
    .flatMap(({ demand }) => {
      if (!demand.delivery) return [];
      const dates = [
        {
          date: demand.delivery.plannedStartAt ?? null,
          dateKind: "planned-start" as const,
        },
        {
          date: demand.delivery.plannedEndAt ?? null,
          dateKind: "planned-end" as const,
        },
        {
          date: demand.delivery.shippedAt,
          dateKind: "shipped" as const,
        },
      ];
      return dates
        .filter(
          (
            entry,
          ): entry is {
            date: Date;
            dateKind: "planned-start" | "planned-end" | "shipped";
          } => entry.date instanceof Date,
        )
        .map((entry) => ({
          id: `${demand.delivery!.sourceId}:${entry.dateKind}`,
          itemId: demand.id,
          title: demand.title,
          date: entry.date,
          dateKind: entry.dateKind,
          sourceId: demand.delivery!.sourceId,
          confidence: confidenceForDemand(demand),
        }));
    })
    .sort(
      (left, right) =>
        left.date.getTime() - right.date.getTime() ||
        left.itemId.localeCompare(right.itemId),
    );

  const outcomes = input.objectives
    .filter((objective) => objective.status === "active")
    .map((objective) => {
      const itemIds = objective.workItemIds
        .filter((itemId) => provisionalItems.has(itemId))
        .sort(
          (left, right) =>
            (sequenceRank.get(left) ?? Number.MAX_SAFE_INTEGER) -
              (sequenceRank.get(right) ?? Number.MAX_SAFE_INTEGER) ||
            left.localeCompare(right),
        );
      return {
        objectiveId: objective.id,
        title: objective.title,
        itemIds,
        confidence: lowestConfidence(
          itemIds.map(
            (itemId) => provisionalItems.get(itemId)!.confidence,
          ),
        ),
      };
    })
    .filter((outcome) => outcome.itemIds.length > 0)
    .sort((left, right) => left.objectiveId.localeCompare(right.objectiveId));

  const dependencies = input.dependencies
    .filter(
      (dependency) =>
        dependency.status === "active" &&
        eligibleIdSet.has(dependency.fromDemandId) &&
        eligibleIdSet.has(dependency.toDemandId),
    )
    .map((dependency) => ({
      id: dependency.id,
      fromItemId: dependency.fromDemandId,
      toItemId: dependency.toDemandId,
      status: dependency.status,
      cyclic:
        cycleMembers.has(dependency.fromDemandId) &&
        cycleMembers.has(dependency.toDemandId),
      sourceId: dependency.id,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  const committedItems = [...provisionalItems.values()];
  const sourceIds = [
    ...input.demand.flatMap((demand) => [
      demand.id,
      ...(demand.delivery ? [demand.delivery.sourceId] : []),
    ]),
    ...input.objectives.map((objective) => objective.id),
    ...input.dependencies.map((dependency) => dependency.id),
    ...input.architectureConstraints.map((constraint) => constraint.id),
    ...(input.coordinationEvidence ?? []).map((evidence) => evidence.id),
  ];

  return {
    asOf: input.requestedAt,
    scope: input.scope,
    confidence: lowestConfidence(
      committedItems.map((item) => item.confidence),
    ),
    lanes,
    completed,
    readiness: readinessItems.sort(
      (left, right) =>
        right.asOf.getTime() - left.asOf.getTime() ||
        left.id.localeCompare(right.id) ||
        left.code.localeCompare(right.code),
    ),
    timeline,
    outcomes,
    dependencies,
    coordinationEvidence: [...(input.coordinationEvidence ?? [])].sort(
      (left, right) =>
        right.asOf.getTime() - left.asOf.getTime() ||
        left.id.localeCompare(right.id),
    ),
    sourceIds: [...new Set(sourceIds)].sort(),
  };
}

export type ProductRoadmapSnapshotFilters = {
  view: ProductRoadmapView;
  audience: ProductRoadmapAudience;
};

export type ProductRoadmapSnapshot = {
  schemaVersion: "dpf.product-roadmap.snapshot.v1";
  importable: false;
  asOf: string;
  filters: ProductRoadmapSnapshotFilters;
  sourceIds: string[];
  projection: ProductRoadmapProjection;
};

export function createProductRoadmapSnapshot(
  roadmap: ProductRoadmapProjection,
  filters: ProductRoadmapSnapshotFilters,
): ProductRoadmapSnapshot {
  return {
    schemaVersion: "dpf.product-roadmap.snapshot.v1",
    importable: false,
    asOf: roadmap.asOf.toISOString(),
    filters,
    sourceIds: [...roadmap.sourceIds],
    projection: roadmap,
  };
}
