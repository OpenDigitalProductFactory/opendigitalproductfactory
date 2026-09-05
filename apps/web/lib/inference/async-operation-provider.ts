import type { ChatMessage } from "./ai-inference";
import type { AsyncOperationRecord } from "./async-operation-lifecycle";
import {
  AsyncProviderPollError,
  AsyncProviderStartError,
  type AsyncOperationWorkerDependencies,
  type AsyncProviderPollResult,
  type AsyncProviderStartReconciliation,
} from "./async-operation-worker";
import type { RoutedExecutionPlan } from "@/lib/routing/recipe-types";
import {
  parseDurableDispatchScreenEvidence,
  type DurableDispatchScreenEvidence,
} from "./durable-dispatch-screen";

const MAX_SCREENED_CONTEXT_BYTES = 1_000_000;
const CREDENTIAL_FIELD_NAMES = new Set([
  "apikey",
  "accesstoken",
  "auth",
  "authorization",
  "bearer",
  "clientsecret",
  "cookie",
  "credential",
  "credentials",
  "headers",
  "password",
  "secret",
  "secretref",
  "token",
  "refreshtoken",
]);

type Attribution = {
  traceId?: string | null;
  agentId?: string | null;
  threadId?: string | null;
  skillId?: string | null;
  agentMessageId?: string | null;
  buildId?: string | null;
};

export interface DurableAsyncProviderContext {
  version: 1;
  messages: ChatMessage[];
  systemPrompt: string;
  tools?: Array<Record<string, unknown>>;
  executionPlan: RoutedExecutionPlan;
  dispatchScreen: DurableDispatchScreenEvidence;
  previousResponseId?: string;
  attribution?: Attribution;
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function containsCredentialField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsCredentialField);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => (
    CREDENTIAL_FIELD_NAMES.has(key.replace(/[^a-z0-9]/gi, "").toLowerCase())
    || containsCredentialField(child)
  ));
}

function optionalString(value: unknown, code: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(code);
  return value;
}

