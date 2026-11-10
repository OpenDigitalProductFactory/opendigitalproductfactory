import type {
  ActivityHarnessConfidenceOverride,
} from "./activity-harness-governance";
import type { HarnessRecipeConfidence } from "./harness-recipe";

export const ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION =
  "activity_harness_confidence_override";

/**
 * BI-C8EC05C9 (spec D2 S3): the durable configuration fact an operator's
 * confirmed override is stored as (UserFact, superseded on change). Nothing
 * writes one before PR-B, so readers see exactly the legacy proposals.
 */
export const ACTIVITY_ROUTING_OVERRIDE_FACT_CATEGORY = "activity-routing-override";

const APPROVED_PROPOSAL_STATUSES = new Set(["approve", "approved", "executed"]);
const VALID_CONFIDENCE = new Set<HarnessRecipeConfidence>([
  "provisional",
  "calibrating",
  "trusted",
  "degraded",
]);

export type ActivityHarnessApprovalProposalRow = {
  proposalId: string;
  actionType: string;
  parameters: unknown;
  status: string;
  decidedById?: string | null;
  decidedAt?: Date | string | null;
};

export type ActivityHarnessProposalParametersInput = {
  proposalId: string;
  activityClass: string;
  harnessRecipeKey: string;
  providerId: string;
  modelId: string | null;
  confidence: HarnessRecipeConfidence;
};

export type ActivityHarnessApprovalProposalCommand = {
  proposalId: string;
  actionType: typeof ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION;
  messageContent: string;
  parameters: Record<string, unknown>;
};

export type BuildActivityHarnessApprovalProposalCommandInput =
  ActivityHarnessProposalParametersInput & {
    summary: string;
  };

export function buildActivityHarnessApprovalProposalCommand(
  input: BuildActivityHarnessApprovalProposalCommandInput,
): ActivityHarnessApprovalProposalCommand {
  return {
    proposalId: input.proposalId,
    actionType: ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION,
    messageContent: `Approve activity routing change: ${input.summary}`,
    parameters: activityHarnessProposalParameters(input),
  };
}

export function activityHarnessProposalParameters(
  input: ActivityHarnessProposalParametersInput,
): Record<string, unknown> {
  return {
    kind: "activity-harness-confidence-override",
    proposalId: input.proposalId,
    activityClass: input.activityClass,
    harnessRecipeKey: input.harnessRecipeKey,
    providerId: input.providerId,
    modelId: input.modelId,
    confidence: input.confidence,
  };
}

export function activityHarnessOverridesFromProposalRows(
  rows: ActivityHarnessApprovalProposalRow[],
): ActivityHarnessConfidenceOverride[] {
  return rows.flatMap((row) => {
    const override = overrideFromProposalRow(row);
    return override ? [override] : [];
  });
}

type OverrideReadDb = {
  agentActionProposal: { findMany(args: unknown): Promise<ActivityHarnessApprovalProposalRow[]> };
  userFact: { findMany(args: unknown): Promise<Array<{ userId: string; key: string; value: string; createdAt: Date }>> };
};

/**
 * Every live activity-routing override: current configuration facts, then
 * legacy approved proposals, so an override approved before the change keeps
 * applying (spec D8 dual read). With no fact, the result is exactly the
 * legacy read. The db is injected so this module stays importable anywhere.
 */
export async function loadApprovedActivityHarnessOverrides(
  db: OverrideReadDb,
  options: { take: number },
): Promise<ActivityHarnessConfidenceOverride[]> {
  const [rows, facts] = await Promise.all([
    db.agentActionProposal.findMany({
      where: {
        actionType: ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION,
        status: { in: [...APPROVED_PROPOSAL_STATUSES] },
      },
      orderBy: { decidedAt: "desc" },
      take: options.take,
      select: { proposalId: true, actionType: true, parameters: true, status: true, decidedById: true, decidedAt: true },
    }),
    db.userFact.findMany({
      where: { category: ACTIVITY_ROUTING_OVERRIDE_FACT_CATEGORY, supersededAt: null },
      orderBy: { createdAt: "desc" },
      take: options.take,
      select: { userId: true, key: true, value: true, createdAt: true },
    }),
  ]);
  const legacy = activityHarnessOverridesFromProposalRows(rows);
  const current = facts.flatMap((fact) => {
    const override = overrideFromFact(fact);
    return override ? [override] : [];
  });
  return current.length === 0 ? legacy : [...current, ...legacy];
}

function overrideFromFact(fact: { userId: string; key: string; value: string; createdAt: Date }): ActivityHarnessConfidenceOverride | null {
  let value: Record<string, unknown> | null;
  try {
    value = asRecord(JSON.parse(fact.value));
  } catch {
    return null;
  }
  if (!value) return null;
  const activityClass = readString(value.activityClass);
  const harnessRecipeKey = readString(value.harnessRecipeKey);
  const providerId = readString(value.providerId);
  const modelId = readNullableString(value.modelId);
  const confidence = readConfidence(value.confidence);
  if (!activityClass || !harnessRecipeKey || !providerId || !confidence) return null;
  return {
    calibrationKey: [activityClass, harnessRecipeKey, providerId, modelId ?? "unknown-model"].join("|"),
    proposalId: readString(value.proposalId) ?? fact.key,
    activityClass,
    harnessRecipeKey,
    providerId,
    modelId,
    confidence,
    approvedBy: fact.userId,
    approvedAt: readString(value.approvedAt) ?? dateToIso(fact.createdAt),
  };
}

function overrideFromProposalRow(
  row: ActivityHarnessApprovalProposalRow,
): ActivityHarnessConfidenceOverride | null {
  if (row.actionType !== ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION) return null;
  if (!APPROVED_PROPOSAL_STATUSES.has(row.status)) return null;
  if (!row.decidedById || !row.decidedAt) return null;

  const parameters = asRecord(row.parameters);
  if (!parameters) return null;

  const proposalId = readString(parameters.proposalId);
  const activityClass = readString(parameters.activityClass);
  const harnessRecipeKey = readString(parameters.harnessRecipeKey);
  const providerId = readString(parameters.providerId);
  const modelId = readNullableString(parameters.modelId);
  const confidence = readConfidence(parameters.confidence);
  if (!proposalId || !activityClass || !harnessRecipeKey || !providerId || !confidence) {
    return null;
  }

  return {
    calibrationKey: [
      activityClass,
      harnessRecipeKey,
      providerId,
      modelId ?? "unknown-model",
    ].join("|"),
    proposalId,
    activityClass,
    harnessRecipeKey,
    providerId,
    modelId,
    confidence,
    approvedBy: row.decidedById,
    approvedAt: dateToIso(row.decidedAt),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return readString(value);
}

function readConfidence(value: unknown): HarnessRecipeConfidence | null {
  return typeof value === "string" && VALID_CONFIDENCE.has(value as HarnessRecipeConfidence)
    ? value as HarnessRecipeConfidence
    : null;
}

function dateToIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
