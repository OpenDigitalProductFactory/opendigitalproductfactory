/**
 * Task-type → capability-dimension mapping.
 *
 * Extracted from production-feedback.ts (BI-6F42465E) into a pure, prisma-free
 * module so both the production-feedback accumulator AND the golden-test
 * archetype grouping can share one source of truth for "which dimensions
 * matter for this kind of task." production-feedback.ts re-exports these for
 * backward compatibility.
 */
import type { BuiltinDimension } from "./types";

export interface DimensionMapping {
  dimension: BuiltinDimension;
  weight: number; // 1.0 for primary, 0.5 for secondary
}

export const TASK_DIMENSION_MAP: Record<string, DimensionMapping[]> = {
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

/** The task types with a declared dimension mapping. */
export const KNOWN_TASK_TYPES: string[] = Object.keys(TASK_DIMENSION_MAP);

/** Get the dimension mappings for a task type. Returns empty for unknown. */
export function getDimensionsForTask(taskType: string): DimensionMapping[] {
  if (!taskType) return [];
  return TASK_DIMENSION_MAP[taskType] ?? [];
}

/** Compute the dimension delta from an orchestrator score (1-5). */
export function computeObservationDelta(orchestratorScore: number): number {
  return (orchestratorScore - 3) * 4;
}
