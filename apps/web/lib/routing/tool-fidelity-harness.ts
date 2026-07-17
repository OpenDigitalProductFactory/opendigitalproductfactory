// apps/web/lib/routing/tool-fidelity-harness.ts
//
// EP-E431FC8A Phase 2 (BI-DF3092F4). Measures a model's tool-SELECTION accuracy
// at different attached-surface sizes against a golden set of evidence-required
// prompts (one known-correct authoritative tool per prompt). The resulting curve
// locates THIS model's empirical selection cliff, replacing the assumed ~15.
//
// Inference is INJECTED (`runTurn`) so the pure scorer unit-tests without a live
// model; the operator-facing runner (scripts/eval-tool-fidelity.mjs) wires the
// real routed inference. Emits ToolFidelitySample[] to store in
// ModelProfile.customScores (via tool-fidelity-policy).

import { TASK_CLASSES } from "@/lib/tak/intent-taxonomy";
import { mergeToolFidelitySample, type ToolFidelitySample } from "./tool-fidelity-policy";

export interface GoldenCase {
  taskClass: string;
  prompt: string;
  /** Any of these tools is a correct selection for the prompt. */
  correctToolNames: readonly string[];
}

/**
 * A small golden set derived from the task-class taxonomy: for each class, a few
 * live-state prompts whose correct answer is one of the class's authoritative
 * tools. Kept in-repo so the curve is reproducible; extend as classes are added.
 */
export const GOLDEN_CASES: readonly GoldenCase[] = TASK_CLASSES.flatMap((def) => {
  const prompts: Record<string, string[]> = {
    "backlog-status": [
      "have the pressing issues been resolved?",
      "how many backlog items are still open?",
      "what's the current status of the backlog?",
    ],
    "provider-health": [
      "is the local model provider healthy right now?",
      "which model will run the next build phase?",
      "are any AI endpoints offline?",
    ],
    "capsule-status": [
      "what phase is the current build in?",
      "how far along is this work capsule?",
      "is the build making progress?",
    ],
  };
  return (prompts[def.taskClass] ?? []).map((prompt) => ({
    taskClass: def.taskClass,
    prompt,
    correctToolNames: def.authoritativeToolNames,
  }));
});

export type RunTurnFn = (input: {
  prompt: string;
  surfaceSize: number;
  taskClass: string;
}) => Promise<{ calledTool: string | null }>;

/**
 * Run the golden set at each surface size and score selection accuracy. A turn
 * is correct when the model's FIRST tool call is one of the case's correct
 * tools; a wrong tool or no tool call is incorrect. Returns one merged sample
 * per surface size. Pure aside from the injected `runTurn`.
 */
export async function measureToolFidelity(params: {
  surfaceSizes: readonly number[];
  runTurn: RunTurnFn;
  cases?: readonly GoldenCase[];
}): Promise<ToolFidelitySample[]> {
  const cases = params.cases ?? GOLDEN_CASES;
  let samples: ToolFidelitySample[] = [];
  for (const surfaceSize of params.surfaceSizes) {
    if (cases.length === 0) continue;
    let correct = 0;
    for (const c of cases) {
      const { calledTool } = await params.runTurn({ prompt: c.prompt, surfaceSize, taskClass: c.taskClass });
      if (calledTool && c.correctToolNames.includes(calledTool)) correct += 1;
    }
    const accuracy = correct / cases.length;
    samples = mergeToolFidelitySample(samples, surfaceSize, accuracy, cases.length);
  }
  return samples;
}
