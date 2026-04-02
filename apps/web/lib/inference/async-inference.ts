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

// ─── Types ───────────────────────────────────────────────────────────────────

export type AsyncOpStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "expired";

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

  // Terminal states — no polling needed
  if (op.status === "completed" || op.status === "failed" || op.status === "cancelled" || op.status === "expired") {
    return op.status as AsyncOpStatus;
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
  if (!op.operationId) return op.status as AsyncOpStatus;

  // Poll the provider
  try {
    const pollResult = await pollProvider(op.providerId, op.operationId);

    if (pollResult.done) {
      // Operation complete
      await prisma.asyncInferenceOp.update({
        where: { id: opId },
        data: {
          status: "completed",
          completedAt: new Date(),
          progressPct: 100,
          progressMessage: "Complete",
          resultText: pollResult.text,
          ...(pollResult.raw ? { resultData: pollResult.raw as Prisma.InputJsonValue } : {}),
        },
      });
      if (op.threadId) {
        agentEventBus.emit(op.threadId, {
          type: "async:complete" as any,
          operationId: opId,
        });
      }
      return "completed";
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
    const errorMessage = err instanceof Error ? err.message : String(err);
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

interface PollResult {
  done: boolean;
  text?: string;
  raw?: Record<string, unknown>;
  progressPct?: number;
  progressMessage?: string;
}

async function pollProvider(providerId: string, operationId: string): Promise<PollResult> {
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
    return pollGemini(provider.baseUrl, operationId, headers);
  }

  // Generic: try GET {baseUrl}/operations/{operationId}
  return pollGeneric(provider.baseUrl, operationId, headers);
}

async function pollGemini(
  baseUrl: string,
  operationId: string,
  headers: Record<string, string>,
): Promise<PollResult> {
  // Google LRO: GET {baseUrl}/{operationName}
  // operationId is the full "operations/..." path
  const url = operationId.startsWith("http")
    ? operationId
    : `${baseUrl}/${operationId}`;

  const res = await fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Poll failed: HTTP ${res.status} — ${errBody.slice(0, 200)}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const done = data.done === true;

  if (done) {
    // Extract result from Google LRO response
    const response = data.response as Record<string, unknown> | undefined;
    const candidates = (response?.candidates as Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>) ?? [];
    const text = candidates[0]?.content?.parts?.map(p => p.text ?? "").join("") ?? "";

    const usageMetadata = (response?.usageMetadata as Record<string, number>) ?? {};

    return {
      done: true,
      text,
      raw: {
        ...data,
        usage: {
          inputTokens: usageMetadata.promptTokenCount ?? 0,
          outputTokens: usageMetadata.candidatesTokenCount ?? 0,
        },
      },
    };
  }

  // Still running — extract progress from metadata
  const metadata = data.metadata as Record<string, unknown> | undefined;
  const progressPct = typeof metadata?.progress === "number" ? metadata.progress : undefined;
  const progressMessage = typeof metadata?.status === "string" ? metadata.status : undefined;

  return {
    done: false,
    progressPct,
    progressMessage,
  };
}

async function pollGeneric(
  baseUrl: string,
  operationId: string,
  headers: Record<string, string>,
): Promise<PollResult> {
  const apiBase = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
  const url = `${apiBase}/operations/${operationId}`;

  const res = await fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Poll failed: HTTP ${res.status} — ${errBody.slice(0, 200)}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const status = data.status as string | undefined;
  const done = status === "completed" || status === "succeeded" || data.done === true;

  if (done) {
    const result = (data.result ?? data.response ?? data.output) as Record<string, unknown> | undefined;
    const text = typeof result?.text === "string" ? result.text : "";
    return { done: true, text, raw: data };
  }

  return {
    done: false,
    progressPct: typeof data.progress === "number" ? data.progress : undefined,
    progressMessage: typeof data.status_message === "string" ? data.status_message : undefined,
  };
}

// ─── Get Operation Info ──────────────────────────────────────────────────────

export async function getAsyncOperationInfo(opId: string): Promise<AsyncOperationInfo | null> {
  const op = await prisma.asyncInferenceOp.findUnique({ where: { id: opId } });
  if (!op) return null;

  return {
    id: op.id,
    providerId: op.providerId,
    modelId: op.modelId,
    operationId: op.operationId,
    status: op.status as AsyncOpStatus,
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

  const usage = op.resultData && typeof op.resultData === "object"
    ? ((op.resultData as Record<string, unknown>).usage as { inputTokens?: number; outputTokens?: number } | undefined)
    : undefined;

  return {
    id: op.id,
    providerId: op.providerId,
    modelId: op.modelId,
    status: op.status as AsyncOpStatus,
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
  if (!op || op.status === "completed" || op.status === "failed") return;

  await prisma.asyncInferenceOp.update({
    where: { id: opId },
    data: { status: "cancelled", completedAt: new Date() },
  });

  if (op.threadId) {
    agentEventBus.emit(op.threadId, {
      type: "async:failed" as any,
      operationId: opId,
      error: "Cancelled by caller",
    });
  }
}
