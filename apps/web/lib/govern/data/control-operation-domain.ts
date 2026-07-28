import { createHash } from "node:crypto";

export const DATA_CONTROL_OPERATION_STATUSES = [
  "planned",
  "authorized",
  "executing",
  "reconciled",
  "partially-complete",
  "compensating",
  "failed",
  "compensated",
] as const;

export type DataControlOperationStatus =
  (typeof DATA_CONTROL_OPERATION_STATUSES)[number];

export const DATA_CONTROL_STEP_STATUSES = [
  "pending",
  "executing",
  "applied",
  "verified",
  "failed",
  "compensated",
] as const;

export type DataControlStepStatus = (typeof DATA_CONTROL_STEP_STATUSES)[number];

export interface DataControlTargetEnvelope {
  targetKey: string;
  targetType: string;
  pepKey: string;
  compensable: boolean;
}

export interface DataControlOperationEnvelope {
  organizationId: string;
  actorType: string;
  actorRef: string;
  actorAuthority: unknown;
  actionKey: string;
  purposeOfUse: string;
  inputHash: string;
  assetRefs: readonly string[];
  fieldRefs: readonly string[];
  classificationRefs: readonly string[];
  policyVersions: unknown;
  holdRevisions: unknown;
  approvals: readonly unknown[];
  risk: unknown;
  targets: readonly DataControlTargetEnvelope[];
}

const OPERATION_TRANSITIONS: Readonly<
  Record<DataControlOperationStatus, readonly DataControlOperationStatus[]>
> = {
  planned: ["authorized", "failed"],
  authorized: ["executing", "failed"],
  executing: ["reconciled", "partially-complete", "failed"],
  reconciled: [],
  "partially-complete": ["executing", "compensating", "failed"],
  compensating: ["compensated", "partially-complete", "failed"],
  failed: [],
  compensated: [],
};

const STEP_TRANSITIONS: Readonly<
  Record<DataControlStepStatus, readonly DataControlStepStatus[]>
> = {
  pending: ["executing", "failed"],
  executing: ["applied", "failed"],
  applied: ["verified", "failed", "compensated"],
  verified: ["compensated"],
  failed: ["executing"],
  compensated: [],
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) {
      throw new TypeError("data_control_envelope_contains_non_json_value");
    }
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function sortUnknown(values: readonly unknown[]): unknown[] {
  return [...values].sort((left, right) =>
    canonicalJson(left).localeCompare(canonicalJson(right)),
  );
}

export function canonicalOperationEnvelopeHash(
  envelope: DataControlOperationEnvelope,
): string {
  const normalized = {
    ...envelope,
    assetRefs: [...envelope.assetRefs].sort(),
    fieldRefs: [...envelope.fieldRefs].sort(),
    classificationRefs: [...envelope.classificationRefs].sort(),
    approvals: sortUnknown(envelope.approvals),
    targets: [...envelope.targets].sort((left, right) =>
      left.targetKey.localeCompare(right.targetKey),
    ),
  };
  const encoded = JSON.stringify(normalized);
  if (encoded === undefined) {
    throw new TypeError("data_control_envelope_contains_non_json_value");
  }
  const jsonNormalized = JSON.parse(encoded) as unknown;
  return createHash("sha256")
    .update(canonicalJson(jsonNormalized))
    .digest("hex");
}

export function isOperationTransitionAllowed(
  from: DataControlOperationStatus,
  to: DataControlOperationStatus,
): boolean {
  return OPERATION_TRANSITIONS[from].includes(to);
}

export function isStepTransitionAllowed(
  from: DataControlStepStatus,
  to: DataControlStepStatus,
): boolean {
  return STEP_TRANSITIONS[from].includes(to);
}

export function deriveOperationStatus(
  stepStatuses: readonly DataControlStepStatus[],
): Extract<
  DataControlOperationStatus,
  "executing" | "reconciled" | "partially-complete" | "failed" | "compensated"
> {
  if (stepStatuses.length === 0) return "failed";
  if (stepStatuses.every((status) => status === "verified")) return "reconciled";
  if (stepStatuses.every((status) => status === "compensated")) return "compensated";
  if (stepStatuses.every((status) => status === "failed")) return "failed";
  if (
    stepStatuses.includes("failed") &&
    stepStatuses.some((status) =>
      ["applied", "verified", "compensated"].includes(status),
    )
  ) {
    return "partially-complete";
  }
  return "executing";
}

export function terminalEvidenceAllowed(
  operationStatus: DataControlOperationStatus,
  stepStatuses: readonly DataControlStepStatus[],
): boolean {
  if (operationStatus === "reconciled") {
    return stepStatuses.length > 0 &&
      stepStatuses.every((status) => status === "verified");
  }
  if (operationStatus === "compensated") {
    return stepStatuses.length > 0 &&
      stepStatuses.every((status) => status === "compensated");
  }
  return false;
}
