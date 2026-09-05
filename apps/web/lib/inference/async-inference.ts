// apps/web/lib/async-inference.ts

/**
 * EP-INF-009d: Async inference operation management.
 *
 * Provides functions to:
 *   - Create and track async inference operations
 *   - Poll provider for operation status
 *   - Complete operations and store results
 *   - Handle expiry and cancellation
 *   - Retrieve completed results
 *
 * Polling is caller-driven — no background daemon. The agentic loop or
 * calling code invokes pollAsyncOperation() periodically while waiting.
 */

import { prisma, type Prisma } from "@dpf/db";
import { agentEventBus } from "@/lib/agent-event-bus";
import {
  getDecryptedCredential,
  getProviderExtraHeaders,
  getProviderBearerToken,
} from "@/lib/ai-provider-internals";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { resolveOpenAiCompatibleApiBase } from "@/lib/routing/openai-base";
import { withGeminiInteractionsApiRevision } from "@/lib/routing/gemini-interactions-contract";
import {
  parseAsyncInferenceOperationStatus,
  type AsyncInferenceOperationStatus,
} from "./async-operation-contract";
import { providerInferenceFetch } from "./provider-inference-transport";

// ─── Types ───────────────────────────────────────────────────────────────────

/** @deprecated Durable callers must use AsyncInferenceOperationStatus. */
export type AsyncOpStatus = AsyncInferenceOperationStatus;

export interface AsyncOperationInfo {
  id: string;
  providerId: string;
  modelId: string;
  operationId: string | null;
  status: AsyncOpStatus;
  progressPct: number | null;
  progressMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
  expiresAt: Date;
}

export interface AsyncOperationResult {
  id: string;
  providerId: string;
  modelId: string;
  status: AsyncOpStatus;
  resultText: string | null;
  resultData: unknown;
  errorMessage: string | null;
  inputTokens: number;
  outputTokens: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes
const POLL_TIMEOUT_MS = 10_000;

// ─── Create Operation ────────────────────────────────────────────────────────

/**
 * Record a new async inference operation in the database.
 * Called by routeAndCall() after the async adapter returns an operation ID.
 */
export async function createAsyncOperation(params: {
  providerId: string;
  modelId: string;
  operationId: string;
  contractFamily: string;
  requestContext: Record<string, unknown>;
  threadId?: string;
  callerContext?: Record<string, unknown>;
  maxDurationMs?: number;
}): Promise<string> {
  const expiryMs = params.maxDurationMs ?? DEFAULT_EXPIRY_MS;
  const op = await prisma.asyncInferenceOp.create({
    data: {
      providerId: params.providerId,
      // This compatibility writer begins after a provider handle already
      // exists, so it cannot truthfully claim the version-one pre-POST binding
      // contract. Keep it explicitly legacy until all callers use admission.
      identityVersion: 0,
      modelId: params.modelId,
      operationId: params.operationId,
      contractFamily: params.contractFamily,
      requestContext: params.requestContext as Prisma.InputJsonValue,
      status: "running",
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + expiryMs),
      threadId: params.threadId,
      ...(params.callerContext ? { callerContext: params.callerContext as Prisma.InputJsonValue } : {}),
    },
  });

  // Emit start event
  if (params.threadId) {
    agentEventBus.emit(params.threadId, {
      type: "async:started" as any,
      operationId: op.id,
      providerId: params.providerId,
      modelId: params.modelId,
    });
  }

  return op.id;
}

// ─── Poll Operation ──────────────────────────────────────────────────────────

/**
 * Poll a running async operation for status updates.
 * Returns the current status. Caller should loop with a delay.
 *
 * On completion: stores result, emits event, returns "completed".
 * On failure: stores error, emits event, returns "failed".
 * On expiry: marks expired, emits event, returns "expired".
 */
