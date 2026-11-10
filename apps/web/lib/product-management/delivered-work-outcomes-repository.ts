// BI-8DE5429B (reworks BI-42399593): the platform records, with no person in
// the loop, whether a backlog item's OWN outcome held: achieved at delivery,
// regressed when it is reopened from done, not achieved when failing evidence
// lands while it is done. Each observation references the item
// (ProductOutcomeObservation.backlogItemId) and carries its outcome text and
// source. The objective it hangs on, derived from the item's epic or the
// standing platform-work objective, is only the roll-up (WWMD
// DI-19ED69C312FC). The rules live in ./delivered-work-outcomes.

import { resolveItemOutcome } from "@/lib/backlog/intake-outcome";

import {
  DELIVERY_OBSERVATION_SOURCE_KIND,
  EPIC_OBJECTIVE_SOURCE_KIND,
  ITEM_OUTCOME_DECISION_REFS,
  ITEM_OUTCOME_MEASURE_DEFINITION,
  ITEM_OUTCOME_METHOD,
  ITEM_OUTCOME_RESULT_FOR_EVENT,
  PLATFORM_WORK_OBJECTIVE_SOURCE_KIND,
  classifyItemOutcomeActivity,
  isPlatformWorkScope,
  itemOutcomeSourceRef,
  itemOutcomeValue,
  outcomeDigest,
  type ItemOutcomeEvent,
  type ItemOutcomeResult,
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

/** Item events read per reconciliation run; more are reported as truncated and read next run. */
const MAX_EVENTS_PER_RUN = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
const PLATFORM_SCOPE_FILTER = [{ scopeKind: null }, { scopeKind: { in: ["platform", "common", "unknown"] } }];

type ObjectiveRef = { id: string; objectiveId: string; organizationId: string; productId: string; status: string };
type OutcomeItem = {
  id: string; itemId: string; title: string; body: string | null; workType: string | null;
  outcome: string | null; outcomeSource: string | null;
  status: string; scopeKind: string | null; businessProductId: string | null;
  organizationId: string | null; epicId: string | null; completedAt: Date | null;
  epic: { epicId: string; title: string; description: string | null } | null;
};
type ActivityRow = { id: string; backlogItemId: string; kind: string; recordedAt: Date; payload: unknown };

const OUTCOME_ITEM_SELECT = {
  id: true, itemId: true, title: true, body: true, workType: true, outcome: true, outcomeSource: true,
  status: true, scopeKind: true, businessProductId: true, organizationId: true, epicId: true, completedAt: true,
  epic: { select: { epicId: true, title: true, description: true } },
};

/**
 * The client the recorder runs on: the transition's own transaction client at
 * delivery, so an observation commits with the delivery it describes.
 */
export type DeliveredWorkOutcomeDb = ProductOutcomesDb & {
  backlogItem: ProductOutcomesDb["backlogItem"] & {
    findUnique(args: unknown): Promise<OutcomeItem | null>;
    findMany(args: unknown): Promise<OutcomeItem[]>;
  };
  backlogItemActivity: { findMany(args: unknown): Promise<ActivityRow[]> };
  productObjective: ProductOutcomesDb["productObjective"] & { findMany(args: unknown): Promise<ObjectiveRef[]> };
  productOutcomeObservation: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    findMany(args: unknown): Promise<{ sourceRef: string | null }[]>;
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
  | "already-recorded";

export type DeliveredWorkOutcomeResult =
  | { recorded: true; observationId: string; objectiveId: string; objectiveCreated: boolean; result: ItemOutcomeResult; value: number }
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
    measureDefinition: ITEM_OUTCOME_MEASURE_DEFINITION,
    measureUnit: null,
    baselineValue: null,
    // Every item's outcome holding is the definition of the roll-up, not a benchmark.
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
    title: "Delivered platform work achieves its outcomes",
    problemStatement: "Platform work merges and closes without anyone recording whether each item achieved its own outcome.",
    outcomeHypothesis:
      "Each delivered platform item achieves the outcome it states: it is not reopened and records no failing evidence after delivery.",
    origin: { sourceKind: PLATFORM_WORK_OBJECTIVE_SOURCE_KIND, sourceRef: input.productId },
  });
  return { created: true, objectiveId: objective.objectiveId };
}

