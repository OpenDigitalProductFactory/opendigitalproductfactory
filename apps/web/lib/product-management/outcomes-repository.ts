import { randomUUID } from "node:crypto";
import {
  PRODUCT_OBJECTIVE_STATUSES,
  PRODUCT_OBJECTIVE_REVIEW_CADENCES,
  PRODUCT_OBJECTIVE_WORK_CONTRIBUTION_KINDS,
  PRODUCT_OUTCOME_MEASURE_KINDS,
  PRODUCT_OUTCOME_SOURCE_KINDS,
  type ProductObjectiveReviewCadence,
  type ProductObjectiveStatus,
  type ProductObjectiveWorkContributionKind,
  type ProductOutcomeMeasureKind,
  type ProductOutcomeSourceKind,
  validateObjectiveContract,
  validateObjectiveStatusTransition,
} from "./outcomes";

export class ProductOutcomeNotFoundError extends Error {
  constructor(message = "The product outcome record was not found.") {
    super(message);
    this.name = "ProductOutcomeNotFoundError";
  }
}

export class ProductOutcomeConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductOutcomeConflictError";
  }
}

export class ProductOutcomeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductOutcomeValidationError";
  }
}

type ProductRow = { id: string; organizationId: string };
type PrincipalRow = { id: string };
type ObjectiveRow = {
  id: string;
  objectiveId: string;
  organizationId: string;
  productId: string;
  status: string;
  measureKind: string;
  measureUnit: string | null;
  baselineValue: number | { toNumber(): number } | null;
  targetValue: number | { toNumber(): number } | null;
  baselineNarrative: string | null;
  targetNarrative: string | null;
  reviewAt: Date | null;
};
type BacklogRow = {
  id: string;
  itemId: string;
  organizationId: string | null;
  businessProductId: string | null;
};
type ObservationRow = {
  id: string;
  observationId: string;
  objectiveId: string;
  supersededBy: { id: string } | null;
};

export type ProductOutcomesDb = {
  product: {
    findFirst(args: unknown): Promise<ProductRow | null>;
  };
  principal: {
    findFirst(args: unknown): Promise<PrincipalRow | null>;
  };
  productObjective: {
    findFirst(args: unknown): Promise<ObjectiveRow | null>;
    create(args: { data: Record<string, unknown> }): Promise<ObjectiveRow>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<ObjectiveRow>;
  };
  backlogItem: {
    findFirst(args: unknown): Promise<BacklogRow | null>;
  };
  productObjectiveWork: {
    upsert(args: unknown): Promise<unknown>;
  };
  productOutcomeObservation?: {
    count(args: unknown): Promise<number>;
  };
};

type ProductOutcomesTransactionDb = ProductOutcomesDb & {
  productOutcomeObservation: {
    findFirst(args: unknown): Promise<ObservationRow | null>;
    create(args: {
      data: Record<string, unknown>;
    }): Promise<Record<string, unknown>>;
    count(args: unknown): Promise<number>;
  };
};

export type ProductOutcomesTransactionalDb = ProductOutcomesDb & {
  $transaction<T>(
    callback: (tx: ProductOutcomesTransactionDb) => Promise<T>,
  ): Promise<T>;
};

function cleanRequired(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ProductOutcomeValidationError(`${label} is required.`);
  }
  return value.trim();
}

function cleanOptional(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumberOrNull(value: number | null, label: string): number | null {
  if (value !== null && !Number.isFinite(value)) {
    throw new ProductOutcomeValidationError(`${label} must be a finite number.`);
  }
  return value;
}

function assertEnum<T extends readonly string[]>(
  value: unknown,
  values: T,
  label: string,
): T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new ProductOutcomeValidationError(
      `${label} must be one of: ${values.join(", ")}.`,
    );
  }
  return value as T[number];
}

