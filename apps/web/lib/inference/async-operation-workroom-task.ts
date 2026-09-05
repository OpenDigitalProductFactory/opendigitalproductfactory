import { createHash } from "node:crypto";

import { DURABLE_INFERENCE_TASK_CONTRACT_FAMILY } from "@/lib/mcp-task-durable-inference-contract";
import type {
  AsyncOperationAuthorityActor,
  AsyncOperationAuthorityRequest,
} from "./async-operation-authority";
import type { AdmitDurableAsyncOperationInput } from "./async-operation-lifecycle";

type WorkroomRequest = Extract<AsyncOperationAuthorityRequest, { kind: "workroom" }>;
type TaskRunRequest = Extract<AsyncOperationAuthorityRequest, { kind: "task-run" }>;

export type AuthorizedWorkroomDurableTask = {
  /** Internal server-owned Workroom row id. */
  id: string;
  /** Public semantic Workroom id. */
  capsuleId: string;
  title: string;
  objective: string;
};

export type WorkroomDurableTaskRunInput = {
  taskRunId: string;
  userId: string;
  agentId: string;
  threadId: string | null;
  routeContext: string;
  requestKey: string;
  requestDigest: string;
  routingRecipeId: string;
  workroom: AuthorizedWorkroomDurableTask;
};

export type WorkroomDurableTaskAdmissionInput = AdmitDurableAsyncOperationInput & {
  request: WorkroomRequest;
  actor: AsyncOperationAuthorityActor;
  now?: Date;
};

export interface WorkroomDurableTaskAdmissionDependencies {
  resolveWorkroom(input: {
    request: WorkroomRequest;
    actor: AsyncOperationAuthorityActor;
  }): Promise<AuthorizedWorkroomDurableTask>;
  createOrReplayTaskRun(input: WorkroomDurableTaskRunInput): Promise<{
    id: string;
    taskRunId: string;
    replayed: boolean;
  }>;
  admitTaskRunOperation(input: AdmitDurableAsyncOperationInput & {
    request: TaskRunRequest;
    actor: AsyncOperationAuthorityActor;
    deferInitialWake: true;
  }): Promise<{ operationId: string; replayed: boolean }>;
  projectTaskRunAdmission(input: {
    taskRunId: string;
    requestKey: string;
    requestDigest: string;
    operationId: string;
    routingRecipeId: string;
    now: Date;
  }): Promise<{ shouldEnqueue: boolean }>;
  enqueue(operationId: string): Promise<void>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(code);
  return value.trim();
}

/**
 * Public TaskRun identity derived only after the Workroom has been authorized
 * to its internal server id. A browser cannot choose or forge this identity.
 */
export function canonicalWorkroomDurableTaskRunId(input: {
  workroomId: string;
  requestKey: string;
  requestDigest: string;
}): string {
  const workroomId = requiredString(
    input.workroomId,
    "DURABLE_INFERENCE_WORKROOM_INTERNAL_ID_REQUIRED",
  );
  const requestKey = requiredString(
    input.requestKey,
    "ASYNC_OPERATION_REQUEST_KEY_INVALID",
  );
  if (!/^[a-f0-9]{64}$/u.test(input.requestDigest)) {
    throw new Error("ASYNC_OPERATION_REQUEST_DIGEST_INVALID");
  }
  const digest = createHash("sha256")
    .update([
      "dpf:workroom-durable-task-run:v1",
      workroomId,
      requestKey,
      input.requestDigest,
    ].join("\u0000"), "utf8")
    .digest("hex")
    .slice(0, 24)
    .toUpperCase();
  return `TR-ASYNC-${digest}`;
}

function contextIdentity(input: WorkroomDurableTaskAdmissionInput): {
  userId: string;
  agentId: string;
  threadId: string | null;
  routeContext: string;
  routingRecipeId: string;
} {
  if (input.contractFamily !== DURABLE_INFERENCE_TASK_CONTRACT_FAMILY) {
    throw new Error("DURABLE_INFERENCE_WORKROOM_CONTRACT_INVALID");
  }
  const userId = requiredString(
    input.actor.userId,
    "DURABLE_INFERENCE_WORKROOM_USER_REQUIRED",
  );
  const context = record(input.screenedRequestContext);
  const attribution = record(context?.["attribution"]);
  const plan = record(context?.["executionPlan"]);
  const attributedUserId = typeof attribution?.["userId"] === "string"
    ? attribution["userId"].trim()
    : "";
  if (attributedUserId && attributedUserId !== userId) {
    throw new Error("DURABLE_INFERENCE_WORKROOM_USER_MISMATCH");
  }
  const agentId = requiredString(
    attribution?.["agentId"] ?? input.actor.agentId,
    "DURABLE_INFERENCE_WORKROOM_AGENT_REQUIRED",
  );
  if (input.actor.agentId && input.actor.agentId.trim() !== agentId) {
    throw new Error("DURABLE_INFERENCE_WORKROOM_AGENT_MISMATCH");
  }
  return {
    userId,
    agentId,
    threadId: typeof attribution?.["threadId"] === "string"
      && attribution["threadId"].trim().length > 0
      ? attribution["threadId"].trim()
      : null,
    routeContext: typeof attribution?.["routeContext"] === "string"
      && attribution["routeContext"].trim().length > 0
      ? attribution["routeContext"].trim()
      : "/build",
    routingRecipeId: requiredString(
      plan?.["recipeId"],
      "DURABLE_INFERENCE_ROUTING_RECIPE_REQUIRED",
    ),
  };
}

/**
 * Bridge the one TaskRun-only durable contract from authorized Workroom intent
 * to the canonical TaskRun lifecycle. The provider wake is the last step.
 */
export async function admitWorkroomBoundDurableTaskOperation(
  input: WorkroomDurableTaskAdmissionInput,
  dependencies: WorkroomDurableTaskAdmissionDependencies,
): Promise<{ operationId: string; taskRunId: string; replayed: boolean }> {
  const identity = contextIdentity(input);
  const workroom = await dependencies.resolveWorkroom({
    request: input.request,
    actor: input.actor,
  });
  const taskRunId = canonicalWorkroomDurableTaskRunId({
    workroomId: workroom.id,
    requestKey: input.request.requestKey,
    requestDigest: input.request.requestDigest,
  });
  const task = await dependencies.createOrReplayTaskRun({
    taskRunId,
    ...identity,
    requestKey: input.request.requestKey,
    requestDigest: input.request.requestDigest,
    workroom,
  });
  if (task.taskRunId !== taskRunId) {
    throw new Error("DURABLE_INFERENCE_WORKROOM_TASKRUN_ID_MISMATCH");
  }

  const admitted = await dependencies.admitTaskRunOperation({
    providerId: input.providerId,
    modelId: input.modelId,
    contractFamily: input.contractFamily,
    screenedRequestDigest: input.screenedRequestDigest,
    screenedRequestContext: input.screenedRequestContext,
    expiresAt: input.expiresAt,
    request: {
      kind: "task-run",
      taskRunId,
      requestKey: input.request.requestKey,
      requestDigest: input.request.requestDigest,
    },
    actor: input.actor,
    deferInitialWake: true,
  });
  const projection = await dependencies.projectTaskRunAdmission({
    taskRunId,
    requestKey: input.request.requestKey,
    requestDigest: input.request.requestDigest,
    operationId: admitted.operationId,
    routingRecipeId: identity.routingRecipeId,
    now: input.now ?? new Date(),
  });
  if (projection.shouldEnqueue) await dependencies.enqueue(admitted.operationId);

  return {
    operationId: admitted.operationId,
    taskRunId,
    replayed: admitted.replayed,
  };
}
