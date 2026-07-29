"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@dpf/db";
import {
  requireCurrentProductManagementOrganization,
  ProductManagementAccessError,
  ProductManagementOrganizationNotFoundError,
} from "@/lib/product-management/current-product-operating-context.server";
import {
  ProductOutcomeConflictError,
  ProductOutcomeNotFoundError,
  ProductOutcomeValidationError,
  createProductObjective,
  recordProductOutcomeObservation,
  reviewProductObjective,
  transitionProductObjective,
  type ProductOutcomesDb,
  type ProductOutcomesTransactionalDb,
} from "@/lib/product-management/outcomes-repository";
import type {
  ProductObjectiveReviewCadence,
  ProductObjectiveStatus,
  ProductOutcomeMeasureKind,
  ProductOutcomeSourceKind,
} from "@/lib/product-management/outcomes";
import { queueProductManagementPlaybookRefreshForProduct } from "@/lib/product-management/product-management-playbook-refresh";

export type ProductOutcomeActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export type CreateProductObjectiveActionInput = {
  productId: string;
  title: string;
  problemStatement: string;
  outcomeHypothesis: string;
  measureKind: ProductOutcomeMeasureKind;
  measureDefinition: string;
  measureUnit: string;
  baselineValue: number | null;
  targetValue: number | null;
  baselineNarrative: string;
  targetNarrative: string;
  reviewCadence: ProductObjectiveReviewCadence;
  reviewAt: string;
};

export type RecordProductObservationActionInput = {
  productId: string;
  objectiveId: string;
  observedAt: string;
  numericValue: number | null;
  narrative: string;
  sourceKind: ProductOutcomeSourceKind;
  sourceRef: string;
  confidence: number | null;
  supersedesObservationId?: string | null;
};

function pathFor(productId: string): string {
  return `/portfolio/product/${encodeURIComponent(productId)}/direction/outcomes`;
}

function dateValue(value: string, label: string): Date {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) {
    throw new ProductOutcomeValidationError(`${label} is required.`);
  }
  return parsed;
}

function actionError(error: unknown): ProductOutcomeActionResult {
  if (
    error instanceof ProductOutcomeNotFoundError ||
    error instanceof ProductManagementAccessError ||
    error instanceof ProductManagementOrganizationNotFoundError
  ) {
    return { ok: false, error: "This product outcome is not available." };
  }
  if (
    error instanceof ProductOutcomeConflictError ||
    error instanceof ProductOutcomeValidationError
  ) {
    return { ok: false, error: error.message };
  }
  return {
    ok: false,
    error:
      error instanceof Error
        ? error.message
        : "The product outcome action could not be completed.",
  };
}

export async function createProductObjectiveAction(
  input: CreateProductObjectiveActionInput,
): Promise<ProductOutcomeActionResult> {
  try {
    const organization =
      await requireCurrentProductManagementOrganization();
    const objective = await createProductObjective(prisma as unknown as ProductOutcomesDb, {
      organizationId: organization.id,
      productId: input.productId,
      title: input.title,
      problemStatement: input.problemStatement,
      outcomeHypothesis: input.outcomeHypothesis,
      ownerPrincipalId: null,
      measureKind: input.measureKind,
      measureDefinition: input.measureDefinition,
      measureUnit: input.measureUnit,
      baselineValue: input.baselineValue,
      targetValue: input.targetValue,
      baselineNarrative: input.baselineNarrative,
      targetNarrative: input.targetNarrative,
      reviewCadence: input.reviewCadence,
      reviewAt: dateValue(input.reviewAt, "Review date"),
    });
    await queueProductManagementPlaybookRefreshForProduct({
      organizationId: organization.id,
      businessProductId: input.productId,
      sourceKind: "product-objective",
      sourceId: objective.objectiveId,
      changedAt: new Date(),
    });
    revalidatePath(pathFor(input.productId));
    revalidatePath(`/portfolio/product/${encodeURIComponent(input.productId)}/direction`);
    return {
      ok: true,
      message:
        "Outcome defined as a draft. Review it, then start learning when it is ready.",
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function reviewProductObjectiveAction(input: {
  productId: string;
  objectiveId: string;
  nextReviewAt: string;
}): Promise<ProductOutcomeActionResult> {
  try {
    const organization =
      await requireCurrentProductManagementOrganization();
    const objective = await reviewProductObjective(prisma as unknown as ProductOutcomesDb, {
      organizationId: organization.id,
      objectiveId: input.objectiveId,
      reviewedAt: new Date(),
      nextReviewAt: dateValue(input.nextReviewAt, "Next review date"),
    });
    await queueProductManagementPlaybookRefreshForProduct({
      organizationId: organization.id,
      businessProductId: input.productId,
      sourceKind: "product-objective",
      sourceId: objective.objectiveId,
      changedAt: new Date(),
    });
    revalidatePath(pathFor(input.productId));
    return { ok: true, message: "Review recorded." };
  } catch (error) {
    return actionError(error);
  }
}

export async function transitionProductObjectiveAction(input: {
  productId: string;
  objectiveId: string;
  to: ProductObjectiveStatus;
}): Promise<ProductOutcomeActionResult> {
  try {
    const organization =
      await requireCurrentProductManagementOrganization();
    const objective = await transitionProductObjective(prisma as unknown as ProductOutcomesDb, {
      organizationId: organization.id,
      objectiveId: input.objectiveId,
      to: input.to,
    });
    await queueProductManagementPlaybookRefreshForProduct({
      organizationId: organization.id,
      businessProductId: input.productId,
      sourceKind: "product-objective",
      sourceId: objective.objectiveId,
      changedAt: new Date(),
    });
    revalidatePath(pathFor(input.productId));
    revalidatePath(`/portfolio/product/${encodeURIComponent(input.productId)}/direction`);
    return {
      ok: true,
      message:
        input.to === "active"
          ? "Learning started."
          : input.to === "closed"
            ? "Outcome closed with its evidence preserved."
            : "Outcome archived with its evidence preserved.",
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function recordProductOutcomeObservationAction(
  input: RecordProductObservationActionInput,
): Promise<ProductOutcomeActionResult> {
  try {
    const organization =
      await requireCurrentProductManagementOrganization();
    const observation = await recordProductOutcomeObservation(
      prisma as unknown as ProductOutcomesTransactionalDb,
      {
        organizationId: organization.id,
        objectiveId: input.objectiveId,
        observedAt: dateValue(input.observedAt, "Observation date"),
        numericValue: input.numericValue,
        narrative: input.narrative,
        sourceKind: input.sourceKind,
        sourceRef: input.sourceRef,
        confidence: input.confidence,
        provenance: {
          channel: "product-outcomes-page",
          correction: Boolean(input.supersedesObservationId),
        },
        recordedByPrincipalId: null,
        supersedesObservationId: input.supersedesObservationId ?? null,
      },
    );
    await queueProductManagementPlaybookRefreshForProduct({
      organizationId: organization.id,
      businessProductId: input.productId,
      sourceKind: "product-objective-observation",
      sourceId: String(observation["observationId"] ?? input.objectiveId),
      changedAt: new Date(),
    });
    revalidatePath(pathFor(input.productId));
    revalidatePath(`/portfolio/product/${encodeURIComponent(input.productId)}/direction`);
    return {
      ok: true,
      message: input.supersedesObservationId
        ? "Correction appended. The prior observation remains in history."
        : "Observation appended.",
    };
  } catch (error) {
    return actionError(error);
  }
}