function semanticId(prefix: "OBJ" | "OBS"): string {
  return `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
}

async function requireProduct(
  db: Pick<ProductOutcomesDb, "product">,
  organizationId: string,
  productId: string,
): Promise<ProductRow> {
  const product = await db.product.findFirst({
    where: { id: productId, organizationId, effectiveTo: null },
    select: { id: true, organizationId: true },
  });
  if (!product) {
    throw new ProductOutcomeNotFoundError(
      "No business Product exists in the authorized organization.",
    );
  }
  return product;
}

async function resolvePrincipalId(
  db: Pick<ProductOutcomesDb, "principal">,
  principalId: string | null | undefined,
): Promise<string | null> {
  if (!principalId) return null;
  const principal = await db.principal.findFirst({
    where: { principalId, status: "active" },
    select: { id: true },
  });
  if (!principal) {
    throw new ProductOutcomeNotFoundError("The selected Principal is unavailable.");
  }
  return principal.id;
}

async function requireObjective(
  db: Pick<ProductOutcomesDb, "productObjective">,
  organizationId: string,
  objectiveId: string,
): Promise<ObjectiveRow> {
  const objective = await db.productObjective.findFirst({
    where: { objectiveId, organizationId },
  });
  if (!objective) throw new ProductOutcomeNotFoundError();
  return objective;
}

export type CreateProductObjectiveInput = {
  organizationId: string;
  productId: string;
  title: string;
  problemStatement: string | null;
  outcomeHypothesis: string;
  ownerPrincipalId: string | null;
  measureKind: ProductOutcomeMeasureKind;
  measureDefinition: string;
  measureUnit: string | null;
  baselineValue: number | null;
  targetValue: number | null;
  baselineNarrative: string | null;
  targetNarrative: string | null;
  reviewCadence: ProductObjectiveReviewCadence | null;
  reviewAt: Date | null;
};

export async function createProductObjective(
  db: ProductOutcomesDb,
  input: CreateProductObjectiveInput,
): Promise<ObjectiveRow> {
  const organizationId = cleanRequired(input.organizationId, "Organization");
  const productId = cleanRequired(input.productId, "Product");
  await requireProduct(db, organizationId, productId);
  const measureKind = assertEnum(
    input.measureKind,
    PRODUCT_OUTCOME_MEASURE_KINDS,
    "Measure kind",
  );
  const contract = {
    measureKind,
    measureUnit: cleanOptional(input.measureUnit),
    baselineValue: finiteNumberOrNull(input.baselineValue, "Baseline"),
    targetValue: finiteNumberOrNull(input.targetValue, "Target"),
    baselineNarrative: cleanOptional(input.baselineNarrative),
    targetNarrative: cleanOptional(input.targetNarrative),
  };
  const validation = validateObjectiveContract(contract);
  if (!validation.ok) {
    throw new ProductOutcomeValidationError(validation.message);
  }
  const ownerPrincipalId = await resolvePrincipalId(
    db,
    input.ownerPrincipalId,
  );
  return db.productObjective.create({
    data: {
      objectiveId: semanticId("OBJ"),
      organizationId,
      productId,
      title: cleanRequired(input.title, "Title"),
      problemStatement: cleanOptional(input.problemStatement),
      outcomeHypothesis: cleanRequired(
        input.outcomeHypothesis,
        "Outcome hypothesis",
      ),
      ownerPrincipalId,
      measureKind,
      measureDefinition: cleanRequired(
        input.measureDefinition,
        "Measure definition",
      ),
      ...contract,
      reviewCadence:
        input.reviewCadence === null
          ? null
          : assertEnum(
              input.reviewCadence,
              PRODUCT_OBJECTIVE_REVIEW_CADENCES,
              "Review cadence",
            ),
      reviewAt: input.reviewAt,
      status: "draft",
    },
  });
}

export type UpdateProductObjectiveInput = Partial<
  Omit<
    CreateProductObjectiveInput,
    "organizationId" | "productId" | "ownerPrincipalId"
  >
> & {
  organizationId: string;
  objectiveId: string;
  ownerPrincipalId?: string | null;
};

export async function updateProductObjective(
  db: ProductOutcomesDb,
  input: UpdateProductObjectiveInput,
): Promise<ObjectiveRow> {
  const objective = await requireObjective(
    db,
    input.organizationId,
    input.objectiveId,
  );
  if (objective.status === "closed" || objective.status === "archived") {
    throw new ProductOutcomeConflictError(
      "Closed or archived objectives cannot be edited.",
    );
  }
  const changesMeasureContract =
    input.measureKind !== undefined ||
    input.measureUnit !== undefined ||
    input.baselineValue !== undefined ||
    input.targetValue !== undefined ||
    input.baselineNarrative !== undefined ||
    input.targetNarrative !== undefined;
  if (
    changesMeasureContract &&
    db.productOutcomeObservation &&
    (await db.productOutcomeObservation.count({
      where: { objectiveId: objective.id },
    })) > 0
  ) {
    throw new ProductOutcomeConflictError(
      "The measure contract cannot change after observations exist. Close this objective and define a new one.",
    );
  }

  const measureKind = assertEnum(
    input.measureKind ?? objective.measureKind,
    PRODUCT_OUTCOME_MEASURE_KINDS,
    "Measure kind",
  );
  const contract = {
    measureKind,
    measureUnit:
      input.measureUnit === undefined
        ? objective.measureUnit
        : cleanOptional(input.measureUnit),
    baselineValue:
      input.baselineValue === undefined
        ? numberOf(objective.baselineValue)
        : finiteNumberOrNull(input.baselineValue, "Baseline"),
    targetValue:
      input.targetValue === undefined
        ? numberOf(objective.targetValue)
        : finiteNumberOrNull(input.targetValue, "Target"),
    baselineNarrative:
      input.baselineNarrative === undefined
        ? objective.baselineNarrative
        : cleanOptional(input.baselineNarrative),
    targetNarrative:
      input.targetNarrative === undefined
        ? objective.targetNarrative
        : cleanOptional(input.targetNarrative),
  };
  const validation = validateObjectiveContract(contract);
  if (!validation.ok) {
    throw new ProductOutcomeValidationError(validation.message);
  }

  const data: Record<string, unknown> = { ...contract };
  if (input.title !== undefined) data["title"] = cleanRequired(input.title, "Title");
  if (input.problemStatement !== undefined) {
    data["problemStatement"] = cleanOptional(input.problemStatement);
  }
  if (input.outcomeHypothesis !== undefined) {
    data["outcomeHypothesis"] = cleanRequired(
      input.outcomeHypothesis,
      "Outcome hypothesis",
    );
  }
  if (input.measureDefinition !== undefined) {
    data["measureDefinition"] = cleanRequired(
      input.measureDefinition,
      "Measure definition",
    );
  }
  if (input.reviewCadence !== undefined) {
    data["reviewCadence"] =
      input.reviewCadence === null
        ? null
        : assertEnum(
            input.reviewCadence,
            PRODUCT_OBJECTIVE_REVIEW_CADENCES,
            "Review cadence",
          );
  }
  if (input.reviewAt !== undefined) data["reviewAt"] = input.reviewAt;
  if (input.ownerPrincipalId !== undefined) {
    data["ownerPrincipalId"] = await resolvePrincipalId(
      db,
      input.ownerPrincipalId,
    );
  }
  return db.productObjective.update({
    where: { id: objective.id },
    data,
  });
}

export async function reviewProductObjective(
  db: ProductOutcomesDb,
  input: {
    organizationId: string;
    objectiveId: string;
    reviewedAt: Date;
    nextReviewAt: Date | null;
  },
): Promise<ObjectiveRow> {
  const objective = await requireObjective(
    db,
    input.organizationId,
    input.objectiveId,
  );
  if (objective.status !== "active") {
    throw new ProductOutcomeConflictError(
      "Only active objectives can be reviewed.",
    );
  }
  if (
    input.nextReviewAt &&
    input.nextReviewAt.getTime() <= input.reviewedAt.getTime()
  ) {
    throw new ProductOutcomeValidationError(
      "The next review must be after this review.",
    );
  }
  return db.productObjective.update({
    where: { id: objective.id },
    data: {
      reviewedAt: input.reviewedAt,
      reviewAt: input.nextReviewAt,
    },
  });
}

export async function transitionProductObjective(
  db: ProductOutcomesDb,
  input: {
    organizationId: string;
    objectiveId: string;
    to: ProductObjectiveStatus;
  },
): Promise<ObjectiveRow> {
  const objective = await requireObjective(
    db,
    input.organizationId,
    input.objectiveId,
  );
  const from = assertEnum(
    objective.status,
    PRODUCT_OBJECTIVE_STATUSES,
    "Current status",
  );
  const to = assertEnum(input.to, PRODUCT_OBJECTIVE_STATUSES, "Target status");
  const transition = validateObjectiveStatusTransition(from, to);
  if (!transition.ok) {
    throw new ProductOutcomeConflictError(transition.message);
  }
  const now = new Date();
  return db.productObjective.update({
    where: { id: objective.id },
    data: {
      status: to,
      activatedAt: to === "active" ? now : undefined,
      closedAt: to === "closed" ? now : undefined,
      archivedAt: to === "archived" ? now : undefined,
    },
  });
}

export async function linkObjectiveWork(
  db: ProductOutcomesDb,
  input: {
    organizationId: string;
    objectiveId: string;
    backlogItemId: string;
    contributionKind: ProductObjectiveWorkContributionKind;
  },
): Promise<unknown> {
  const objective = await requireObjective(
    db,
    input.organizationId,
    input.objectiveId,
  );
  if (objective.status === "archived") {
    throw new ProductOutcomeConflictError(
      "Archived objectives cannot receive contributing work.",
    );
  }
  const backlog = await db.backlogItem.findFirst({
    where: {
      itemId: input.backlogItemId,
      organizationId: input.organizationId,
    },
    select: {
      id: true,
      itemId: true,
      organizationId: true,
      businessProductId: true,
    },
  });
  if (!backlog) throw new ProductOutcomeNotFoundError("Backlog item not found.");
  if (backlog.businessProductId !== objective.productId) {
    throw new ProductOutcomeConflictError(
      "Contributing work must be scoped to the same business Product.",
    );
  }
  const contributionKind = assertEnum(
    input.contributionKind,
    PRODUCT_OBJECTIVE_WORK_CONTRIBUTION_KINDS,
    "Contribution kind",
  );
  return db.productObjectiveWork.upsert({
    where: {
      objectiveId_backlogItemId: {
        objectiveId: objective.id,
        backlogItemId: backlog.id,
      },
    },
    create: {
      objectiveId: objective.id,
      backlogItemId: backlog.id,
      contributionKind,
    },
    update: { contributionKind },
  });
}

export type RecordProductOutcomeObservationInput = {
  organizationId: string;
  objectiveId: string;
  observedAt: Date;
  numericValue: number | null;
  narrative: string | null;
  sourceKind: ProductOutcomeSourceKind;
  sourceRef: string | null;
  confidence: number | null;
  provenance: Record<string, unknown> | null;
  recordedByPrincipalId: string | null;
  supersedesObservationId: string | null;
};

function numberOf(
  value: number | { toNumber(): number } | null,
): number | null {
  if (value === null) return null;
  return typeof value === "number" ? value : value.toNumber();
}

function validateObservation(
  objective: ObjectiveRow,
  input: RecordProductOutcomeObservationInput,
) {
  finiteNumberOrNull(input.numericValue, "Observation value");
  finiteNumberOrNull(input.confidence, "Observation confidence");
  const measureKind = assertEnum(
    objective.measureKind,
    PRODUCT_OUTCOME_MEASURE_KINDS,
    "Measure kind",
  );
  if (measureKind === "qualitative") {
    if (input.numericValue !== null || !cleanOptional(input.narrative)) {
      throw new ProductOutcomeValidationError(
        "Qualitative observations require a narrative and cannot carry a numeric value.",
      );
    }
  } else if (input.numericValue === null) {
    throw new ProductOutcomeValidationError(
      "Quantitative observations require a numeric value.",
    );
  }
  if (
    measureKind === "percentage" &&
    input.numericValue !== null &&
    (input.numericValue < 0 || input.numericValue > 100)
  ) {
    throw new ProductOutcomeValidationError(
      "Percentage observations must be between 0 and 100.",
    );
  }
  if (
    input.confidence !== null &&
    (input.confidence < 0 || input.confidence > 1)
  ) {
    throw new ProductOutcomeValidationError(
      "Observation confidence must be between 0 and 1.",
    );
  }
  return measureKind;
}

export async function recordProductOutcomeObservation(
  db: ProductOutcomesTransactionalDb,
  input: RecordProductOutcomeObservationInput,
): Promise<Record<string, unknown>> {
  return db.$transaction(async (tx) => {
    const objective = await requireObjective(
      tx,
      input.organizationId,
      input.objectiveId,
    );
    if (objective.status !== "active") {
      throw new ProductOutcomeConflictError(
        "Observations can be recorded only for active objectives.",
      );
    }
    const measureKind = validateObservation(objective, input);
    const recordedByPrincipalId = await resolvePrincipalId(
      tx,
      input.recordedByPrincipalId,
    );
    let supersedesObservationId: string | null = null;
    if (input.supersedesObservationId) {
      const prior = await tx.productOutcomeObservation.findFirst({
        where: {
          observationId: input.supersedesObservationId,
          objectiveId: objective.id,
        },
        select: {
          id: true,
          observationId: true,
          objectiveId: true,
          supersededBy: { select: { id: true } },
        },
      });
      if (!prior) {
        throw new ProductOutcomeNotFoundError(
          "The observation being corrected was not found.",
        );
      }
      if (prior.supersededBy) {
        throw new ProductOutcomeConflictError(
          "That observation already has a correction. Correct the latest observation instead.",
        );
      }
      supersedesObservationId = prior.id;
    }
    return tx.productOutcomeObservation.create({
      data: {
        observationId: semanticId("OBS"),
        objectiveId: objective.id,
        observedAt: input.observedAt,
        numericValue: input.numericValue,
        narrative: cleanOptional(input.narrative),
        measureKind,
        measureUnit: objective.measureUnit,
        sourceKind: assertEnum(
          input.sourceKind,
          PRODUCT_OUTCOME_SOURCE_KINDS,
          "Source kind",
        ),
        sourceRef: cleanOptional(input.sourceRef),
        confidence: input.confidence,
        provenance: input.provenance ?? undefined,
        recordedByPrincipalId,
        supersedesObservationId,
      },
    });
  });
}
