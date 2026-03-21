/**
 * EP-INF-006: Recipe performance aggregation.
 * Maintains running averages and EWMA reward for each recipe+contractFamily
 * pair. Fires promotion evaluation every 50 samples.
 *
 * See: docs/superpowers/specs/2026-03-18-ai-routing-and-profiling-design.md
 */

import { prisma } from "@dpf/db";

// ── Lazy import to break circular dependency ─────────────────────────────────

let _evaluatePromotions: ((contractFamily: string) => Promise<void>) | null = null;

async function getEvaluatePromotions() {
  if (!_evaluatePromotions) {
    const mod = await import("./champion-challenger");
    _evaluatePromotions = mod.evaluatePromotions;
  }
  return _evaluatePromotions;
}

// ── Constants ────────────────────────────────────────────────────────────────

const EWMA_ALPHA = 0.7;
const EVALUATION_INTERVAL = 50;

// ── Types ────────────────────────────────────────────────────────────────────

export interface PerformanceOutcome {
  latencyMs: number;
  costUsd: number | null;
  reward: number;
  schemaValid: boolean | null;
  toolSuccess: boolean | null;
  isSuccess: boolean;
}

// ── updateRecipePerformance ──────────────────────────────────────────────────

/**
 * Upsert a RecipePerformance row with running averages and EWMA reward.
 *
 * Fire-and-forget: catches all errors internally.
 */
export async function updateRecipePerformance(
  recipeId: string,
  contractFamily: string,
  outcome: PerformanceOutcome,
): Promise<void> {
  try {
    const existing = await prisma.recipePerformance.findUnique({
      where: { recipeId_contractFamily: { recipeId, contractFamily } },
    });

    if (!existing) {
      // ── First observation: initialize ──────────────────────────────────
      await prisma.recipePerformance.create({
        data: {
          recipeId,
          contractFamily,
          sampleCount: 1,
          successCount: outcome.isSuccess ? 1 : 0,
          avgLatencyMs: outcome.latencyMs,
          avgCostUsd: outcome.costUsd ?? 0,
          avgSchemaValidRate: outcome.schemaValid !== null ? (outcome.schemaValid ? 1 : 0) : null,
          avgToolSuccessRate: outcome.toolSuccess !== null ? (outcome.toolSuccess ? 1 : 0) : null,
          ewmaReward: outcome.reward,
          lastObservedAt: new Date(),
        },
      });

      // sampleCount is 1, never a multiple of 50
      return;
    }

    // ── Incremental update ─────────────────────────────────────────────
    const oldCount = existing.sampleCount;
    const newCount = oldCount + 1;

    const avgLatencyMs = ((existing.avgLatencyMs * oldCount) + outcome.latencyMs) / newCount;
    const avgCostUsd = ((existing.avgCostUsd * oldCount) + (outcome.costUsd ?? 0)) / newCount;

    // Boolean rates: skip update when value is null
    let avgSchemaValidRate = existing.avgSchemaValidRate;
    if (outcome.schemaValid !== null) {
      const oldRate = existing.avgSchemaValidRate ?? 0;
      const oldRateCount = existing.avgSchemaValidRate !== null ? oldCount : 0;
      avgSchemaValidRate = ((oldRate * oldRateCount) + (outcome.schemaValid ? 1 : 0)) / (oldRateCount + 1);
    }

    let avgToolSuccessRate = existing.avgToolSuccessRate;
    if (outcome.toolSuccess !== null) {
      const oldRate = existing.avgToolSuccessRate ?? 0;
      const oldRateCount = existing.avgToolSuccessRate !== null ? oldCount : 0;
      avgToolSuccessRate = ((oldRate * oldRateCount) + (outcome.toolSuccess ? 1 : 0)) / (oldRateCount + 1);
    }

    // EWMA: newEwma = alpha * current + (1 - alpha) * old
    const ewmaReward = EWMA_ALPHA * outcome.reward + (1 - EWMA_ALPHA) * existing.ewmaReward;

    await prisma.recipePerformance.update({
      where: { recipeId_contractFamily: { recipeId, contractFamily } },
      data: {
        sampleCount: newCount,
        successCount: existing.successCount + (outcome.isSuccess ? 1 : 0),
        avgLatencyMs,
        avgCostUsd,
        avgSchemaValidRate,
        avgToolSuccessRate,
        ewmaReward,
        lastObservedAt: new Date(),
      },
    });

    // ── Trigger promotion evaluation every N samples ─────────────────
    if (newCount % EVALUATION_INTERVAL === 0) {
      const evaluate = await getEvaluatePromotions();
      evaluate(contractFamily).catch(() => {
        // fire-and-forget
      });
    }
  } catch {
    // Fire-and-forget — swallow all errors
  }
}
