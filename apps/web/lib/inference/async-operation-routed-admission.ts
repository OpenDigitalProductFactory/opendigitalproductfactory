import type { ChatMessage } from "./ai-inference";
import type { RouteDecision } from "@/lib/routing/types";
import type { RouteAndCallOptions } from "./routed-inference-options";
import { admitPrismaDurableAsyncOperation } from "./async-operation-runtime";

const DEFAULT_EXPIRY_MS = 15 * 60 * 1_000;
const MAX_EXPIRY_MS = 24 * 60 * 60 * 1_000;
const DURABLE_ASYNC_PROTOCOL_BY_PROVIDER: ReadonlyMap<string, string> = new Map([
  ["gemini", "gemini-interactions-v1"],
] as const);

export function routeUsesDurableAsyncAdapter(decision: RouteDecision): boolean {
  return decision.executionPlan?.executionAdapter === "async";
}

function expiryAt(now: Date, requestedDurationMs: number | undefined): Date {
  const durationMs = requestedDurationMs ?? DEFAULT_EXPIRY_MS;
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0 || durationMs > MAX_EXPIRY_MS) {
    throw new Error("ASYNC_OPERATION_DURATION_INVALID");
  }
  return new Date(now.getTime() + durationMs);
}

/**
 * Bind and enqueue the platform operation before the worker is allowed to make
 * the provider POST. The caller supplies only a semantic TaskRun/Workroom
 * request; the runtime resolves its exact internal scope server-side.
 */
export async function admitRoutedAsyncOperation(input: {
  decision: RouteDecision;
  messages: ChatMessage[];
  systemPrompt: string;
  tools?: Array<Record<string, unknown>>;
  options: RouteAndCallOptions | undefined;
  traceId: string;
  now?: Date;
}): Promise<{ operationId: string; providerId: string; modelId: string }> {
  const plan = input.decision.executionPlan;
  if (!plan || plan.executionAdapter !== "async") {
    throw new Error("ASYNC_OPERATION_EXECUTION_PLAN_REQUIRED");
  }
  // A routed "async" label is not evidence that the selected provider exposes
  // a resumable protocol. Refuse unsupported plans before durable admission so
  // a pre-network adapter rejection can never strand a never-started row in
  // start_indeterminate.
  if (!DURABLE_ASYNC_PROTOCOL_BY_PROVIDER.has(plan.providerId)) {
    throw new Error("ASYNC_OPERATION_PROTOCOL_UNSUPPORTED");
  }
  const authority = input.options?.durableAsyncOperation;
  if (!authority) throw new Error("ASYNC_OPERATION_AUTHORITY_REQUIRED");

  const screenedRequestDigest = input.decision.inferenceDataScreenReceipt?.inputHash;
  if (!screenedRequestDigest || !/^[a-f0-9]{64}$/u.test(screenedRequestDigest)) {
    throw new Error("ASYNC_OPERATION_SCREENING_RECEIPT_REQUIRED");
  }

  const admitted = await admitPrismaDurableAsyncOperation({
    providerId: plan.providerId,
    modelId: plan.modelId,
    contractFamily: plan.contractFamily,
    screenedRequestDigest,
    screenedRequestContext: {
      version: 1,
      messages: input.messages,
      systemPrompt: input.systemPrompt,
      ...(input.tools === undefined ? {} : { tools: input.tools }),
      executionPlan: plan,
      ...(input.options?.previousResponseId
        ? { previousResponseId: input.options.previousResponseId }
        : {}),
      attribution: {
        traceId: input.traceId,
        agentId: input.options?.agentId ?? null,
        threadId: input.options?.threadId ?? null,
        agentMessageId: input.options?.agentMessageId ?? null,
        buildId: input.options?.buildId ?? null,
      },
    },
    expiresAt: expiryAt(input.now ?? new Date(), input.options?.maxDurationMs),
    request: authority.request,
    actor: authority.actor,
  });

  return {
    operationId: admitted.operationId,
    providerId: plan.providerId,
    modelId: plan.modelId,
  };
}