async function epicObjective(
  db: DeliveredWorkOutcomeDb,
  standing: ObjectiveRef,
  epic: NonNullable<OutcomeItem["epic"]>,
): Promise<{ objective: ObjectiveRef; created: boolean }> {
  const existing = await db.productObjective.findFirst({
    where: { organizationId: standing.organizationId, sourceKind: EPIC_OBJECTIVE_SOURCE_KIND, sourceRef: epic.epicId },
  }) as unknown as ObjectiveRef | null;
  if (existing) return { objective: existing, created: false };
  const objective = await createActiveObjective(db, {
    organizationId: standing.organizationId,
    productId: standing.productId,
    title: `Item outcomes hold: ${epic.title}`.slice(0, 240),
    problemStatement: epic.description?.trim() ? epic.description.trim().slice(0, 4000) : null,
    outcomeHypothesis: `Each item delivered under ${epic.epicId} achieves its own outcome: ${epic.title}`,
    origin: { sourceKind: EPIC_OBJECTIVE_SOURCE_KIND, sourceRef: epic.epicId },
  });
  return { objective, created: true };
}

type RollupTarget =
  | { resolved: true; objective: ObjectiveRef; created: boolean }
  | { resolved: false; reason: DeliveredWorkOutcomeSkipReason };

/** The roll-up objective an item's observation hangs on: its epic's, or the standing one. */
async function rollupObjective(db: DeliveredWorkOutcomeDb, item: OutcomeItem): Promise<RollupTarget> {
  if (!isPlatformWorkScope(item)) return { resolved: false, reason: "out-of-scope" };
  const standing = await activeStandingObjectives(db, item.organizationId);
  if (standing.length === 0) return { resolved: false, reason: "no-platform-work-product" };
  if (standing.length > 1) return { resolved: false, reason: "platform-work-product-ambiguous" };
  const target = item.epic ? await epicObjective(db, standing[0]!, item.epic) : { objective: standing[0]!, created: false };
  if (target.objective.status !== "active") return { resolved: false, reason: "objective-not-active" };
  return { resolved: true, ...target };
}

/**
 * Record one observation of an item's own outcome. Reads and writes on `db`
 * only; the caller decides the transaction and swallows failures, so a
 * recording problem never blocks a delivery or a reopen.
 */
async function recordItemOutcome(
  db: DeliveredWorkOutcomeDb,
  item: OutcomeItem,
  event: { kind: ItemOutcomeEvent; ref: string; observedAt: Date; activityId?: string },
): Promise<DeliveredWorkOutcomeResult> {
  const target = await rollupObjective(db, item);
  if (!target.resolved) return { recorded: false, reason: target.reason };
  const sourceRef = itemOutcomeSourceRef(item.itemId, event.kind, event.ref);
  const prior = await db.productOutcomeObservation.findFirst({
    where: { sourceKind: DELIVERY_OBSERVATION_SOURCE_KIND, sourceRef },
    select: { id: true },
  });
  if (prior) return { recorded: false, reason: "already-recorded" };

  // An item filed before the outcome field, and not yet backfilled, is
  // measured against the outcome the backfill would give it.
  const outcome = item.outcome && item.outcomeSource
    ? { outcome: item.outcome, outcomeSource: item.outcomeSource }
    : resolveItemOutcome(item);
  const result = ITEM_OUTCOME_RESULT_FOR_EVENT[event.kind];
  const value = itemOutcomeValue(result);
  const observation = await recordProductOutcomeObservation(inTransaction(db), {
    organizationId: target.objective.organizationId,
    objectiveId: target.objective.objectiveId,
    observedAt: event.observedAt,
    numericValue: value,
    narrative: outcome.outcome,
    sourceKind: DELIVERY_OBSERVATION_SOURCE_KIND,
    sourceRef,
    confidence: null,
    provenance: {
      method: ITEM_OUTCOME_METHOD,
      decisionRefs: [...ITEM_OUTCOME_DECISION_REFS],
      recordedBy: "platform",
      itemId: item.itemId,
      event: event.kind,
      result,
      outcome: outcome.outcome,
      outcomeSource: outcome.outcomeSource,
      outcomeDigest: outcomeDigest(outcome.outcome),
      epicId: item.epic?.epicId ?? null,
      ...(event.activityId ? { activityId: event.activityId } : {}),
    },
    recordedByPrincipalId: null,
    supersedesObservationId: null,
    backlogItemId: item.id,
  });
  return {
    recorded: true,
    observationId: String(observation.observationId),
    objectiveId: target.objective.objectiveId,
    objectiveCreated: target.created,
    result,
    value,
  };
}

