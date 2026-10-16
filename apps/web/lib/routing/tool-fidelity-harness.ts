// apps/web/lib/routing/tool-fidelity-harness.ts
//
// EP-E431FC8A Phase 2 (BI-DF3092F4). Measures a model's tool-SELECTION accuracy
// at different attached-surface sizes against a golden set of evidence-required
// prompts (one known-correct authoritative tool per prompt). The resulting curve
// locates THIS model's empirical selection cliff, replacing the assumed ~15.
//
// Inference is INJECTED (`runTurn`) so the pure scorer unit-tests without a live
// model; operate/tool-fidelity-runner.ts composes the existing run_endpoint_tests
// diagnostic mode with real local inference and governed-read observations.
// The legacy pure scorer emits ToolFidelitySample[] to store in
// ModelProfile.customScores (via tool-fidelity-policy).

import { TASK_CLASSES } from "@/lib/tak/intent-taxonomy";
import { fromJSONSchema } from "zod";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { isRecord } from "@/lib/shared/coerce";
import type { ToolDefinition, ToolResult } from "@/lib/mcp-tool-types";
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

/** Pure scoring only: neither this result nor injected fixtures prove live execution. */
export function scoreToolFidelitySelection(
  golden: GoldenCase, attached: readonly ToolDefinition[], result: {
    content?: string; truncated?: boolean; finishReason?: string;
    toolCalls?: Array<{ name: string; arguments: unknown }>;
  },
): { status: "passed" | "failed" | "incomplete"; call?: { name: string; arguments: Record<string, unknown> } } {
  if (result.truncated === true || !["stop", "tool_calls", "function_call"].includes(result.finishReason ?? "")) {
    return { status: "incomplete" };
  }
  const call = result.toolCalls?.[0];
  const tool = attached.find(candidate => candidate.name === call?.name);
  if (!call || !tool || tool.sideEffect !== false || tool.consequence || tool.consequenceForCall
    || !golden.correctToolNames.includes(call.name) || !isRecord(call.arguments)) return { status: "failed" };
  try {
    if (!fromJSONSchema(tool.inputSchema).safeParse(call.arguments).success) return { status: "failed" };
  } catch { return { status: "incomplete" }; }
  return { status: "passed", call: { name: call.name, arguments: call.arguments } };
}

export type FidelityExecutionExpectation = {
  toolName: string; parameters: Record<string, unknown>; userId: string;
  agentId: string; threadId: string; taskRunId: string | null;
};

/** Exact persisted identity, not time-window correlation or model/handler claims. */
export function scoreToolFidelityExecution(
  expected: FidelityExecutionExpectation, executionId: string | undefined, row: unknown,
  invocationResult?: Pick<ToolResult, "success" | "data">,
): boolean {
  if (!executionId || !isRecord(row) || row.id !== executionId || row.success !== true
    || typeof row.durationMs !== "number" || !Number.isFinite(row.durationMs) || row.durationMs < 0
    || !isRecord(row.result)
    || (isRecord(row.result.data) && row.result.data.status === "proposed")) return false;
  if (row.userId !== expected.userId || row.agentId !== expected.agentId || row.threadId !== expected.threadId
    || row.taskRunId !== expected.taskRunId || row.toolName !== expected.toolName) return false;
  // The ID comes directly from our original governedDispatch, never a lookup or
  // caller-supplied claim. Metrics-only retention intentionally drops plaintext
  // arguments; it does not unbind that exact invocation from its validated input.
  if (row.auditClass === "metrics_only") {
    if (invocationResult?.success !== true || invocationResult.data?.status === "proposed" || row.result.error) return false;
    if (isRecord(row.parameters) && Object.keys(row.parameters).length === 0) return true;
  } else if (row.result.success !== true) return false;
  try { return canonicalJson(row.parameters) === canonicalJson(expected.parameters); }
  catch { return false; }
}
