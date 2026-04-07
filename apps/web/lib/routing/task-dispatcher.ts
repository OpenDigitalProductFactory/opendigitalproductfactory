/**
 * EP-INF-012: Task dispatcher — executes a TaskRouteDecision with fallback chain.
 *
 * Calls callProvider from @/lib/ai-inference, handles InferenceError codes to
 * update provider status in the DB, and persists a RouteDecisionLog audit entry.
 */

import { prisma } from "@dpf/db";
import type { TaskRouteDecision, CandidateTrace } from "./task-router-types";
import {
  callProvider,
  logTokenUsage,
  InferenceError,
  type ChatMessage,
} from "@/lib/ai-inference";
// ── Types ─────────────────────────────────────────────────────────────────────

/** The payload passed to callProvider for each attempt. */
export interface ProviderCallPayload {
  modelId: string;
  messages: ChatMessage[];
  systemPrompt: string;
  tools?: Array<Record<string, unknown>>;
}

/** Context forwarded from the agent call site for logging. */
export interface DispatchContext {
  agentId: string;
  agentMessageId?: string;
  shadowMode?: boolean;
}

// ── Custom error ──────────────────────────────────────────────────────────────

/**
 * Thrown when every endpoint in the fallback chain has failed.
 * Includes the final routing decision for debugging.
 */
export class NoEndpointAvailableError extends Error {
  public decision: TaskRouteDecision;
  constructor(message: string, decision: TaskRouteDecision) {
    super(message);
    this.name = "NoEndpointAvailableError";
    this.decision = decision;
  }
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

/**
 * Executes an AI call based on a routing decision, walking the fallback chain
 * on transient failures and updating provider status on hard failures.
 *
 * @throws {NoEndpointAvailableError} if every endpoint in the chain fails.
 */
export async function callWithFallbackChain(
  decision: TaskRouteDecision,
  payload: ProviderCallPayload,
  context: DispatchContext,
) {
  const endpointIds = [decision.selectedEndpointId, ...decision.fallbackChain].filter(
    (id): id is string => id !== null,
  );

  const fallbacksUsed: { endpointId: string; error: string; timestamp: string }[] = [];

  for (const endpointId of endpointIds) {
    const candidate = decision.candidates.find((c) => c.endpointId === endpointId);
    if (!candidate) continue; // should never happen — defensive

    try {
      const result = await callProvider(
        candidate.providerId,
        payload.modelId || candidate.modelId,
        payload.messages,
        payload.systemPrompt,
        payload.tools,
      );

      const finalDecision: TaskRouteDecision = {
        ...decision,
        selectedEndpointId: endpointId,
        selectedProviderId: candidate.providerId,
        selectedModelId: candidate.modelId,
        reason:
          fallbacksUsed.length > 0
            ? `Success via fallback to ${candidate.endpointName}. Original reason: ${decision.reason}`
            : decision.reason,
      };

      await persistDecision(finalDecision, candidate, context, fallbacksUsed);

      await logTokenUsage({
        agentId: context.agentId,
        providerId: candidate.providerId,
        contextKey: context.agentMessageId ?? "task-router",
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        inferenceMs: result.inferenceMs,
      });

      return result;
    } catch (error) {
      fallbacksUsed.push({
        endpointId,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });

      if (error instanceof InferenceError) {
        switch (error.code) {
          case "rate_limit":
            await prisma.modelProvider.update({
              where: { providerId: candidate.providerId },
              data: { status: "degraded" },
            });
            break;
          case "auth":
          case "model_not_found":
            await prisma.modelProvider.update({
              where: { providerId: candidate.providerId },
              data: { status: "disabled" },
            });
            break;
        }
      }
      // Continue to next endpoint in chain
    }
  }

  // All endpoints failed — persist the failure log and throw.
  const failedDecision: TaskRouteDecision = {
    ...decision,
    selectedEndpointId: null,
    selectedProviderId: null,
    selectedModelId: null,
  };
  await persistDecision(failedDecision, null, context, fallbacksUsed);
  throw new NoEndpointAvailableError(
    `All ${endpointIds.length} endpoint(s) in the chain failed.`,
    failedDecision,
  );
}

// ── Persistence ───────────────────────────────────────────────────────────────

async function persistDecision(
  decision: TaskRouteDecision,
  selectedCandidate: CandidateTrace | null,
  context: DispatchContext,
  fallbacksUsed: { endpointId: string; error: string; timestamp: string }[],
) {
  return prisma.routeDecisionLog.create({
    data: {
      agentMessageId: context.agentMessageId,
      // Schema requires selectedEndpointId String (not nullable).
      // Use empty string as sentinel when all endpoints failed.
      selectedEndpointId: selectedCandidate?.endpointId ?? "",
      taskType: decision.taskType,
      sensitivity: decision.sensitivity,
      reason: decision.reason,
      fitnessScore: selectedCandidate?.fitnessScore ?? 0,
      candidateTrace: JSON.stringify(decision.candidates.filter((c) => !c.excluded)),
      excludedTrace: JSON.stringify(decision.candidates.filter((c) => c.excluded)),
      policyRulesApplied: decision.policyRulesApplied,
      fallbackChain: decision.fallbackChain,
      fallbacksUsed: JSON.stringify(fallbacksUsed),
      shadowMode: context.shadowMode ?? false,
      selectedModelId: selectedCandidate?.modelId ?? null,
    },
  });
}
