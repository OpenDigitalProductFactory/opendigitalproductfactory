import { createHash } from "node:crypto";

import { canonicalJson } from "@/lib/shared/canonical-json";

export const ASYNC_INFERENCE_OPERATION_STATUSES = [
  "pending",
  "start_indeterminate",
  "running",
  "completed",
  "failed",
  "cancelled",
  "expired",
] as const;

export type AsyncInferenceOperationStatus =
  (typeof ASYNC_INFERENCE_OPERATION_STATUSES)[number];

export const ASYNC_INFERENCE_TERMINAL_STATUSES = [
  "completed",
  "failed",
  "cancelled",
  "expired",
] as const satisfies readonly AsyncInferenceOperationStatus[];

export type AsyncOperationBinding =
  | {
      kind: "task-run";
      taskRunId: string;
      requestKey: string;
      requestDigest: string;
    }
  | {
      kind: "workroom";
      workroomId: string;
      requestKey: string;
      requestDigest: string;
    };

const statusSet = new Set<string>(ASYNC_INFERENCE_OPERATION_STATUSES);
const terminalStatusSet = new Set<string>(ASYNC_INFERENCE_TERMINAL_STATUSES);

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`Invalid async operation ${name}`);
  }
}

export function parseAsyncInferenceOperationStatus(
  value: unknown,
): AsyncInferenceOperationStatus {
  if (typeof value !== "string" || !statusSet.has(value)) {
    throw new Error(`Invalid async inference operation status: ${String(value)}`);
  }
  return value as AsyncInferenceOperationStatus;
}

export function isAsyncInferenceOperationTerminal(
  value: AsyncInferenceOperationStatus,
): boolean {
  return terminalStatusSet.has(value);
}

export function canonicalAsyncOperationBindingDigest(
  binding: AsyncOperationBinding,
): string {
  assertNonEmpty(binding.requestKey, "request key");
  if (!/^[a-f0-9]{64}$/u.test(binding.requestDigest)) {
    throw new Error("Invalid async operation request digest");
  }

  const authorityId = binding.kind === "task-run"
    ? binding.taskRunId
    : binding.workroomId;
  assertNonEmpty(authorityId, `${binding.kind} authority`);

  const material = [
    "dpf:async-operation-binding:v1",
    binding.kind,
    authorityId,
    binding.requestKey,
    binding.requestDigest,
  ].join("\u0000");
  return createHash("sha256").update(material, "utf8").digest("hex");
}

const legalTargets: Readonly<Record<AsyncInferenceOperationStatus, ReadonlySet<AsyncInferenceOperationStatus>>> = {
  pending: new Set(["pending", "running", "start_indeterminate", "failed", "cancelled", "expired"]),
  start_indeterminate: new Set(["start_indeterminate", "running", "failed", "cancelled", "expired"]),
  running: new Set(["running", "completed", "failed", "cancelled", "expired"]),
  completed: new Set(["completed"]),
  failed: new Set(["failed"]),
  cancelled: new Set(["cancelled"]),
  expired: new Set(["expired"]),
};

export function assertAsyncOperationTransition(
  fromValue: unknown,
  toValue: unknown,
): {
  from: AsyncInferenceOperationStatus;
  to: AsyncInferenceOperationStatus;
} {
  const from = parseAsyncInferenceOperationStatus(fromValue);
  const to = parseAsyncInferenceOperationStatus(toValue);
  if (!legalTargets[from].has(to)) {
    throw new Error(`Illegal async inference operation transition: ${from} -> ${to}`);
  }
  return { from, to };
}

export function canonicalAsyncOperationRequestDigest(input: {
  providerId: string;
  modelId: string;
  contractFamily: string;
  screenedRequestDigest: string;
  screenedRequestContext: Record<string, unknown>;
  binding: AsyncOperationBinding;
}): string {
  assertNonEmpty(input.providerId, "provider");
  assertNonEmpty(input.modelId, "model");
  assertNonEmpty(input.contractFamily, "contract family");
  if (!/^[a-f0-9]{64}$/u.test(input.screenedRequestDigest)) {
    throw new Error("Invalid screened async request digest");
  }
  return createHash("sha256")
    .update([
      "dpf:async-operation-request:v1",
      input.providerId,
      input.modelId,
      input.contractFamily,
      input.screenedRequestDigest,
      createHash("sha256")
        .update(canonicalJson(input.screenedRequestContext), "utf8")
        .digest("hex"),
      canonicalAsyncOperationBindingDigest(input.binding),
    ].join("\u0000"), "utf8")
    .digest("hex");
}
