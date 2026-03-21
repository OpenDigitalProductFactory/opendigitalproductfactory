/**
 * EP-INF-006: Route outcome recording.
 * Fire-and-forget insertion of RouteOutcome rows and optional
 * recipe-performance update when a recipeId is present.
 *
 * See: docs/superpowers/specs/2026-03-18-ai-routing-and-profiling-design.md
 */

import { randomUUID } from "crypto";
import { prisma } from "@dpf/db";
import { computeReward } from "./reward";
import { updateRecipePerformance } from "./recipe-performance";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RouteOutcomeInput {
  providerId: string;
  modelId: string;
  recipeId: string | null;
  contractFamily: string;
  taskType: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  schemaValid: boolean | null;
  toolSuccess: boolean | null;
  fallbackOccurred: boolean;
  providerErrorCode?: string;
}

// ── recordRouteOutcome ────────────────────────────────────────────────────────

/**
 * Record a routing outcome and optionally update recipe performance.
 *
 * This function is fire-and-forget: it catches all errors internally
 * and never throws. Callers can safely call it without await if they
 * do not need to wait for the write to complete.
 */
export async function recordRouteOutcome(outcome: RouteOutcomeInput): Promise<void> {
  try {
    const requestId = randomUUID();

    await prisma.routeOutcome.create({
      data: {
        requestId,
        providerId: outcome.providerId,
        modelId: outcome.modelId,
        recipeId: outcome.recipeId,
        contractFamily: outcome.contractFamily,
        taskType: outcome.taskType,
        latencyMs: outcome.latencyMs,
        inputTokens: outcome.inputTokens,
        outputTokens: outcome.outputTokens,
        costUsd: outcome.costUsd,
        schemaValid: outcome.schemaValid,
        toolSuccess: outcome.toolSuccess,
        fallbackOccurred: outcome.fallbackOccurred,
        providerErrorCode: outcome.providerErrorCode ?? null,
      },
    });

    if (outcome.recipeId !== null) {
      const reward = computeReward({
        graderScore: null,
        humanScore: null,
        schemaValid: outcome.schemaValid,
        toolSuccess: outcome.toolSuccess,
        latencyMs: outcome.latencyMs,
        costUsd: outcome.costUsd,
        providerErrorCode: outcome.providerErrorCode ?? null,
      });

      const isSuccess =
        outcome.providerErrorCode === undefined ||
        outcome.providerErrorCode === null ||
        outcome.providerErrorCode === "";

      await updateRecipePerformance(outcome.recipeId, outcome.contractFamily, {
        latencyMs: outcome.latencyMs,
        costUsd: outcome.costUsd,
        reward,
        schemaValid: outcome.schemaValid,
        toolSuccess: outcome.toolSuccess,
        isSuccess,
      });
    }
  } catch {
    // Fire-and-forget — swallow all errors
  }
}
