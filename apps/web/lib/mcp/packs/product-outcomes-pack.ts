import { prisma } from "@dpf/db";
import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import {
  PRODUCT_OBJECTIVE_REVIEW_CADENCES,
  PRODUCT_OBJECTIVE_STATUSES,
  PRODUCT_OBJECTIVE_WORK_CONTRIBUTION_KINDS,
  PRODUCT_OUTCOME_MEASURE_KINDS,
  PRODUCT_OUTCOME_SOURCE_KINDS,
  type ProductObjectiveReviewCadence,
  type ProductObjectiveStatus,
  type ProductObjectiveWorkContributionKind,
  type ProductOutcomeMeasureKind,
  type ProductOutcomeSourceKind,
} from "@/lib/product-management/outcomes";
import {
  createProductObjective,
  linkObjectiveWork,
  recordProductOutcomeObservation,
  reviewProductObjective,
  transitionProductObjective,
  updateProductObjective,
  type ProductOutcomesDb,
  type ProductOutcomesTransactionalDb,
} from "@/lib/product-management/outcomes-repository";
import type { ToolPack } from "../tool-pack";
import { queueProductManagementPlaybookRefreshForObjective } from "@/lib/product-management/product-management-playbook-refresh";

const definitions: ToolDefinition[] = [
  {
    name: "create_product_objective",
    description:
      "Define a draft outcome for one real business Product. Captures the problem, hoped-for change, typed measure, baseline/target, owner Principal when known, and next review. Does not create an OKR hierarchy or target a DigitalProduct.",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string", description: "Business Product row id." },
        title: { type: "string" },
        problemStatement: { type: "string" },
        outcomeHypothesis: { type: "string" },
        ownerPrincipalId: {
          type: "string",
          description: "Optional canonical Principal.principalId; never a free-form owner.",
        },
        measureKind: {
          type: "string",
          enum: [...PRODUCT_OUTCOME_MEASURE_KINDS],
        },
        measureDefinition: { type: "string" },
        measureUnit: {
          type: "string",
          description: "Unit or ISO currency code for compatible comparisons.",
        },
        baselineValue: { type: "number" },
        targetValue: { type: "number" },
        baselineNarrative: { type: "string" },
        targetNarrative: { type: "string" },
        reviewCadence: {
          type: "string",
          enum: [...PRODUCT_OBJECTIVE_REVIEW_CADENCES],
        },
        reviewAt: { type: "string", description: "ISO-8601 review date." },
      },
      required: [
        "productId",
        "title",
        "outcomeHypothesis",
        "measureKind",
        "measureDefinition",
      ],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "update_product_objective",
    description:
      "Update an editable draft or active product objective. A measure contract cannot change after observations exist; close the objective and define a new one instead.",
    inputSchema: {
      type: "object",
      properties: {
        objectiveId: { type: "string" },
        title: { type: "string" },
        problemStatement: { type: "string" },
        outcomeHypothesis: { type: "string" },
        ownerPrincipalId: { type: "string" },
        clearOwner: { type: "boolean" },
        measureKind: {
          type: "string",
          enum: [...PRODUCT_OUTCOME_MEASURE_KINDS],
        },
        measureDefinition: { type: "string" },
        measureUnit: { type: "string" },
        baselineValue: { type: "number" },
        targetValue: { type: "number" },
        baselineNarrative: { type: "string" },
        targetNarrative: { type: "string" },
        reviewCadence: {
          type: "string",
          enum: [...PRODUCT_OBJECTIVE_REVIEW_CADENCES],
        },
        reviewAt: { type: "string" },
      },
      required: ["objectiveId"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "review_product_objective",
    description:
      "Record that an active product objective was reviewed and set its next review date. Reviewing does not fabricate an observation or change lifecycle status.",
    inputSchema: {
      type: "object",
      properties: {
        objectiveId: { type: "string" },
        reviewedAt: { type: "string" },
        nextReviewAt: { type: "string" },
      },
      required: ["objectiveId"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "transition_product_objective",
    description:
      "Move a product objective through its governed lifecycle. Legal paths are draft→active|archived, active→closed|archived, and closed→archived.",
    inputSchema: {
      type: "object",
      properties: {
        objectiveId: { type: "string" },
        to: { type: "string", enum: [...PRODUCT_OBJECTIVE_STATUSES] },
      },
      required: ["objectiveId", "to"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "link_product_objective_work",
    description:
      "Link canonical BacklogItem work to a product objective without copying or changing backlog ownership. The item must already be scoped to the same business Product.",
    inputSchema: {
      type: "object",
      properties: {
        objectiveId: { type: "string" },
        backlogItemId: { type: "string", description: "Semantic BI-* id." },
        contributionKind: {
          type: "string",
          enum: [...PRODUCT_OBJECTIVE_WORK_CONTRIBUTION_KINDS],
        },
      },
      required: ["objectiveId", "backlogItemId", "contributionKind"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "record_product_outcome_observation",
    description:
      "Append evidence observed for an active product objective. Quantitative measures require a number; qualitative measures require narrative. This never updates a prior observation.",
    inputSchema: {
      type: "object",
      properties: {
        objectiveId: { type: "string" },
        observedAt: { type: "string" },
        numericValue: { type: "number" },
        narrative: { type: "string" },
        sourceKind: {
          type: "string",
          enum: [...PRODUCT_OUTCOME_SOURCE_KINDS],
        },
        sourceRef: { type: "string" },
        confidence: { type: "number" },
        provenance: { type: "object" },
        recordedByPrincipalId: { type: "string" },
      },
      required: ["objectiveId", "observedAt", "sourceKind"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "correct_product_outcome_observation",
    description:
      "Append a corrected observation that supersedes one current observation while preserving both records and their provenance.",
    inputSchema: {
      type: "object",
      properties: {
        objectiveId: { type: "string" },
        supersedesObservationId: { type: "string" },
        observedAt: { type: "string" },
        numericValue: { type: "number" },
        narrative: { type: "string" },
        sourceKind: {
          type: "string",
          enum: [...PRODUCT_OUTCOME_SOURCE_KINDS],
        },
        sourceRef: { type: "string" },
        confidence: { type: "number" },
        provenance: { type: "object" },
        recordedByPrincipalId: { type: "string" },
      },
      required: [
        "objectiveId",
        "supersedesObservationId",
        "observedAt",
        "sourceKind",
      ],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
];

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dateValue(value: unknown, fallback: Date | null = null): Date | null {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Date values must be valid ISO-8601 timestamps.");
  }
  return date;
}

async function currentOrganizationId(): Promise<string> {
  const organization = await prisma.organization.findFirst({
    select: { id: true },
  });
  if (!organization) throw new Error("No organization is configured.");
  return organization.id;
}

function successful(entityId: string, message: string): ToolResult {
  return { success: true, entityId, message };
}

async function guarded(
  operation: () => Promise<ToolResult>,
): Promise<ToolResult> {
  try {
    return await operation();
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.name
          : "ProductOutcomeError",
      message:
        error instanceof Error
          ? error.message
          : "The product outcome action could not be completed.",
    };
  }
}

async function createHandler(params: Record<string, unknown>) {
  return guarded(async () => {
    const organizationId = await currentOrganizationId();
    const result = await createProductObjective(
      prisma as unknown as ProductOutcomesDb,
      {
        organizationId,
        productId: String(params["productId"] ?? ""),
        title: String(params["title"] ?? ""),
        problemStatement: optionalString(params["problemStatement"]),
        outcomeHypothesis: String(params["outcomeHypothesis"] ?? ""),
        ownerPrincipalId: optionalString(params["ownerPrincipalId"]),
        measureKind: params["measureKind"] as ProductOutcomeMeasureKind,
        measureDefinition: String(params["measureDefinition"] ?? ""),
        measureUnit: optionalString(params["measureUnit"]),
        baselineValue: optionalNumber(params["baselineValue"]),
        targetValue: optionalNumber(params["targetValue"]),
        baselineNarrative: optionalString(params["baselineNarrative"]),
        targetNarrative: optionalString(params["targetNarrative"]),
        reviewCadence: optionalString(
          params["reviewCadence"],
        ) as ProductObjectiveReviewCadence | null,
        reviewAt: dateValue(params["reviewAt"]),
      },
    );
    await queueProductManagementPlaybookRefreshForObjective({
      organizationId,
      objectiveId: result.objectiveId,
      sourceKind: "product-objective",
      sourceId: result.objectiveId,
      changedAt: new Date(),
    });
    return successful(result.objectiveId, "Draft product objective created.");
  });
}

async function updateHandler(params: Record<string, unknown>) {
  return guarded(async () => {
    const organizationId = await currentOrganizationId();
    const ownerIncluded =
      Object.hasOwn(params, "ownerPrincipalId") ||
      params["clearOwner"] === true;
    const result = await updateProductObjective(
      prisma as unknown as ProductOutcomesDb,
      {
        organizationId,
        objectiveId: String(params["objectiveId"] ?? ""),
        ...(Object.hasOwn(params, "title")
          ? { title: String(params["title"] ?? "") }
          : {}),
        ...(Object.hasOwn(params, "problemStatement")
          ? { problemStatement: optionalString(params["problemStatement"]) }
          : {}),
        ...(Object.hasOwn(params, "outcomeHypothesis")
          ? { outcomeHypothesis: String(params["outcomeHypothesis"] ?? "") }
          : {}),
        ...(ownerIncluded
          ? {
              ownerPrincipalId:
                params["clearOwner"] === true
                  ? null
                  : optionalString(params["ownerPrincipalId"]),
            }
          : {}),
        ...(Object.hasOwn(params, "measureKind")
          ? {
              measureKind:
                params["measureKind"] as ProductOutcomeMeasureKind,
            }
          : {}),
        ...(Object.hasOwn(params, "measureDefinition")
          ? { measureDefinition: String(params["measureDefinition"] ?? "") }
          : {}),
        ...(Object.hasOwn(params, "measureUnit")
          ? { measureUnit: optionalString(params["measureUnit"]) }
          : {}),
        ...(Object.hasOwn(params, "baselineValue")
          ? { baselineValue: optionalNumber(params["baselineValue"]) }
          : {}),
        ...(Object.hasOwn(params, "targetValue")
          ? { targetValue: optionalNumber(params["targetValue"]) }
          : {}),
        ...(Object.hasOwn(params, "baselineNarrative")
          ? {
              baselineNarrative: optionalString(params["baselineNarrative"]),
            }
          : {}),
        ...(Object.hasOwn(params, "targetNarrative")
          ? { targetNarrative: optionalString(params["targetNarrative"]) }
          : {}),
        ...(Object.hasOwn(params, "reviewCadence")
          ? {
              reviewCadence: optionalString(
                params["reviewCadence"],
              ) as ProductObjectiveReviewCadence | null,
            }
          : {}),
        ...(Object.hasOwn(params, "reviewAt")
          ? { reviewAt: dateValue(params["reviewAt"]) }
          : {}),
      },
    );
    await queueProductManagementPlaybookRefreshForObjective({
      organizationId,
      objectiveId: result.objectiveId,
      sourceKind: "product-objective",
      sourceId: result.objectiveId,
      changedAt: new Date(),
    });
    return successful(result.objectiveId, "Product objective updated.");
  });
}

async function reviewHandler(params: Record<string, unknown>) {
  return guarded(async () => {
    const organizationId = await currentOrganizationId();
    const reviewedAt = dateValue(params["reviewedAt"], new Date())!;
    const result = await reviewProductObjective(
      prisma as unknown as ProductOutcomesDb,
      {
        organizationId,
        objectiveId: String(params["objectiveId"] ?? ""),
        reviewedAt,
        nextReviewAt: dateValue(params["nextReviewAt"]),
      },
    );
    await queueProductManagementPlaybookRefreshForObjective({
      organizationId,
      objectiveId: result.objectiveId,
      sourceKind: "product-objective",
      sourceId: result.objectiveId,
      changedAt: reviewedAt,
    });
    return successful(result.objectiveId, "Product objective review recorded.");
  });
}

async function transitionHandler(params: Record<string, unknown>) {
  return guarded(async () => {
    const organizationId = await currentOrganizationId();
    const result = await transitionProductObjective(
      prisma as unknown as ProductOutcomesDb,
      {
        organizationId,
        objectiveId: String(params["objectiveId"] ?? ""),
        to: params["to"] as ProductObjectiveStatus,
      },
    );
    await queueProductManagementPlaybookRefreshForObjective({
      organizationId,
      objectiveId: result.objectiveId,
      sourceKind: "product-objective",
      sourceId: result.objectiveId,
      changedAt: new Date(),
    });
    return successful(
      result.objectiveId,
      `Product objective moved to ${result.status}.`,
    );
  });
}

async function linkWorkHandler(params: Record<string, unknown>) {
  return guarded(async () => {
    const organizationId = await currentOrganizationId();
    const objectiveId = String(params["objectiveId"] ?? "");
    await linkObjectiveWork(prisma as unknown as ProductOutcomesDb, {
      organizationId,
      objectiveId,
      backlogItemId: String(params["backlogItemId"] ?? ""),
      contributionKind:
        params["contributionKind"] as ProductObjectiveWorkContributionKind,
    });
    await queueProductManagementPlaybookRefreshForObjective({
      organizationId,
      objectiveId,
      sourceKind: "product-objective",
      sourceId: `${objectiveId}:${String(params["backlogItemId"] ?? "")}`,
      changedAt: new Date(),
    });
    return successful(objectiveId, "Contributing work linked.");
  });
}

async function observationHandler(
  params: Record<string, unknown>,
  correction: boolean,
) {
  return guarded(async () => {
    const organizationId = await currentOrganizationId();
    const result = await recordProductOutcomeObservation(
      prisma as unknown as ProductOutcomesTransactionalDb,
      {
        organizationId,
        objectiveId: String(params["objectiveId"] ?? ""),
        observedAt: dateValue(params["observedAt"]) ?? new Date(),
        numericValue: optionalNumber(params["numericValue"]),
        narrative: optionalString(params["narrative"]),
        sourceKind: params["sourceKind"] as ProductOutcomeSourceKind,
        sourceRef: optionalString(params["sourceRef"]),
        confidence: optionalNumber(params["confidence"]),
        provenance:
          params["provenance"] &&
          typeof params["provenance"] === "object" &&
          !Array.isArray(params["provenance"])
            ? (params["provenance"] as Record<string, unknown>)
            : null,
        recordedByPrincipalId: optionalString(
          params["recordedByPrincipalId"],
        ),
        supersedesObservationId: correction
          ? optionalString(params["supersedesObservationId"])
          : null,
      },
    );
    await queueProductManagementPlaybookRefreshForObjective({
      organizationId,
      objectiveId: String(params["objectiveId"] ?? ""),
      sourceKind: "product-objective-observation",
      sourceId: String(result["observationId"] ?? ""),
      changedAt: new Date(),
    });
    return successful(
      String(result["observationId"] ?? ""),
      correction ? "Corrected observation appended." : "Observation appended.",
    );
  });
}

export const productOutcomesPack: ToolPack = {
  packId: "product-outcomes",
  definitions,
  handlers: {
    create_product_objective: (params) => createHandler(params),
    update_product_objective: (params) => updateHandler(params),
    review_product_objective: (params) => reviewHandler(params),
    transition_product_objective: (params) => transitionHandler(params),
    link_product_objective_work: (params) => linkWorkHandler(params),
    record_product_outcome_observation: (params) =>
      observationHandler(params, false),
    correct_product_outcome_observation: (params) =>
      observationHandler(params, true),
  },
  grants: {
    create_product_objective: ["backlog_write"],
    update_product_objective: ["backlog_write"],
    review_product_objective: ["backlog_write"],
    transition_product_objective: ["backlog_write"],
    link_product_objective_work: ["backlog_write"],
    record_product_outcome_observation: ["backlog_write"],
    correct_product_outcome_observation: ["backlog_write"],
  },
};
