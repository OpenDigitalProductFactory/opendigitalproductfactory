// apps/web/lib/ai-inference.ts
// Shared inference module — plain server-only module (NOT "use server").
// Server actions in actions/*.ts can import from here freely.

import { prisma } from "@dpf/db";
import { computeTokenCost, computeComputeCost } from "@/lib/ai-provider-types";
import {
  aiInferenceDuration,
  aiInferenceTokens,
  aiInferenceErrors,
  aiInferenceCostUsd,
  aiCacheCreationTokens,
  aiCacheReadTokens,
} from "@/lib/metrics";
import {
  getDecryptedCredential,
  getProviderExtraHeaders,
  getProviderBearerToken,
  isAnthropicProvider,
  ANTHROPIC_OAUTH_BETA_HEADERS,
} from "@/lib/ai-provider-internals";
import type { RoutedExecutionPlan } from "../routing/recipe-types";
import type { ChatMessage, ToolCallEntry } from "../routing/chat-message-types";
import { resolveDefaultExecutionAdapter } from "../routing/execution-plan";
import { getExecutionAdapter } from "../routing/execution-adapter-registry";
import { resolveExecutionAdapter } from "../routing/resolve-execution-adapter";
import {
  parseExecutionAdapterSelector,
  type ExecutionAdapterSelector,
} from "../routing/execution-adapter-types";
import { applyRequiredToolChoiceGuard } from "./terminal-writer-dispatch-guard";
import { writeAdapterTelemetry } from "../routing/adapter-telemetry-writer";
import { getCliPoolStatus } from "../routing/cli-pool-status";
import {
  clearProviderCapacityStatus,
  recordProviderCapacityStatus,
} from "../routing/provider-capacity/store";
import "../routing/chat-adapter"; // side-effect: registers "chat" adapter
import "../routing/responses-adapter"; // side-effect: registers "responses" adapter
import "../routing/image-gen-adapter"; // EP-INF-009c: registers "image_gen" adapter
import "../routing/embedding-adapter"; // EP-INF-009c: registers "embedding" adapter
import "../routing/transcription-adapter"; // EP-INF-009c: registers "transcription" adapter
import "../routing/async-adapter"; // EP-INF-009d: registers "async" adapter
import "../routing/cli-adapter"; // anthropic-sub: registers "claude-cli" adapter
import "../routing/codex-cli-adapter"; // codex: registers "codex-cli" adapter
import {
  acquireInferenceSlot,
  currentInferenceOrigin,
  engineKeyForProvider,
} from "./inference-admission";
import { assertProviderDispatchCapacity } from "@/lib/routing/local-provider-capacity";
import { providerInferenceFetch } from "./provider-inference-transport";
import { InferenceError } from "../routing/inference-error";

// ─── Types ───────────────────────────────────────────────────────────────────

export type InferenceResult = {
  content: string;
  inputTokens: number;
  outputTokens: number;
  inferenceMs: number;
  asyncOperation?: import("../routing/adapter-types").AsyncOperationStartResult;
  toolCalls?: ToolCallEntry[];
  /** Responses API: chain subsequent calls with this ID for conversation state. */
  responseId?: string;
  /** True when the provider stopped at the output-token ceiling (BI-1D144CC1). */
  truncated?: boolean;
  /**
   * Verbatim provider response body (matches AdapterResult.raw). Optional —
   * adapters may leave it undefined when nothing useful exists beyond `content`.
   *
   * Populated for callers that need shape-specific fields the projected
   * InferenceResult doesn't expose. The transcription path (Voice Slice 1,
   * spec §6.5) reads `raw.segments[].avg_logprob` from Whisper-family
   * providers to normalize confidence to 0-1; chat callers can ignore it.
   */
  raw?: unknown;
};

// ─── Error Types ─────────────────────────────────────────────────────────────
// Defined in the leaf routing/inference-error and re-exported here (spec 2026-09-30
// §4.2): the adapters import the leaf, which keeps module load order acyclic.

export { InferenceError, classifyHttpError } from "../routing/inference-error";

// ─── Build Auth Headers ──────────────────────────────────────────────────────

