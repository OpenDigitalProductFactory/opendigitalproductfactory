import type {
  ActivityHarnessConfidenceOverride,
} from "./activity-harness-governance";
import type { HarnessRecipeConfidence } from "./harness-recipe";

export const ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION =
  "activity_harness_confidence_override";

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
