// BI-42399593: the platform records a product outcome observation when
// platform work is delivered, against an objective it derives from the work's
// epic (or the standing platform-work objective). No person is in the loop.
// The measure and its rules live in ./delivered-work-outcomes.

import {
  DELIVERED_WORK_DECISION_REFS,
  DELIVERED_WORK_MEASURE_DEFINITION,
  DELIVERED_WORK_OUTCOME_METHOD,
  DELIVERY_OBSERVATION_SOURCE_KIND,
  EPIC_OBJECTIVE_SOURCE_KIND,
  HOLD_WINDOW_DAYS,
  LOOKBACK_DAYS,
  PLATFORM_WORK_OBJECTIVE_SOURCE_KIND,
  computeDeliveredWorkHoldRate,
  deliveredWorkWindow,
  deliveryObservationSourceRef,
  isPlatformWorkScope,
  type DeliveredWorkFact,
} from "./delivered-work-outcomes";
import {
  ProductOutcomeConflictError,
  createProductObjective,
  recordProductOutcomeObservation,
  transitionProductObjective,
  type CreateProductObjectiveInput,
  type ProductOutcomesDb,
  type ProductOutcomesTransactionalDb,
} from "./outcomes-repository";

/** Matured deliveries read per observation; a cohort beyond this is reported as truncated. */
const MAX_COHORT_DELIVERIES = 2000;
const PLATFORM_SCOPE_FILTER = [{ scopeKind: null }, { scopeKind: { in: ["platform", "common", "unknown"] } }];

type ObjectiveRef = { id: string; objectiveId: string; organizationId: string; productId: string; status: string };
type DeliveredItem = {
  id: string; itemId: string; status: string; scopeKind: string | null; businessProductId: string | null;
  organizationId: string | null; epicId: string | null; completedAt: Date | null;
  epic: { epicId: string; title: string; description: string | null } | null;
};
type ActivityRow = { backlogItemId: string; kind: string; recordedAt: Date; payload: unknown };

/**
 * The client the recorder runs on: the transition's own transaction client in
 * production, so an observation commits with the delivery it describes.
 */
export type DeliveredWorkOutcomeDb = ProductOutcomesDb & {
  backlogItem: ProductOutcomesDb["backlogItem"] & {
    findUnique(args: unknown): Promise<DeliveredItem | null>;
    findMany(args: unknown): Promise<{ id: string; itemId: string; status: string }[]>;
  };
  backlogItemActivity: { findMany(args: unknown): Promise<ActivityRow[]> };
  productObjective: ProductOutcomesDb["productObjective"] & { findMany(args: unknown): Promise<ObjectiveRef[]> };
  productOutcomeObservation: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    count(args: unknown): Promise<number>;
  };
};

export type DeliveredWorkOutcomeSkipReason =
  | "item-not-found"
  | "not-delivered"
  | "out-of-scope"
  | "no-platform-work-product"
  | "platform-work-product-ambiguous"
  | "objective-not-active"
  | "already-recorded"
  | "no-matured-cohort";

export type DeliveredWorkOutcomeResult =
  | { recorded: true; observationId: string; objectiveId: string; objectiveCreated: boolean; value: number }
  | { recorded: false; reason: DeliveredWorkOutcomeSkipReason };

/** The repository's writers expect `$transaction`; we are already inside one. */
function inTransaction(db: DeliveredWorkOutcomeDb): ProductOutcomesTransactionalDb {
  const client = {
    product: db.product,
    principal: db.principal,
    productObjective: db.productObjective,
    backlogItem: db.backlogItem,
    productObjectiveWork: db.productObjectiveWork,
    productOutcomeObservation: db.productOutcomeObservation,
  };
  return { ...client, $transaction: (callback) => callback(client as never) } as ProductOutcomesTransactionalDb;
}

const OBJECTIVE_REF_SELECT = { id: true, objectiveId: true, organizationId: true, productId: true, status: true };

function measureContract(): Pick<CreateProductObjectiveInput,
  "measureKind" | "measureDefinition" | "measureUnit" | "baselineValue" | "targetValue"
  | "baselineNarrative" | "targetNarrative" | "reviewCadence" | "reviewAt" | "ownerPrincipalId"> {
  return {
    measureKind: "percentage",
    measureDefinition: DELIVERED_WORK_MEASURE_DEFINITION,
    measureUnit: null,
    baselineValue: null,
    // Every delivered item holding is the definition of the outcome, not a benchmark.
    targetValue: 100,
    baselineNarrative: null,
    targetNarrative: null,
    reviewCadence: "monthly",
    reviewAt: null,
    ownerPrincipalId: null,
  };
}