async function buildAuthHeaders(
  providerId: string,
  authMethod: string | null,
  authHeader: string | null,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getProviderExtraHeaders(providerId),
  };

  if (authMethod === "api_key") {
    const cred = await getDecryptedCredential(providerId);
    if (!cred?.secretRef || !authHeader) throw new InferenceError("No credential configured", "auth", providerId);
    headers[authHeader] = authHeader === "Authorization" ? `Bearer ${cred.secretRef}` : cred.secretRef;
  } else if (authMethod === "oauth2_client_credentials") {
    const tokenResult = await getProviderBearerToken(providerId);
    if ("error" in tokenResult) throw new InferenceError(tokenResult.error, "auth", providerId);
    headers["Authorization"] = `Bearer ${tokenResult.token}`;
  } else if (authMethod === "oauth2_authorization_code") {
    const tokenResult = await getProviderBearerToken(providerId);
    if ("error" in tokenResult) throw new InferenceError(tokenResult.error, "auth", providerId);
    headers["Authorization"] = `Bearer ${tokenResult.token}`;
    if (isAnthropicProvider(providerId)) {
      headers["anthropic-beta"] = ANTHROPIC_OAUTH_BETA_HEADERS;
    }
  }
  // "none" auth (e.g., local Ollama) — no auth headers needed

  return headers;
}

async function resolveExecutionBaseUrl(
  providerId: string,
  provider: { authMethod: string | null; baseUrl: string | null; endpoint: string | null },
): Promise<string | null> {
  // Route codex through the ChatGPT backend (flat-rate subscription billing).
  // The Responses API SSE parser now handles function call events.
  if (providerId === "codex" && provider.authMethod === "oauth2_authorization_code") {
    const chatgptProvider = await prisma.modelProvider.findUnique({
      where: { providerId: "chatgpt" },
      select: { baseUrl: true, endpoint: true },
    });
    return chatgptProvider?.baseUrl ?? chatgptProvider?.endpoint ?? "https://chatgpt.com/backend-api";
  }
  return provider.baseUrl ?? provider.endpoint;
}

// ─── Tool Call Extraction & Message Formatting ──────────────────────────────
// Pure helpers, defined in the leaf routing/provider-message-format.

export {
  extractAnthropicToolCalls,
  extractOpenAIToolCalls,
  extractTextualToolCalls,
  formatMessageForAnthropic,
  formatMessageForOpenAI,
  formatMessageForResponses,
} from "../routing/provider-message-format";

// ─── callProvider ────────────────────────────────────────────────────────────