function parseAttribution(value: unknown): Attribution | undefined {
  if (value === undefined) return undefined;
  const input = record(value, "ASYNC_OPERATION_CONTEXT_ATTRIBUTION_INVALID");
  const allowed = new Set([
    "traceId", "agentId", "threadId", "skillId", "agentMessageId", "buildId",
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new Error("ASYNC_OPERATION_CONTEXT_ATTRIBUTION_INVALID");
  }
  const result: Attribution = {};
  for (const key of allowed) {
    const valueAtKey = input[key];
    if (valueAtKey !== undefined && valueAtKey !== null && typeof valueAtKey !== "string") {
      throw new Error("ASYNC_OPERATION_CONTEXT_ATTRIBUTION_INVALID");
    }
    if (valueAtKey !== undefined) Object.assign(result, { [key]: valueAtKey });
  }
  return result;
}

/**
 * Validate and normalize the screened request before it may be persisted or
 * dispatched. Provider credentials remain runtime-only.
 */
export function parseDurableAsyncProviderContextInput(inputIdentity: {
  screenedRequestContext: Record<string, unknown>;
  providerId: string;
  modelId: string;
  contractFamily: string;
}): DurableAsyncProviderContext {
  let encoded: string;
  let normalized: unknown;
  try {
    encoded = JSON.stringify(inputIdentity.screenedRequestContext);
    if (encoded === undefined) {
      throw new Error("ASYNC_OPERATION_CONTEXT_NOT_SERIALIZABLE");
    }
    normalized = JSON.parse(encoded) as unknown;
  } catch {
    throw new Error("ASYNC_OPERATION_CONTEXT_NOT_SERIALIZABLE");
  }
  if (Buffer.byteLength(encoded, "utf8") > MAX_SCREENED_CONTEXT_BYTES) {
    throw new Error("ASYNC_OPERATION_CONTEXT_TOO_LARGE");
  }
  // JSON serialization is the durable boundary. Validate, screen, hash, and
  // persist the exact plain-JSON value that Prisma will store so Date/toJSON
  // hooks cannot create a second identity or hide credential-shaped fields.
  if (containsCredentialField(normalized)) {
    throw new Error("ASYNC_OPERATION_CONTEXT_CONTAINS_CREDENTIALS");
  }

  const input = record(normalized, "ASYNC_OPERATION_CONTEXT_INVALID");
  if (input.version !== 1) throw new Error("ASYNC_OPERATION_CONTEXT_VERSION_INVALID");
  if (!Array.isArray(input.messages)) throw new Error("ASYNC_OPERATION_CONTEXT_MESSAGES_INVALID");
  if (typeof input.systemPrompt !== "string") {
    throw new Error("ASYNC_OPERATION_CONTEXT_SYSTEM_PROMPT_INVALID");
  }
  if (input.tools !== undefined && (
    !Array.isArray(input.tools)
    || input.tools.some((tool) => !tool || typeof tool !== "object" || Array.isArray(tool))
  )) {
    throw new Error("ASYNC_OPERATION_CONTEXT_TOOLS_INVALID");
  }

  const executionPlan = record(
    input.executionPlan,
    "ASYNC_OPERATION_CONTEXT_EXECUTION_PLAN_INVALID",
  ) as unknown as RoutedExecutionPlan;
  if (executionPlan.executionAdapter !== "async") {
    throw new Error("ASYNC_OPERATION_CONTEXT_ADAPTER_INVALID");
  }
  if (executionPlan.providerId !== inputIdentity.providerId) {
    throw new Error("ASYNC_OPERATION_CONTEXT_PROVIDER_MISMATCH");
  }
  if (executionPlan.modelId !== inputIdentity.modelId) {
    throw new Error("ASYNC_OPERATION_CONTEXT_MODEL_MISMATCH");
  }
  if (executionPlan.contractFamily !== inputIdentity.contractFamily) {
    throw new Error("ASYNC_OPERATION_CONTEXT_CONTRACT_MISMATCH");
  }
  const dispatchScreen = parseDurableDispatchScreenEvidence(input.dispatchScreen);

  return {
    version: 1,
    messages: input.messages as ChatMessage[],
    systemPrompt: input.systemPrompt,
    ...(input.tools === undefined
      ? {}
      : { tools: input.tools as Array<Record<string, unknown>> }),
    executionPlan,
    dispatchScreen,
    ...(optionalString(input.previousResponseId, "ASYNC_OPERATION_CONTEXT_RESPONSE_ID_INVALID")
      ? { previousResponseId: input.previousResponseId as string }
      : {}),
    ...(input.attribution === undefined ? {} : { attribution: parseAttribution(input.attribution) }),
  };
}

/** Revalidate persisted context before every provider dispatch. */
export function parseDurableAsyncProviderContext(
  operation: AsyncOperationRecord,
): DurableAsyncProviderContext {
  return parseDurableAsyncProviderContextInput(operation);
}

export interface DurableAsyncProviderIo {
  authorizeDispatch?(input: {
    operation: AsyncOperationRecord;
    providerId: string;
    context: DurableAsyncProviderContext;
  }): Promise<void> | void;
  dispatch(input: {
    providerId: string;
    modelId: string;
    context: DurableAsyncProviderContext;
  }): Promise<unknown>;
  poll(input: {
    providerId: string;
    providerOperationId: string;
  }): Promise<AsyncProviderPollResult>;
  reconcile(input: {
    providerId: string;
    operation: AsyncOperationRecord;
  }): Promise<AsyncProviderStartReconciliation>;
}

function startFailureBoundary(error: unknown): "definite-rejection" | "ambiguous" {
  if (!error || typeof error !== "object") return "ambiguous";
  const details = error as { code?: unknown; name?: unknown; statusCode?: unknown };
  if (details.name === "AbortError" || details.code === "network" || details.code === "transient") {
    return "ambiguous";
  }
  // Only responses whose HTTP semantics prove request rejection can close the
  // start attempt. A timeout, conflict, rate limit, or any 5xx may arrive after
  // the provider accepted work, so it must hold in start_indeterminate.
  if (typeof details.statusCode === "number" && [
    400, 401, 403, 404, 405, 406, 411, 413, 414, 415, 422,
  ].includes(details.statusCode)) {
    return "definite-rejection";
  }
  return details.code === "auth"
      || details.code === "billing"
      || details.code === "model_not_found"
      || details.code === "request_too_large"
    ? "definite-rejection"
    : "ambiguous";
}

function acceptedProviderOperationId(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const asyncOperation = (result as Record<string, unknown>).asyncOperation;
  if (!asyncOperation || typeof asyncOperation !== "object" || Array.isArray(asyncOperation)) return null;
  const value = asyncOperation as Record<string, unknown>;
  return value.status === "accepted"
    && typeof value.providerOperationId === "string"
    && value.providerOperationId.length > 0
    && value.providerOperationId.trim() === value.providerOperationId
    ? value.providerOperationId
    : null;
}

/** Build the provider side of the worker while keeping credentials runtime-only. */
export function createDurableAsyncProviderDependencies(
  io: DurableAsyncProviderIo,
): Pick<
  AsyncOperationWorkerDependencies,
  "startProvider" | "pollProvider" | "reconcileIndeterminateStart"
> {
  return {
    async startProvider(operation) {
      const context = parseDurableAsyncProviderContext(operation);
      try {
        await io.authorizeDispatch?.({
          operation,
          providerId: operation.providerId,
          context,
        });
      } catch {
        throw new AsyncProviderStartError(
          "ASYNC_OPERATION_DISPATCH_SCREEN_REJECTED",
          "definite-rejection",
        );
      }
      try {
        const result = await io.dispatch({
          providerId: operation.providerId,
          modelId: operation.modelId,
          context,
        });
        const providerOperationId = acceptedProviderOperationId(result);
        if (!providerOperationId) {
          throw new AsyncProviderStartError(
            "ASYNC_OPERATION_TYPED_PROVIDER_HANDLE_REQUIRED",
            "ambiguous",
          );
        }
        return { providerOperationId };
      } catch (error) {
        if (error instanceof AsyncProviderStartError) throw error;
        const boundary = startFailureBoundary(error);
        throw new AsyncProviderStartError(
          boundary === "definite-rejection"
            ? "ASYNC_PROVIDER_START_REJECTED"
            : "ASYNC_PROVIDER_START_INDETERMINATE",
          boundary,
        );
      }
    },

    async pollProvider(operation) {
      if (!operation.providerOperationId) {
        throw new AsyncProviderPollError(
          "ASYNC_OPERATION_PROVIDER_HANDLE_REQUIRED",
          false,
        );
      }
      return io.poll({
        providerId: operation.providerId,
        providerOperationId: operation.providerOperationId,
      });
    },

    reconcileIndeterminateStart(operation) {
      return io.reconcile({ providerId: operation.providerId, operation });
    },
  };
}