async function activeStandingObjectives(db: DeliveredWorkOutcomeDb, organizationId: string | null) {
  return db.productObjective.findMany({
    where: {
      sourceKind: PLATFORM_WORK_OBJECTIVE_SOURCE_KIND,
      status: "active",
      ...(organizationId ? { organizationId } : {}),
    },
    select: OBJECTIVE_REF_SELECT,
    take: 2,
  });
}

async function createActiveObjective(
  db: DeliveredWorkOutcomeDb,
  input: Omit<CreateProductObjectiveInput, keyof ReturnType<typeof measureContract>>,
): Promise<ObjectiveRef> {
  const writer = inTransaction(db);
  const created = await createProductObjective(writer, { ...input, ...measureContract() });
  const active = await transitionProductObjective(writer, {
    organizationId: input.organizationId,
    objectiveId: created.objectiveId,
    to: "active",
  });
  return active as unknown as ObjectiveRef;
}

/**
 * Designate the business Product platform work serves (WWMD DI-F3101AA957C7).
 * The standing platform-work objective IS the designation: there is no
 * second store. Idempotent for the same Product; a different Product is
 * refused while one is designated.
 */
export async function designatePlatformWorkProduct(
  db: DeliveredWorkOutcomeDb,
  input: { organizationId: string; productId: string },
): Promise<{ created: boolean; objectiveId: string }> {
  const [current] = await activeStandingObjectives(db, input.organizationId);
  if (current) {
    if (current.productId === input.productId) return { created: false, objectiveId: current.objectiveId };
    throw new ProductOutcomeConflictError(
      `Platform work is already designated to another Product (${current.objectiveId}). Close that objective before designating a different Product.`,
    );
  }
  const prior = await db.productObjective.findFirst({
    where: { organizationId: input.organizationId, sourceKind: PLATFORM_WORK_OBJECTIVE_SOURCE_KIND, sourceRef: input.productId },
  });
  if (prior) {
    throw new ProductOutcomeConflictError(
      `This Product's platform-work objective ${prior.objectiveId} is ${prior.status}; reactivating a closed objective is not allowed.`,
    );
  }
  const objective = await createActiveObjective(db, {
    organizationId: input.organizationId,
    productId: input.productId,
    title: "Delivered platform work holds",
    problemStatement: "Platform work merges and closes without anyone recording whether it achieved its purpose.",
    outcomeHypothesis:
      "Platform work that is delivered stays delivered: it is not reopened and records no failing evidence after delivery.",
    origin: { sourceKind: PLATFORM_WORK_OBJECTIVE_SOURCE_KIND, sourceRef: input.productId },
  });
  return { created: true, objectiveId: objective.objectiveId };
}

async function epicObjective(
  db: DeliveredWorkOutcomeDb,
  standing: ObjectiveRef,
  epic: NonNullable<DeliveredItem["epic"]>,
): Promise<{ objective: ObjectiveRef; created: boolean }> {
  const existing = await db.productObjective.findFirst({
    where: { organizationId: standing.organizationId, sourceKind: EPIC_OBJECTIVE_SOURCE_KIND, sourceRef: epic.epicId },
  }) as unknown as ObjectiveRef | null;
  if (existing) return { objective: existing, created: false };
  const objective = await createActiveObjective(db, {
    organizationId: standing.organizationId,
    productId: standing.productId,
    title: `Delivered work holds: ${epic.title}`.slice(0, 240),
    problemStatement: epic.description?.trim() ? epic.description.trim().slice(0, 4000) : null,
    outcomeHypothesis: `Work delivered under ${epic.epicId} achieves its purpose: ${epic.title}`,
    origin: { sourceKind: EPIC_OBJECTIVE_SOURCE_KIND, sourceRef: epic.epicId },
  });
  return { objective, created: true };
}