export async function callProvider(
  providerId: string,
  modelId: string,
  messages: ChatMessage[],
  systemPrompt: string,
  tools?: Array<Record<string, unknown>>,
  plan?: RoutedExecutionPlan,
  previousResponseId?: string,
  mcpSession?: import("@/lib/routing/adapter-types").AdapterMcpSession,
  attribution?: {
    traceId?: string | null;
    agentId?: string | null;
    threadId?: string | null;
    skillId?: string | null;
    agentMessageId?: string | null;
    buildId?: string | null;
  },
): Promise<InferenceResult> {
  // Resolve adapter enforceability before capacity or budget accounting. A
  // plan/adapter capability miss is not a provider request and must not consume
  // budget, wait on host capacity, or mutate provider health through fallback.
  let effectivePlan: RoutedExecutionPlan = plan ?? {
    providerId,
    modelId,
    recipeId: null,
    contractFamily: "unknown",
    executionAdapter: resolveDefaultExecutionAdapter(providerId),
    maxTokens: 4096,
    providerSettings: {},
    toolPolicy: (tools?.length ?? 0) > 0 ? { toolChoice: "auto" } : {},
    responsePolicy: {},
  };
  const executionAdapterRaw = effectivePlan.executionAdapter;
  let selector: ExecutionAdapterSelector | null;
  try {
    selector = parseExecutionAdapterSelector(executionAdapterRaw);
  } catch (e) {
    if (typeof executionAdapterRaw !== "string") throw e;
    selector = null;
  }
  const isCliAdapter = selector !== null
    && (selector.kind === "claude-code-cli" || selector.kind === "codex-cli");
  // Required tool choice on an adapter that cannot force it: refuse, or — for a
  // bound terminal writer reachable through a governed MCP session — dispatch
  // under the receipt-verified contract (BI-C35576A9). See the guard module.
  const guard = applyRequiredToolChoiceGuard({
    plan: effectivePlan,
    selector,
    tools,
    providerId,
    hasGovernedMcpSession: Boolean(mcpSession),
  });
  if (guard.kind === "refuse") throw new InferenceError(guard.message, guard.code, providerId);
  effectivePlan = guard.plan;

  // Host capacity is a dispatch constraint, not a routing hint. Enforce it at
  // the shared adapter boundary so direct, agentic, evaluation and fallback
  // callers cannot start a local model while governed local CI owns the host.
  await assertProviderDispatchCapacity(providerId);
  // Lease ownership is routing policy. Whether the card is free is an inference
  // fact, so it stays in this layer (routing may not import inference).
  const { assertLocalGpuFree } = await import("@/lib/inference/host-gpu-admission");
  await assertLocalGpuFree({ providerId, modelId });

  // 0. EP-COST-001 Phase 2 — pre-call budget gate.
  // Check the agent's daily token budget before dispatching. If the agent has
  // consumed ≥100% of its registry limit today, throw a billing error so the
  // caller can surface a clear "budget exceeded" message rather than burning
  // more tokens. At 80–95% log a warning; at ≥95% also write a budget event.
  // The check is non-blocking: any DB error is swallowed so a budget-gate DB
  // failure never breaks inference.
  if (attribution?.agentId) {
    try {
      const { checkAgentBudgetFromRegistry, writeBudgetEvent } = await import("@/lib/inference/budget-gate");
      const budget = await checkAgentBudgetFromRegistry(attribution.agentId);

      if (budget.status === "rejected") {
        void writeBudgetEvent({
          agentId: attribution.agentId,
          eventKind: "rejected",
          actualTokens: budget.actualTokens,
          limitTokens: budget.limitTokens,
          modelId,
          providerId,
        });
        throw new InferenceError(
          `Daily token budget exceeded for agent "${attribution.agentId}" ` +
          `(${budget.actualTokens.toLocaleString()} / ${budget.limitTokens.toLocaleString()} tokens used today)`,
          "billing",
          providerId,
        );
      }

      if (budget.status === "warning_95" || budget.status === "warning_80") {
        console.warn(
          "[budget-gate] Agent approaching daily token limit:",
          { agentId: attribution.agentId, ratioPercent: budget.ratioPercent, status: budget.status },
        );
        if (budget.status === "warning_95") {
          void writeBudgetEvent({
            agentId: attribution.agentId,
            eventKind: "warning_95",
            actualTokens: budget.actualTokens,
            limitTokens: budget.limitTokens,
            modelId,
            providerId,
          });
        }
      }
    } catch (err) {
      // Re-throw billing errors; swallow everything else (budget gate is advisory)
      if (err instanceof InferenceError && err.code === "billing") throw err;
      console.warn("[budget-gate] Budget check failed (non-fatal):", { agentId: attribution.agentId }, err);
    }
  }

  // 1. Resolve provider (DB lookup + auth headers)
  const provider = await prisma.modelProvider.findUnique({ where: { providerId } });
  if (!provider) throw new InferenceError("Provider not found", "provider_error", providerId);

  // CLI adapters (anthropic-sub, codex) resolve their own auth and spawn CLI
  // binaries — they do not need HTTP base URL or auth headers.
  // EP-COST Phase 4: consult CliPoolStatus before dispatching a CLI-backed call.
  // If the pool is known-exhausted (resetAt is in the future), throw rate_limit
  // so routed-inference.ts falls back to the next provider in the priority list
  // rather than firing into an already-saturated CLI pool.
  if (isCliAdapter && selector !== null) {
    const cliAdapterType = selector.kind === "claude-code-cli" ? "claude-cli" : "codex-cli";
    const poolState = await getCliPoolStatus(cliAdapterType);
    if (poolState?.isExhausted) {
      const waitSecs = poolState.secondsUntilReset ?? "unknown";
      throw new InferenceError(
        `${cliAdapterType} pool exhausted — resets in ~${waitSecs}s (EP-COST pool check)`,
        "rate_limit",
        providerId,
        undefined,
        undefined,
        undefined,
        undefined,
        true, // localPoolExhausted — fall through, do not wait on this endpoint
      );
    }
  }

  const baseUrl = isCliAdapter ? "cli://local" : await resolveExecutionBaseUrl(providerId, provider);
  if (!baseUrl) throw new InferenceError("No base URL configured", "provider_error", providerId);
  const headers = isCliAdapter ? {} : await buildAuthHeaders(providerId, provider.authMethod, provider.authHeader);

  // 3. Dispatch to adapter (instrumented for Prometheus metrics)
  const adapter =
    selector !== null
      ? await resolveExecutionAdapter(selector, effectivePlan.capabilityRequirements)
      : getExecutionAdapter(executionAdapterRaw as string);
  const endTimer = aiInferenceDuration.startTimer({ provider: providerId, model: modelId, agent: "unknown" });
  const telemetryStartedAt = new Date();
  // Phase A7: telemetry kind derived from the structured selector when
  // present; legacy-string paths land as "legacy:<adapter>" so analytics can
  // distinguish unrouted traffic from structured-selector traffic.
  const telemetryAdapterKind =
    selector !== null
      ? selector.kind
      : `legacy:${typeof executionAdapterRaw === "string" ? executionAdapterRaw : "unknown"}`;
  // Admission gate: bound concurrent inference per engine so a fleet of
  // autonomous coworkers can't overload a scarce backend (local model ≈ 1-2
  // concurrent before latency collapses; remote = provider rate limit / cost).
  // Interactive turns take priority over autonomous/background work, so a human
  // waiting on a reply never queues behind a scheduled brief. Held only across
  // the actual inference call, released in `finally`. See inference-admission.ts.
  const engineKey = engineKeyForProvider(providerId);
  const releaseInferenceSlot = await acquireInferenceSlot(engineKey, currentInferenceOrigin(), {
    providerId,
    modelId,
  });
  let result;
  try {
    result = await adapter.execute({
      providerId,
      modelId,
      plan: effectivePlan,
      provider: { baseUrl, headers },
      fetchImpl: providerInferenceFetch,
      messages,
      systemPrompt,
      tools,
      previousResponseId,
      mcpSession,
    });
    endTimer();
  } catch (err) {
    endTimer();
    const errorType = err instanceof InferenceError ? err.code : "unknown";
    aiInferenceErrors.inc({ provider: providerId, error_type: errorType });
    // Phase A7: telemetry write before re-throw. Fire-and-forget — the writer
    // swallows its own errors so we never mask the original throw.
    const finishedAt = new Date();
    void writeAdapterTelemetry({
      traceId: attribution?.traceId ?? undefined,
      adapterKind: telemetryAdapterKind,
      adapterVersion: selector?.version ?? "unknown",
      providerId,
      modelId,
      executionMode: "single",
      startedAt: telemetryStartedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - telemetryStartedAt.getTime(),
      status: "error",
      errorClass: err instanceof InferenceError ? err.code : "unknown",
      httpStatus: err instanceof InferenceError ? err.statusCode : undefined,
      refusalReason: err instanceof InferenceError
        ? (err.rawBody ?? err.message)
        : (err instanceof Error ? err.message : undefined),
      agentId: attribution?.agentId ?? undefined,
      threadId: attribution?.threadId ?? undefined,
      buildId: attribution?.buildId ?? undefined,
      skillId: attribution?.skillId ?? undefined,
      agentMessageId: attribution?.agentMessageId ?? undefined,
    });
    if (err instanceof InferenceError && err.capacity) {
      void recordProviderCapacityStatus({
        providerId,
        classification: err.capacity,
        source: "api",
        rawSnippet: err.rawBody ?? err.message,
      }).catch((capacityErr) => {
        console.warn("[ai-inference] Failed to record provider capacity:", capacityErr);
      });
    }
    throw err;
  } finally {
    releaseInferenceSlot();
  }

  void clearProviderCapacityStatus({ providerId, source: "api" }).catch((capacityErr) => {
    console.warn("[ai-inference] Failed to clear provider capacity:", capacityErr);
  });

  // 4. Record token and cost metrics
  aiInferenceTokens.inc({ provider: providerId, model: modelId, direction: "input" }, result.usage.inputTokens);
  aiInferenceTokens.inc({ provider: providerId, model: modelId, direction: "output" }, result.usage.outputTokens);
  if (result.usage.cacheCreationInputTokens) {
    aiCacheCreationTokens.inc({ provider: providerId, model: modelId }, result.usage.cacheCreationInputTokens);
  }
  if (result.usage.cacheReadInputTokens) {
    aiCacheReadTokens.inc({ provider: providerId, model: modelId }, result.usage.cacheReadInputTokens);
  }

  // Phase A7: success-path telemetry row. Fire-and-forget so a DB outage
  // can't break the user's reply.
  const telemetryFinishedAt = new Date();
  void writeAdapterTelemetry({
    traceId: attribution?.traceId ?? undefined,
    adapterKind: telemetryAdapterKind,
    adapterVersion: selector?.version ?? "unknown",
    providerId,
    modelId,
    executionMode: "single",
    startedAt: telemetryStartedAt,
    finishedAt: telemetryFinishedAt,
    durationMs: telemetryFinishedAt.getTime() - telemetryStartedAt.getTime(),
    status: "success",
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    cacheCreationInputTokens: result.usage.cacheCreationInputTokens,
    toolCallsTotal: result.toolCalls.length,
    agentId: attribution?.agentId ?? undefined,
    threadId: attribution?.threadId ?? undefined,
    buildId: attribution?.buildId ?? undefined,
    skillId: attribution?.skillId ?? undefined,
    agentMessageId: attribution?.agentMessageId ?? undefined,
  });

  // 5. Map AdapterResult → InferenceResult
  return {
    content: result.text,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    inferenceMs: result.inferenceMs,
    ...(result.asyncOperation !== undefined && { asyncOperation: result.asyncOperation }),
    ...(result.toolCalls.length > 0 && { toolCalls: result.toolCalls }),
    responseId: result.responseId,
    truncated: result.truncated ?? false,
    // Adapters may set result.raw (e.g. transcription adapter for Whisper
    // verbose_json segments). Passed through verbatim; undefined when absent.
    ...(result.raw !== undefined && { raw: result.raw }),
  };
}