export async function pollAsyncOperation(opId: string): Promise<AsyncOpStatus> {
  const op = await prisma.asyncInferenceOp.findUnique({ where: { id: opId } });
  if (!op) return "failed";
  assertLegacyBareIdAccess(op.identityVersion);
  const status = parseAsyncInferenceOperationStatus(op.status);

  // Terminal states — no polling needed
  if (status === "completed" || status === "failed" || status === "cancelled" || status === "expired") {
    return status;
  }

  // Check expiry
  if (new Date() > op.expiresAt) {
    await prisma.asyncInferenceOp.update({
      where: { id: opId },
      data: { status: "expired", completedAt: new Date() },
    });
    if (op.threadId) {
      agentEventBus.emit(op.threadId, {
        type: "async:expired" as any,
        operationId: opId,
      });
    }
    return "expired";
  }

  // No operation ID yet — can't poll
  if (!op.operationId) return status;

  // Poll the provider
  try {
    const pollResult = await pollAsyncProviderOperation(op.providerId, op.operationId);

    if (pollResult.done) {
      const terminalStatus = pollResult.terminalStatus ?? "completed";
      const terminalFailed = terminalStatus === "failed";
      const progressMessage = pollResult.progressMessage
        ?? (terminalStatus === "cancelled"
          ? "Cancelled"
          : terminalFailed
            ? "Failed"
            : "Complete");
      await prisma.asyncInferenceOp.update({
        where: { id: opId },
        data: {
          status: terminalStatus,
          completedAt: new Date(),
          progressPct: 100,
          progressMessage,
          ...(terminalFailed
            ? { errorMessage: pollResult.errorMessage ?? "Provider operation failed" }
            : { resultText: pollResult.text }),
          ...(terminalStatus === "completed" && pollResult.raw
            ? { resultData: pollResult.raw as Prisma.InputJsonValue }
            : {}),
        },
      });
      if (op.threadId) {
        if (terminalFailed) {
          agentEventBus.emit(op.threadId, {
            type: "async:failed",
            operationId: opId,
            error: pollResult.errorMessage ?? "Provider operation failed",
          });
        } else if (terminalStatus === "cancelled") {
          agentEventBus.emit(op.threadId, {
            type: "async:cancelled",
            operationId: opId,
          });
        } else {
          agentEventBus.emit(op.threadId, {
            type: "async:complete",
            operationId: opId,
          });
        }
      }
      return terminalStatus;
    }

    // Still running — update progress
    if (pollResult.progressPct !== undefined || pollResult.progressMessage) {
      await prisma.asyncInferenceOp.update({
        where: { id: opId },
        data: {
          progressPct: pollResult.progressPct,
          progressMessage: pollResult.progressMessage,
        },
      });
      if (op.threadId) {
        agentEventBus.emit(op.threadId, {
          type: "async:progress" as any,
          operationId: opId,
          progressPct: pollResult.progressPct ?? 0,
          message: pollResult.progressMessage ?? "Processing...",
        });
      }
    }

    return "running";
  } catch (err) {
    const errorMessage = getErrorMessage(err);
    await prisma.asyncInferenceOp.update({
      where: { id: opId },
      data: {
        status: "failed",
        completedAt: new Date(),
        errorMessage,
      },
    });
    if (op.threadId) {
      agentEventBus.emit(op.threadId, {
        type: "async:failed" as any,
        operationId: opId,
        error: errorMessage,
      });
    }
    return "failed";
  }
}

// ─── Provider Polling ────────────────────────────────────────────────────────

export interface AsyncProviderOperationPollResult {
  done: boolean;
  terminalStatus?: "completed" | "failed" | "cancelled";
  text?: string;
  errorMessage?: string;
  raw?: Record<string, unknown>;
  progressPct?: number;
  progressMessage?: string;
}

export async function pollAsyncProviderOperation(
  providerId: string,
  operationId: string,
  fetchImpl: typeof fetch = providerInferenceFetch,
): Promise<AsyncProviderOperationPollResult> {
  const provider = await prisma.modelProvider.findUnique({ where: { providerId } });
  if (!provider?.baseUrl) throw new Error(`Provider ${providerId} not found or has no baseUrl`);

  // Build auth headers
  const headers: Record<string, string> = {
    ...getProviderExtraHeaders(providerId),
    "Content-Type": "application/json",
  };

  if (provider.authMethod === "api_key") {
    const cred = await getDecryptedCredential(providerId);
    if (cred?.secretRef && provider.authHeader) {
      headers[provider.authHeader] = provider.authHeader === "Authorization"
        ? `Bearer ${cred.secretRef}` : cred.secretRef;
    }
  } else if (provider.authMethod === "oauth2_client_credentials" || provider.authMethod === "oauth2_authorization_code") {
    const tokenResult = await getProviderBearerToken(providerId);
    if ("token" in tokenResult) {
      headers["Authorization"] = `Bearer ${tokenResult.token}`;
    }
  }

  if (providerId === "gemini") {
    return pollGemini(provider.baseUrl, operationId, headers, fetchImpl);
  }

  // Generic: try GET {baseUrl}/operations/{operationId}
  return pollGeneric(provider.baseUrl, operationId, headers, fetchImpl);
}

