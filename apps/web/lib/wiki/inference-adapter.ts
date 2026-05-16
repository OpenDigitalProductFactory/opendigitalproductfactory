// EP-WIKI-001 Phase 2.3b: production inference adapter for the wiki
// proposal pipeline.
// Spec: docs/superpowers/specs/2026-05-09-platform-kernel-wiki-design.md §6
// Plan: docs/superpowers/plans/2026-05-09-platform-kernel-wiki.md (Phase 2.3)
//
// Phase 2.2 ships `proposeWikiDiff()` with a dependency-injected
// `InferenceCallable` so the engine is testable without inference
// providers. This module supplies the production adapter that hooks the
// engine up to DPF's existing inference seam:
//   - utility-tier (pass 1 abstract) → `utilityInfer({ task: "generate_abstract" })`
//   - reasoning-tier (passes 2 + 3) → `routeAndCall(...)` with `budgetClass: "quality_first"`
//
// The adapter is the only place where the engine touches the inference
// provider catalog; everything else stays pure. Tests of the wider
// pipeline mock this module to keep `routed-inference` out of the unit
// surface; portal smokes call it directly.

import type {
  InferenceCallable,
  InferenceRequest,
} from "./proposal";

// ─── Module signature ───────────────────────────────────────────────────────

/**
 * Build a production `InferenceCallable` bound to DPF's routed inference
 * seam. The returned function is what callers pass to `proposeWikiDiff`.
 *
 * The async imports are lazy so importing this module never triggers the
 * inference-provider catalog load — important for build-time route-
 * manifest generation, which would otherwise touch Prisma during the
 * static analysis pass.
 */
export function createProductionInference(options: {
  /** Override the routed-call task type tag. Default: "wiki_proposal". */
  taskType?: string;
  /**
   * When set, the adapter passes this as the `agentId` on the routed call
   * so per-agent capability gates and cost attribution wire through.
   */
  agentId?: string | null;
  /**
   * Per-request timeout hint passed through to `routeAndCall`. Default is
   * the routed-call default (model-class dependent).
   */
  timeoutMs?: number;
} = {}): InferenceCallable {
  return async (request: InferenceRequest): Promise<string> => {
    if (request.tier === "utility") {
      return runUtility(request);
    }
    return runReasoning(request, options);
  };
}

// ─── Utility tier (pass 1 — abstract) ───────────────────────────────────────

async function runUtility(request: InferenceRequest): Promise<string> {
  // Pass 1 expects a one-paragraph abstract. `utilityInfer` has a built-in
  // `generate_abstract` task with the right prompt shape; we override the
  // system prompt to match the engine's expectation that the model produce
  // 2-4 sentences under 80 words rather than utility-tier's default
  // one-line summary.
  const { utilityInfer } = await import("@/lib/inference/utility-inference");
  const result = await utilityInfer({
    task: "summarize",
    input: `${request.systemPrompt}\n\n${request.userPrompt}`,
  });
  return result.output;
}

// ─── Reasoning tier (passes 2 + 3 — extraction) ────────────────────────────

async function runReasoning(
  request: InferenceRequest,
  options: { taskType?: string; agentId?: string | null; timeoutMs?: number },
): Promise<string> {
  const { routeAndCall } = await import("@/lib/inference/routed-inference");
  const taskType = options.taskType ?? "wiki_proposal";
  const result = await routeAndCall(
    [
      { role: "system", content: request.systemPrompt },
      { role: "user", content: request.userPrompt },
    ],
    request.systemPrompt,
    "internal",
    {
      taskType,
      budgetClass: "quality_first",
      persistDecision: false,
    },
  );
  return result.content;
}
