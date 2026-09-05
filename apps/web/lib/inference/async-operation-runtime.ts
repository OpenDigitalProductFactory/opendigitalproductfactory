import { prisma } from "@dpf/db";

import { callProvider } from "./ai-inference";
import {
  pollAsyncProviderOperation,
  type AsyncProviderOperationPollResult,
} from "./async-inference";
import {
  resolveServerOwnedAsyncOperationBinding,
  type AsyncOperationAuthorityActor,
  type AsyncOperationAuthorityDatabase,
  type AsyncOperationAuthorityRequest,
  type AsyncOperationAuthorityTarget,
} from "./async-operation-authority";
import {
  admitDurableAsyncOperation,
  type AdmitDurableAsyncOperationInput,
} from "./async-operation-lifecycle";
import {
  createDurableAsyncProviderDependencies,
  type DurableAsyncProviderIo,
} from "./async-operation-provider";
import {
  reconcileAsyncOperationWakes,
  runAsyncOperationWake,
  type AsyncOperationWake,
} from "./async-operation-queue";
import { publishAsyncOperationTransitions } from "./async-operation-outbox";
import {
  listAuthorizedAsyncOperations,
  readAuthorizedAsyncOperation,
  requestAuthorizedAsyncOperationCancellation,
} from "./async-operation-read-model";
import {
  PrismaAsyncOperationStore,
  type AsyncOperationDatabase,
} from "./async-operation-store";
import {
  AsyncProviderPollError,
  runDurableAsyncOperationWorker,
  type AsyncProviderPollResult,
} from "./async-operation-worker";
import {
  enqueueAsyncOperationWake,
  publishAsyncOperationTransitionEvent,
} from "@/lib/execution/adapters/async-operation-events";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { DURABLE_INFERENCE_TASK_CONTRACT_FAMILY } from "@/lib/mcp-task-durable-inference-contract";
import { assertDurableDispatchScreen } from "./durable-dispatch-screen";
import { getLocalOnlyInferenceFresh } from "./local-only";
import { admitPrismaWorkroomBoundDurableTaskOperation } from "./async-operation-workroom-runtime";

