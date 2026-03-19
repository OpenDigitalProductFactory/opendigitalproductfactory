/**
 * EP-INF-001-P6: Production observation feedback.
 * Maps orchestrator scores from real conversations to dimension nudges.
 * Two-stage: accumulate in EndpointTaskPerformance.dimensionScores,
 * propagate to ModelProvider once threshold is met.
 */
import { prisma } from "@dpf/db";
import type { BuiltinDimension } from "./types";

// ── Task-to-Dimension Mapping ────────────────────────────────────────────────

interface DimensionMapping {
  dimension: BuiltinDimension;
  weight: number; // 1.0 for primary, 0.5 for secondary
}

const TASK_DIMENSION_MAP: Record<string, DimensionMapping[]> = {
  "reasoning":       [{ dimension: "reasoning", weight: 1.0 }],
  "code-gen":        [{ dimension: "codegen", weight: 1.0 }, { dimension: "instructionFollowing", weight: 0.5 }],
  "tool-action":     [{ dimension: "toolFidelity", weight: 1.0 }],
  "data-extraction": [{ dimension: "structuredOutput", weight: 1.0 }],
  "summarization":   [{ dimension: "instructionFollowing", weight: 1.0 }],
  "greeting":        [{ dimension: "conversational", weight: 1.0 }],
  "creative":        [{ dimension: "conversational", weight: 1.0 }, { dimension: "reasoning", weight: 0.5 }],
  "web-search":      [{ dimension: "toolFidelity", weight: 1.0 }],
  "status-query":    [{ dimension: "instructionFollowing", weight: 1.0 }],
};

/** Get the dimension mappings for a task type. Returns empty for unknown. */
export function getDimensionsForTask(taskType: string): DimensionMapping[] {
  if (!taskType) return [];
  return TASK_DIMENSION_MAP[taskType] ?? [];
}

/** Compute the dimension delta from an orchestrator score (1-5). */
export function computeObservationDelta(orchestratorScore: number): number {
  return (orchestratorScore - 3) * 4;
}

// ── Accumulation & Propagation ───────────────────────────────────────────────

const PROPAGATION_THRESHOLD = 5;

interface DimensionTally {
  count: number;
  totalDelta: number;
}

/**
 * Update endpoint dimension scores based on a production observation.
 * Called from orchestrator-evaluator after every conversation scoring.
 *
 * Two-stage flow:
 * 1. Accumulate per-task-type deltas in EndpointTaskPerformance.dimensionScores
 * 2. When a dimension's total count across all task types reaches threshold,
 *    propagate the average delta to ModelProvider
 */
export async function updateEndpointDimensionScores(
  endpointId: string,
  taskType: string,
  orchestratorScore: number,
): Promise<void> {
  const mappings = getDimensionsForTask(taskType);
  if (mappings.length === 0) return;

  const baseDelta = computeObservationDelta(orchestratorScore);

  // Load current tally for this task type (may not exist yet)
  const existing = await prisma.endpointTaskPerformance.findUnique({
    where: { endpointId_taskType: { endpointId, taskType } },
    select: { dimensionScores: true },
  });

  const currentDimScores: Record<string, DimensionTally> =
    (existing?.dimensionScores as Record<string, DimensionTally>) ?? {};

  // Accumulate deltas
  for (const { dimension, weight } of mappings) {
    const delta = Math.round(baseDelta * weight);
    const tally = currentDimScores[dimension] ?? { count: 0, totalDelta: 0 };
    tally.count += 1;
    tally.totalDelta += delta;
    currentDimScores[dimension] = tally;
  }

  // Upsert EndpointTaskPerformance (creates record if first observation for this task type)
  await prisma.endpointTaskPerformance.upsert({
    where: { endpointId_taskType: { endpointId, taskType } },
    update: { dimensionScores: currentDimScores },
    create: {
      endpointId,
      taskType,
      dimensionScores: currentDimScores,
    },
  });

  // Check propagation threshold across ALL task types for this endpoint
  const allPerfs = await prisma.endpointTaskPerformance.findMany({
    where: { endpointId },
    select: { id: true, dimensionScores: true },
  });

  // Aggregate tallies across all task types
  const aggregated: Record<string, DimensionTally> = {};
  for (const p of allPerfs) {
    const scores = (p.dimensionScores as Record<string, DimensionTally>) ?? {};
    for (const [dim, tally] of Object.entries(scores)) {
      if (!aggregated[dim]) aggregated[dim] = { count: 0, totalDelta: 0 };
      aggregated[dim].count += tally.count;
      aggregated[dim].totalDelta += tally.totalDelta;
    }
  }

  // Propagate dimensions that have reached the threshold
  const updates: Record<string, number> = {};
  const resetDimensions: string[] = [];

  const providerFull = await prisma.modelProvider.findUnique({
    where: { providerId: endpointId },
  });
  if (!providerFull) return;

  // Only propagate if profileSource is "seed" — don't downgrade "evaluated"
  const canPropagate = providerFull.profileSource === "seed";

  for (const [dim, tally] of Object.entries(aggregated)) {
    if (tally.count >= PROPAGATION_THRESHOLD && canPropagate) {
      const avgDelta = Math.round(tally.totalDelta / tally.count);
      const currentScore = (providerFull as Record<string, unknown>)[dim] as number ?? 50;
      updates[dim] = Math.min(100, Math.max(0, currentScore + avgDelta));
      resetDimensions.push(dim);
    }
  }

  if (Object.keys(updates).length > 0) {
    await prisma.modelProvider.update({
      where: { providerId: endpointId },
      data: {
        ...updates,
        profileSource: "production",
      },
    });

    // Reset tallies for propagated dimensions across all task types
    for (const p of allPerfs) {
      const scores = (p.dimensionScores as Record<string, DimensionTally>) ?? {};
      let changed = false;
      for (const dim of resetDimensions) {
        if (scores[dim]) {
          delete scores[dim];
          changed = true;
        }
      }
      if (changed) {
        await prisma.endpointTaskPerformance.update({
          where: { id: p.id },
          data: { dimensionScores: scores },
        });
      }
    }
  }
}