async function pollGemini(
  baseUrl: string,
  operationId: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<AsyncProviderOperationPollResult> {
  // Interaction IDs are opaque provider-owned identities. Always poll beneath
  // the configured provider base so a stored value can never redirect auth
  // headers to an attacker-controlled host.
  const url = `${baseUrl.replace(/\/+$/, "")}/interactions/${encodeURIComponent(operationId)}`;

  const res = await fetchImpl(url, {
    method: "GET",
    headers: withGeminiInteractionsApiRevision(headers),
    signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Provider poll failed with HTTP ${res.status}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  if (data.id !== operationId) {
    throw new Error("Gemini interaction identity mismatch");
  }
  if (data.object !== undefined && data.object !== "interaction") {
    throw new Error("Unexpected Gemini interaction object");
  }

  const status = typeof data.status === "string" ? data.status : null;
  if (status === "completed") {
    const steps: unknown[] = Array.isArray(data.steps) ? data.steps : [];
    const modelOutputs = steps.filter((step): step is Record<string, unknown> => (
        typeof step === "object" && step !== null && !Array.isArray(step)
        && (step as Record<string, unknown>).type === "model_output"
      ));
    const lastModelOutput = modelOutputs[modelOutputs.length - 1];
    const outputContent: unknown[] = Array.isArray(lastModelOutput?.content)
      ? lastModelOutput.content
      : [];
    const text = outputContent
      .filter((item): item is Record<string, unknown> => (
        typeof item === "object" && item !== null && !Array.isArray(item)
        && (item as Record<string, unknown>).type === "text"
      ))
      .map((item) => typeof item.text === "string" ? item.text : "")
      .join("");
    const usage = (
      typeof data.usage === "object" && data.usage !== null && !Array.isArray(data.usage)
        ? data.usage
        : {}
    ) as Record<string, unknown>;

    return {
      done: true,
      terminalStatus: "completed",
      progressMessage: "Complete",
      text,
      raw: {
        ...data,
        usage: {
          inputTokens: typeof usage.total_input_tokens === "number"
            ? usage.total_input_tokens
            : 0,
          outputTokens: typeof usage.total_output_tokens === "number"
            ? usage.total_output_tokens
            : 0,
        },
      },
    };
  }

  if (status === "in_progress" || status === "queued") {
    return {
      done: false,
      progressMessage: status,
    };
  }

  if (status === "cancelled") {
    return {
      done: true,
      terminalStatus: "cancelled",
      progressMessage: "Cancelled",
    };
  }

  const errorMessage = status === "requires_action"
    ? "Gemini interaction requires_action, but no continuation path is available"
    : status === "incomplete"
      ? "Gemini interaction was incomplete"
      : status === "failed"
        ? "Gemini interaction failed"
        : status === "budget_exceeded"
          ? "Gemini interaction exceeded its provider budget"
          : "Gemini interaction returned an unsupported status";
  return {
    done: true,
    terminalStatus: "failed",
    errorMessage,
    progressMessage: "Failed",
  };
}

async function pollGeneric(
  baseUrl: string,
  operationId: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<AsyncProviderOperationPollResult> {
  const apiBase = resolveOpenAiCompatibleApiBase(baseUrl);
  const url = `${apiBase}/operations/${operationId}`;

  const res = await fetchImpl(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Provider poll failed with HTTP ${res.status}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const responseId = typeof data.id === "string"
    ? data.id
    : typeof data.operation_id === "string"
      ? data.operation_id
      : null;
  if (responseId !== null && responseId !== operationId) {
    throw new Error("Provider operation identity mismatch");
  }

  const status = typeof data.status === "string" ? data.status.toLowerCase() : null;
  const error = data.error;
  const failedStatuses = new Set(["failed", "error", "errored"]);
  const cancelledStatuses = new Set(["cancelled", "canceled"]);
  const completedStatuses = new Set(["completed", "succeeded"]);
  const runningStatuses = new Set([
    "pending", "queued", "running", "in_progress", "processing",
  ]);
  if (status !== null
    && !failedStatuses.has(status)
    && !cancelledStatuses.has(status)
    && !completedStatuses.has(status)
    && !runningStatuses.has(status)) {
    throw new Error("Provider operation returned an unsupported status");
  }

  if (failedStatuses.has(status ?? "") || (data.done === true && error)) {
    return {
      done: true,
      terminalStatus: "failed",
      errorMessage: "Provider operation failed",
      progressMessage: "Failed",
    };
  }
  if (cancelledStatuses.has(status ?? "")) {
    return {
      done: true,
      terminalStatus: "cancelled",
      progressMessage: "Cancelled",
    };
  }

  const done = completedStatuses.has(status ?? "") || data.done === true;

  if (done) {
    const result = (data.result ?? data.response ?? data.output) as Record<string, unknown> | undefined;
    const text = typeof result?.text === "string" ? result.text : "";
    return { done: true, terminalStatus: "completed", text, raw: data };
  }

  const running = runningStatuses.has(status ?? "") || data.done === false;
  if (!running) {
    throw new Error("Provider operation returned an unsupported status");
  }

  return {
    done: false,
    progressPct: typeof data.progress === "number" ? data.progress : undefined,
    progressMessage: "Provider operation in progress",
  };
}

// ─── Get Operation Info ──────────────────────────────────────────────────────

export async function getAsyncOperationInfo(opId: string): Promise<AsyncOperationInfo | null> {
  const op = await prisma.asyncInferenceOp.findUnique({ where: { id: opId } });
  if (!op) return null;
  assertLegacyBareIdAccess(op.identityVersion);

  return {
    id: op.id,
    providerId: op.providerId,
    modelId: op.modelId,
    operationId: op.operationId,
    status: parseAsyncInferenceOperationStatus(op.status),
    progressPct: op.progressPct,
    progressMessage: op.progressMessage,
    createdAt: op.createdAt,
    completedAt: op.completedAt,
    expiresAt: op.expiresAt,
  };
}

// ─── Get Operation Result ────────────────────────────────────────────────────

export async function getAsyncOperationResult(opId: string): Promise<AsyncOperationResult | null> {
  const op = await prisma.asyncInferenceOp.findUnique({ where: { id: opId } });
  if (!op) return null;
  assertLegacyBareIdAccess(op.identityVersion);

  const usage = op.resultData && typeof op.resultData === "object"
    ? ((op.resultData as Record<string, unknown>).usage as { inputTokens?: number; outputTokens?: number } | undefined)
    : undefined;

  return {
    id: op.id,
    providerId: op.providerId,
    modelId: op.modelId,
    status: parseAsyncInferenceOperationStatus(op.status),
    resultText: op.resultText,
    resultData: op.resultData,
    errorMessage: op.errorMessage,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
  };
}

// ─── Cancel Operation ────────────────────────────────────────────────────────

export async function cancelAsyncOperation(opId: string): Promise<void> {
  const op = await prisma.asyncInferenceOp.findUnique({ where: { id: opId } });
  if (!op) return;
  assertLegacyBareIdAccess(op.identityVersion);
  const status = parseAsyncInferenceOperationStatus(op.status);
  if (
    status === "completed"
    || status === "failed"
    || status === "cancelled"
    || status === "expired"
  ) return;

  await prisma.asyncInferenceOp.update({
    where: { id: opId },
    data: { status: "cancelled", completedAt: new Date() },
  });

  if (op.threadId) {
    agentEventBus.emit(op.threadId, {
      type: "async:cancelled",
      operationId: opId,
    });
  }
}

function assertLegacyBareIdAccess(identityVersion: number): void {
  if (identityVersion !== 0) {
    throw new Error("ASYNC_OPERATION_AUTHORIZED_SCOPE_REQUIRED");
  }
}