function createStore(): PrismaAsyncOperationStore {
  return new PrismaAsyncOperationStore(prisma as unknown as AsyncOperationDatabase);
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function durableMcpTaskWakeDisposition(input: {
  operationId: string;
  progressPayload: unknown;
}): "ready" | "cancel" | "wait" {
  const durable = jsonObject(jsonObject(input.progressPayload)?.["durableInference"]);
  if (typeof durable?.["cancellationRequestedAt"] === "string") return "cancel";
  if (durable?.["state"] !== "admitted") return "wait";
  if (durable["asyncOperationId"] !== input.operationId) {
    throw new Error("DURABLE_INFERENCE_OPERATION_ID_MISMATCH");
  }
  return "ready";
}

function pollFailureIsRetryable(error: unknown): boolean {
  const message = getErrorMessage(error);
  return !(
    /HTTP (?:400|401|403|404|409|410|422)\b/.test(message)
    || /identity mismatch|unexpected .* object|missing-status|requires_action/i.test(message)
  );
}

/** Convert the provider polling boundary into the worker's closed outcome set. */
export function normalizeDurableAsyncProviderPoll(
  result: AsyncProviderOperationPollResult,
): AsyncProviderPollResult {
  if (result.done) {
    if (result.terminalStatus === "cancelled") {
      return { kind: "cancelled", reason: "Provider cancelled" };
    }
    if (result.terminalStatus === "failed") {
      return { kind: "failed", error: "ASYNC_PROVIDER_REPORTED_FAILURE" };
    }
    return {
      kind: "completed",
      text: result.text,
      ...(result.raw ? { data: result.raw } : {}),
    };
  }
  return {
    kind: "running",
    ...(result.progressPct === undefined ? {} : { progressPct: result.progressPct }),
    progressMessage: "Provider operation in progress",
  };
}

const productionProviderIo: DurableAsyncProviderIo = {
  async authorizeDispatch({ providerId, context }) {
    assertDurableDispatchScreen({
      evidence: context.dispatchScreen,
      messages: context.messages,
      systemPrompt: context.systemPrompt,
      tools: context.tools,
      providerId,
      localOnlyInference: await getLocalOnlyInferenceFresh(),
    });
  },
  dispatch: ({ providerId, modelId, context }) => callProvider(
    providerId,
    modelId,
    context.messages,
    context.systemPrompt,
    context.tools,
    context.executionPlan,
    context.previousResponseId,
    undefined,
    context.attribution,
  ),

  async poll({ providerId, providerOperationId }): Promise<AsyncProviderPollResult> {
    try {
      const result = await pollAsyncProviderOperation(providerId, providerOperationId);
      return normalizeDurableAsyncProviderPoll(result);
    } catch (error) {
      const retryable = pollFailureIsRetryable(error);
      throw new AsyncProviderPollError(
        retryable
          ? "ASYNC_PROVIDER_POLL_TRANSIENT_FAILURE"
          : "ASYNC_PROVIDER_POLL_PERMANENT_FAILURE",
        retryable,
      );
    }
  },

  // The first supported Interactions API has no exact lookup by DPF request
  // digest. A crossed start therefore stays indeterminate until cancelled or
  // expired; guessing or repeating POST would violate at-most-once start.
  reconcile: async () => ({ kind: "unresolved" }),
};

async function enqueueWake(wake: AsyncOperationWake): Promise<void> {
  await enqueueAsyncOperationWake(wake);
}

type DurableAsyncOperationAuthority = {
  request: AsyncOperationAuthorityRequest;
  actor: AsyncOperationAuthorityActor;
  deferInitialWake?: boolean;
};

function authorityDatabase(): AsyncOperationAuthorityDatabase {
  return prisma as unknown as AsyncOperationAuthorityDatabase;
}

async function admitPrismaDurableAsyncOperationDirect(
  input: AdmitDurableAsyncOperationInput & DurableAsyncOperationAuthority,
): Promise<{ operationId: string; replayed: boolean }> {
  const store = createStore();
  return admitDurableAsyncOperation(input, {
    resolveBinding: () => resolveServerOwnedAsyncOperationBinding({
      request: input.request,
      actor: input.actor,
      db: authorityDatabase(),
    }),
    store,
    enqueue: input.deferInitialWake
      ? async () => undefined
      : (operationId) => enqueueWake({ operationId, notBefore: new Date() }),
  });
}

/**
 * Persist the exact TaskRun/Workroom-bound identity before advisory dispatch.
 * This is the only production admission boundary for identity-version 1 rows.
 */
export async function admitPrismaDurableAsyncOperation(
  input: AdmitDurableAsyncOperationInput & DurableAsyncOperationAuthority,
): Promise<{ operationId: string; replayed: boolean; taskRunId?: string }> {
  if (
    input.contractFamily === DURABLE_INFERENCE_TASK_CONTRACT_FAMILY
    && input.request.kind === "workroom"
  ) {
    return admitPrismaWorkroomBoundDurableTaskOperation({
      ...input,
      request: input.request,
    }, {
      admitTaskRunOperation: admitPrismaDurableAsyncOperationDirect,
      enqueue: enqueuePrismaAsyncOperationWake,
    });
  }
  return admitPrismaDurableAsyncOperationDirect(input);
}

/** Enqueue a previously admitted operation after its owning TaskRun projection is durable. */
export async function enqueuePrismaAsyncOperationWake(operationId: string): Promise<void> {
  await enqueueWake({ operationId, notBefore: new Date() });
}

/** List durable handles for one authorized semantic TaskRun/Workroom scope. */
export async function listPrismaAuthorizedAsyncOperations(input: {
  target: AsyncOperationAuthorityTarget;
  actor: AsyncOperationAuthorityActor;
  after?: { createdAt: string; operationId: string };
  limit?: number;
}) {
  return listAuthorizedAsyncOperations(input, {
    db: authorityDatabase(),
    store: createStore(),
  });
}

/** Reconcile progress through semantic authority and request key, never a bare op id. */
export async function readPrismaAuthorizedAsyncOperation(input: {
  target: AsyncOperationAuthorityTarget;
  actor: AsyncOperationAuthorityActor;
  requestKey: string;
  afterSequence?: number;
  limit?: number;
}) {
  return readAuthorizedAsyncOperation(input, {
    db: authorityDatabase(),
    store: createStore(),
  });
}

/** Request cancellation through the same server-owned TaskRun/Workroom scope. */
export async function requestPrismaAuthorizedAsyncOperationCancellation(input: {
  target: AsyncOperationAuthorityTarget;
  actor: AsyncOperationAuthorityActor;
  requestKey: string;
  now?: Date;
}) {
  return requestAuthorizedAsyncOperationCancellation({
    target: input.target,
    actor: input.actor,
    requestKey: input.requestKey,
    now: input.now ?? new Date(),
  }, {
    db: authorityDatabase(),
    store: createStore(),
  });
}

export async function runPrismaAsyncOperationWake(input: {
  operationId: string;
  workerId: string;
}) {
  const store = createStore();
  const operation = await store.loadForWorker(input.operationId);
  if (operation?.contractFamily === DURABLE_INFERENCE_TASK_CONTRACT_FAMILY) {
    if (!operation.taskRunId) throw new Error("DURABLE_INFERENCE_TASKRUN_BINDING_MISSING");
    const taskRun = await prisma.taskRun.findUnique({
      where: { id: operation.taskRunId },
      select: { progressPayload: true },
    });
    if (!taskRun) throw new Error("DURABLE_INFERENCE_TASKRUN_BINDING_MISSING");
    const disposition = durableMcpTaskWakeDisposition({
      operationId: operation.id,
      progressPayload: taskRun.progressPayload,
    });
    if (disposition === "wait") {
      return { status: operation.status, disposition: "busy" as const, nextWakeAt: null };
    }
    if (disposition === "cancel") {
      await store.requestAuthorizedCancellation({
        authorityScopeKey: operation.authorityScopeKey,
        requestKey: operation.requestKey,
        now: new Date(),
      });
    }
  }
  const provider = createDurableAsyncProviderDependencies(productionProviderIo);
  return runAsyncOperationWake(input, {
    runWorker: (workerInput) => runDurableAsyncOperationWorker(workerInput, {
      store,
      now: () => new Date(),
      ...provider,
    }),
    loadForWorker: (operationId) => store.loadForWorker(operationId),
    enqueue: enqueueWake,
    now: () => new Date(),
  });
}

export async function reconcilePrismaAsyncOperationWakes(input: { limit?: number }) {
  const store = createStore();
  return reconcileAsyncOperationWakes(input, {
    listRecoverableOperationIds: (request) => store.listRecoverableOperationIds(request),
    enqueue: enqueueWake,
    now: () => new Date(),
  });
}

export async function publishPrismaAsyncOperationTransitions(input: { limit?: number } = {}) {
  const store = createStore();
  return publishAsyncOperationTransitions({
    store,
    limit: input.limit,
    now: () => new Date(),
    publish: publishAsyncOperationTransitionEvent,
  });
}