/** At delivery: the item's outcome is achieved (delivery closes an item by default). */
export async function recordDeliveredWorkOutcome(
  db: DeliveredWorkOutcomeDb,
  input: { backlogItemRowId: string; observedAt: Date },
): Promise<DeliveredWorkOutcomeResult> {
  const item = await db.backlogItem.findUnique({ where: { id: input.backlogItemRowId }, select: OUTCOME_ITEM_SELECT });
  if (!item) return { recorded: false, reason: "item-not-found" };
  if (item.status !== "done") return { recorded: false, reason: "not-delivered" };
  const deliveredAt = item.completedAt ?? input.observedAt;
  return recordItemOutcome(db, item, { kind: "delivered", ref: deliveredAt.toISOString(), observedAt: input.observedAt });
}

export type ItemOutcomeEventsResult = {
  scanned: number;
  recorded: number;
  byResult: Partial<Record<ItemOutcomeResult, number>>;
  skipped: Partial<Record<DeliveredWorkOutcomeSkipReason, number>>;
  truncated: boolean;
};

/**
 * After delivery: reopens from done record regressed, and failing evidence
 * while done records not achieved. Read from the item's own activity, so
 * every status writer is covered without each one calling a hook. Bounded
 * and idempotent (one observation per activity row).
 */
export async function recordItemOutcomeEvents(
  db: DeliveredWorkOutcomeDb,
  input: { now: Date; lookbackDays?: number; limit?: number },
): Promise<ItemOutcomeEventsResult> {
  const limit = input.limit ?? MAX_EVENTS_PER_RUN;
  const since = new Date(input.now.getTime() - (input.lookbackDays ?? 7) * DAY_MS);
  const activities = await db.backlogItemActivity.findMany({
    where: {
      recordedAt: { gte: since, lte: input.now },
      backlogItem: { businessProductId: null, OR: PLATFORM_SCOPE_FILTER },
      OR: [
        { kind: "status_change", payload: { path: ["from"], equals: "done" } },
        { kind: "evidence", backlogItem: { status: "done" } },
      ],
    },
    select: { id: true, backlogItemId: true, kind: true, recordedAt: true, payload: true },
    orderBy: { recordedAt: "asc" },
    take: limit,
  });
  const result: ItemOutcomeEventsResult = {
    scanned: activities.length, recorded: 0, byResult: {}, skipped: {}, truncated: activities.length >= limit,
  };
  if (activities.length === 0) return result;
  const items = await db.backlogItem.findMany({
    where: { id: { in: [...new Set(activities.map((row) => row.backlogItemId))] } },
    select: OUTCOME_ITEM_SELECT,
  });
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const activity of activities) {
    const item = byId.get(activity.backlogItemId);
    if (!item) continue;
    const kind = classifyItemOutcomeActivity(activity, item);
    if (!kind) continue;
    const outcome = await recordItemOutcome(db, item, {
      kind, ref: activity.id, observedAt: activity.recordedAt, activityId: activity.id,
    });
    if (outcome.recorded) {
      result.recorded += 1;
      result.byResult[outcome.result] = (result.byResult[outcome.result] ?? 0) + 1;
    } else {
      result.skipped[outcome.reason] = (result.skipped[outcome.reason] ?? 0) + 1;
    }
  }
  return result;
}