// ─── Token Usage Logging ─────────────────────────────────────────────────────

export async function logTokenUsage(input: {
  traceId?: string | null;
  agentId: string;
  providerId: string;
  contextKey: string;
  inputTokens: number;
  outputTokens: number;
  inferenceMs?: number;
}): Promise<void> {
  const provider = await prisma.modelProvider.findUnique({ where: { providerId: input.providerId } });

  let costUsd = 0;
  if (provider) {
    if (provider.costModel === "compute" && input.inferenceMs !== undefined) {
      costUsd = computeComputeCost(
        input.inferenceMs,
        provider.computeWatts ?? 150,
        provider.electricityRateKwh ?? 0.12,
      );
    } else if (provider.costModel === "token") {
      costUsd = computeTokenCost(
        input.inputTokens,
        input.outputTokens,
        provider.inputPricePerMToken ?? 0,
        provider.outputPricePerMToken ?? 0,
      );
    }
  }
  // Record cost metric for Prometheus
  if (costUsd > 0) {
    aiInferenceCostUsd.inc({ provider: input.providerId }, costUsd);
  }

  await prisma.tokenUsage.create({
    data: {
      traceId:      input.traceId ?? null,
      agentId:      input.agentId,
      providerId:   input.providerId,
      contextKey:   input.contextKey,
      inputTokens:  input.inputTokens,
      outputTokens: input.outputTokens,
      ...(input.inferenceMs !== undefined && { inferenceMs: input.inferenceMs }),
      costUsd,
    },
  });
}
