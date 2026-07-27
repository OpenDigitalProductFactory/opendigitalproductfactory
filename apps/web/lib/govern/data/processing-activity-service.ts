import type { DataCategory, ProcessingPurposeKey } from "./taxonomy";

export const PROCESSING_ACTIVITY_STATUSES = [
  "draft",
  "review",
  "confirmed",
  "suspended",
  "retired",
] as const;
export type ProcessingActivityStatus = (typeof PROCESSING_ACTIVITY_STATUSES)[number];

export type ProcessingActivityRecord = {
  activityId: string;
  purposeKey: ProcessingPurposeKey;
  ownerRef: string | null;
  status: ProcessingActivityStatus;
  assetIds: readonly string[];
  fieldIds: readonly string[];
  dataCategories: readonly DataCategory[];
  subjectTypes: readonly string[];
  authorityRefs: readonly string[];
  recipientRefs: readonly string[];
  destinationClasses: readonly string[];
  residencyConstraints: readonly string[];
  transferConstraints: readonly string[];
  lifecycleClassIds: readonly string[];
  executablePolicyIds: readonly string[];
  highRisk: boolean;
  dpiaRequired: boolean;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
  reviewAt: Date | null;
  confirmedAt: Date | null;
  confirmedByRef: string | null;
};

export type ProcessingAuthorityResult = {
  posture: "confirmed" | "review" | "inactive" | "expired" | "invalid";
  explanationCode:
    | "processing-activity-confirmed"
    | "processing-activity-no-match"
    | "processing-activity-not-confirmed"
    | "processing-activity-incomplete"
    | "processing-activity-expired";
  activityIds: string[];
  executablePolicyIds: string[];
};

type ResolveProcessingAuthorityInput = {
  activities: readonly ProcessingActivityRecord[];
  purposeKey: ProcessingPurposeKey;
  assetId?: string;
  fieldIds?: readonly string[];
  dataCategories?: readonly DataCategory[];
  subjectType?: string;
  at?: Date;
};

function intersects(left: readonly string[], right: readonly string[]): boolean {
  return left.some((value) => right.includes(value));
}

function matchesScope(
  activity: ProcessingActivityRecord,
  input: ResolveProcessingAuthorityInput,
): boolean {
  if (activity.purposeKey !== input.purposeKey) return false;
  if (input.assetId && !activity.assetIds.includes(input.assetId)) return false;
  if (input.fieldIds?.length && !intersects(activity.fieldIds, input.fieldIds)) return false;
  if (
    input.dataCategories?.length &&
    !intersects(activity.dataCategories, input.dataCategories)
  ) {
    return false;
  }
  if (input.subjectType && !activity.subjectTypes.includes(input.subjectType)) return false;
  return true;
}

function isComplete(activity: ProcessingActivityRecord): boolean {
  const hasScope =
    activity.assetIds.length > 0 ||
    activity.fieldIds.length > 0 ||
    activity.dataCategories.length > 0 ||
    activity.subjectTypes.length > 0;
  return Boolean(
    activity.activityId &&
      activity.ownerRef &&
      activity.confirmedAt &&
      activity.confirmedByRef &&
      hasScope &&
      activity.authorityRefs.length > 0 &&
      activity.lifecycleClassIds.length > 0,
  );
}

export function resolveProcessingActivityAuthority(
  input: ResolveProcessingAuthorityInput,
): ProcessingAuthorityResult {
  const at = input.at ?? new Date();
  const candidates = input.activities.filter((activity) => matchesScope(activity, input));
  if (candidates.length === 0) {
    return {
      posture: "review",
      explanationCode: "processing-activity-no-match",
      activityIds: [],
      executablePolicyIds: [],
    };
  }

  const confirmed = candidates.filter((activity) => activity.status === "confirmed");
  if (confirmed.length === 0) {
    return {
      posture: "inactive",
      explanationCode: "processing-activity-not-confirmed",
      activityIds: candidates.map((activity) => activity.activityId).sort(),
      executablePolicyIds: [],
    };
  }

  const complete = confirmed.filter(isComplete);
  if (complete.length === 0) {
    return {
      posture: "invalid",
      explanationCode: "processing-activity-incomplete",
      activityIds: confirmed.map((activity) => activity.activityId).sort(),
      executablePolicyIds: [],
    };
  }

  const effective = complete.filter(
    (activity) =>
      (!activity.effectiveFrom || activity.effectiveFrom <= at) &&
      (!activity.effectiveUntil || activity.effectiveUntil > at),
  );
  if (effective.length === 0) {
    return {
      posture: "expired",
      explanationCode: "processing-activity-expired",
      activityIds: complete.map((activity) => activity.activityId).sort(),
      executablePolicyIds: [],
    };
  }

  return {
    posture: "confirmed",
    explanationCode: "processing-activity-confirmed",
    activityIds: effective.map((activity) => activity.activityId).sort(),
    executablePolicyIds: [
      ...new Set(effective.flatMap((activity) => activity.executablePolicyIds)),
    ].sort(),
  };
}

export type DataPolicyExceptionCandidate = {
  status: string;
  scope: Record<string, unknown>;
  approverRef: string | null;
  approvedAt: Date | null;
  rationale: string | null;
  compensatingControl: string | null;
  expiresAt: Date | null;
  remediationItemId: string | null;
};

export function validateDataPolicyException(
  candidate: DataPolicyExceptionCandidate,
  at = new Date(),
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (Object.keys(candidate.scope).length === 0) errors.push("scope-required");
  if (!candidate.approverRef?.trim()) errors.push("approver-required");
  if (!candidate.approvedAt) errors.push("approval-time-required");
  if (!candidate.rationale?.trim()) errors.push("rationale-required");
  if (!candidate.compensatingControl?.trim()) errors.push("compensating-control-required");
  if (!candidate.expiresAt) errors.push("expiry-required");
  if (!candidate.remediationItemId?.trim()) errors.push("remediation-item-required");
  if (candidate.expiresAt && candidate.expiresAt <= at) errors.push("expiry-must-be-future");
  return { valid: errors.length === 0, errors };
}