async function maturedFacts(db: DeliveredWorkOutcomeDb, item: DeliveredItem, observedAt: Date) {
  const window = deliveredWorkWindow(observedAt);
  const deliveries = await db.backlogItemActivity.findMany({
    where: {
      kind: "status_change",
      recordedAt: { gte: window.from, lte: window.to },
      payload: { path: ["to"], equals: "done" },
      backlogItem: { epicId: item.epicId, businessProductId: null, OR: PLATFORM_SCOPE_FILTER },
    },
    select: { backlogItemId: true, kind: true, recordedAt: true, payload: true },
    orderBy: { recordedAt: "asc" },
    take: MAX_COHORT_DELIVERIES,
  });
  const firstDelivery = new Map<string, Date>();
  for (const row of deliveries) if (!firstDelivery.has(row.backlogItemId)) firstDelivery.set(row.backlogItemId, row.recordedAt);
  const ids = [...firstDelivery.keys()];
  if (ids.length === 0) return { facts: [] as DeliveredWorkFact[], window, truncated: false };
  const [items, later] = await Promise.all([
    db.backlogItem.findMany({ where: { id: { in: ids } }, select: { id: true, itemId: true, status: true } }),
    db.backlogItemActivity.findMany({
      where: {
        backlogItemId: { in: ids },
        recordedAt: { gte: window.from },
        OR: [{ kind: "status_change", payload: { path: ["from"], equals: "done" } }, { kind: "evidence" }],
      },
      select: { backlogItemId: true, kind: true, recordedAt: true, payload: true },
    }),
  ]);
  const facts = items.map((row) => ({
    itemId: row.itemId,
    status: row.status,
    deliveredAt: firstDelivery.get(row.id)!,
    laterActivities: later.filter((activity) => activity.backlogItemId === row.id),
  }));
  return { facts, window, truncated: deliveries.length >= MAX_COHORT_DELIVERIES };
}

/**
 * Record the outcome observation for one delivered item. Reads and writes on
 * `db` only; the caller decides the transaction and swallows failures, so a
 * recording problem never blocks a delivery.
 */
export async function recordDeliveredWorkOutcome(
  db: DeliveredWorkOutcomeDb,
  input: { backlogItemRowId: string; observedAt: Date },
): Promise<DeliveredWorkOutcomeResult> {
  const item = await db.backlogItem.findUnique({
    where: { id: input.backlogItemRowId },
    select: {
      id: true, itemId: true, status: true, scopeKind: true, businessProductId: true,
      organizationId: true, epicId: true, completedAt: true,
      epic: { select: { epicId: true, title: true, description: true } },
    },
  });
  if (!item) return { recorded: false, reason: "item-not-found" };
  if (item.status !== "done") return { recorded: false, reason: "not-delivered" };
  if (!isPlatformWorkScope(item)) return { recorded: false, reason: "out-of-scope" };

  const standing = await activeStandingObjectives(db, item.organizationId);
  if (standing.length === 0) return { recorded: false, reason: "no-platform-work-product" };
  if (standing.length > 1) return { recorded: false, reason: "platform-work-product-ambiguous" };

  const target = item.epic ? await epicObjective(db, standing[0]!, item.epic) : { objective: standing[0]!, created: false };
  if (target.objective.status !== "active") return { recorded: false, reason: "objective-not-active" };

  const deliveredAt = item.completedAt ?? input.observedAt;
  const sourceRef = deliveryObservationSourceRef(item.itemId, deliveredAt);
  const prior = await db.productOutcomeObservation.findFirst({
    where: { objectiveId: target.objective.id, sourceKind: DELIVERY_OBSERVATION_SOURCE_KIND, sourceRef },
    select: { id: true },
  });
  if (prior) return { recorded: false, reason: "already-recorded" };

  const { facts, window, truncated } = await maturedFacts(db, item, input.observedAt);
  const rate = computeDeliveredWorkHoldRate(facts);
  if (!rate) return { recorded: false, reason: "no-matured-cohort" };

  const observation = await recordProductOutcomeObservation(inTransaction(db), {
    organizationId: target.objective.organizationId,
    objectiveId: target.objective.objectiveId,
    observedAt: input.observedAt,
    numericValue: rate.value,
    narrative: null,
    sourceKind: DELIVERY_OBSERVATION_SOURCE_KIND,
    sourceRef,
    confidence: null,
    provenance: {
      method: DELIVERED_WORK_OUTCOME_METHOD,
      decisionRefs: [...DELIVERED_WORK_DECISION_REFS],
      recordedBy: "platform",
      deliveredItemId: item.itemId,
      deliveredAt: deliveredAt.toISOString(),
      epicId: item.epic?.epicId ?? null,
      cohort: { from: window.from.toISOString(), to: window.to.toISOString(), holdWindowDays: HOLD_WINDOW_DAYS, lookbackDays: LOOKBACK_DAYS, truncated },
      numerator: rate.numerator,
      denominator: rate.denominator,
      notHeld: rate.notHeld.slice(0, 50),
    },
    recordedByPrincipalId: null,
    supersedesObservationId: null,
  });
  return {
    recorded: true,
    observationId: String(observation.observationId),
    objectiveId: target.objective.objectiveId,
    objectiveCreated: target.created,
    value: rate.value,
  };
}
