import { routeAndCall } from "@/lib/inference/routed-inference";
import { CHANGE_REVIEWER_ROUTE_AGENT } from "@/lib/tak/change-reviewer-route";
import { parseSemanticReviewResponse, type SemanticReviewResult } from "./semantic-change-review";
import { semanticReviewMinimumContextTokens } from "./semantic-review-context-floor";
import type { SemanticChangeReviewDispatchContext } from "./semantic-change-review-operation";

const SPECIALIST_SYSTEM_PROMPTS: Record<string, string> = {
  "AGT-903": "You are the UX Accessibility specialist. Review only accessibility and interaction risks grounded in the supplied committed diff.",
  "AGT-902": "You are the Data Governance specialist. Review only data-model, migration, privacy, retention, and governance risks grounded in the supplied committed diff.",
  "AGT-131": "You are the SBOM Management specialist. Review only dependency, provenance, license, and software-supply-chain risks grounded in the supplied committed diff.",
  "AGT-181": "You are the Architecture Guardrail specialist. Review only architectural alignment and boundary risks grounded in the supplied committed diff.",
};

function mergeReviewResults(results: SemanticReviewResult[]): SemanticReviewResult {
  const issues = results.flatMap((result) => result.issues);
  const criticals = issues.filter((issue) => issue.severity === "critical").length;
  const inconclusive = results.filter((result) => result.decision === "inconclusive");
  return {
    decision: inconclusive.length > 0 ? "inconclusive" : criticals > 0 ? "fail" : "pass",
    issues,
    summary: inconclusive.length > 0
      ? `${inconclusive.length} required semantic review branch${inconclusive.length === 1 ? " was" : "es were"} infrastructure-inconclusive; retry without treating capacity as a semantic finding.`
      : results.length === 1
      ? results[0]!.summary
      : `${results.length} independent review branches completed; ${criticals} blocking finding${criticals === 1 ? "" : "s"}.`,
    ...(results.some((result) => result.parseError) ? { parseError: true as const } : {}),
    ...(inconclusive.length > 0
      ? { inconclusiveReason: inconclusive.map((result) => result.inconclusiveReason ?? "review-branch-incomplete").join(",") }
      : {}),
  };
}

/** Execute the governed Change Reviewer plus content-scoped specialist branches. */
export async function dispatchRoutedSemanticReview(
  prompt: string,
  context: SemanticChangeReviewDispatchContext,
): Promise<SemanticReviewResult> {
  // Capacity belongs to the actual provider dispatch, including every fallback
  // through callProvider. A local reservation must not veto an eligible remote
  // review before routing has selected its provider.
  const branches = [
    {
      agentId: "change-reviewer",
      displayName: "Change Reviewer",
      systemPrompt: CHANGE_REVIEWER_ROUTE_AGENT.systemPrompt,
    },
    ...context.specialistIds.flatMap((agentId) => {
      const systemPrompt = SPECIALIST_SYSTEM_PROMPTS[agentId];
      return systemPrompt ? [{ agentId, displayName: agentId, systemPrompt }] : [];
    }),
  ];

  const settled = await Promise.allSettled(branches.map(async (branch) => {
    const response = await routeAndCall(
      [{ role: "user", content: prompt }],
      branch.systemPrompt,
      // Ordinary platform development is internal. The shared screener still
      // classifies the full payload and enforces export/clearance obligations.
      "internal",
      {
        taskType: "build-review",
        budgetClass: context.strategyProfile === "economy" ? "balanced" : "quality_first",
        modelTier: "robust",
        // BI-47ACE2C7: this call attaches no tools, so it must not assert a
        // caller-level tool-use requirement — that excluded the long-context
        // route purely on its `supportsToolUse=false` profile. `routeAndCall`
        // still infers the requirement from `options.tools`, so a future
        // tool-bearing review is unaffected. The context floor is likewise
        // derived from the request actually sent rather than an unrelated flat
        // 32,000, which excluded the local 24,576-token reviewer.
        agentMinimumContextTokens: semanticReviewMinimumContextTokens({
          systemPrompt: branch.systemPrompt,
          userPrompt: prompt,
        }),
        agentId: branch.agentId,
        agentDisplayName: branch.displayName,
        effort: context.strategyProfile === "document-authority" ? "max" : "high",
        interactionMode: "sync",
      },
    );
    return parseSemanticReviewResponse(response.content);
  }));

  const completed = settled.flatMap((branch) => branch.status === "fulfilled" ? [branch.value] : []);
  const rejected = settled.filter((branch) => branch.status === "rejected").length;
  if (rejected > 0) {
    completed.push({
      decision: "inconclusive",
      issues: [],
      summary: `${rejected} required semantic review branch${rejected === 1 ? "" : "es"} did not complete.`,
      inconclusiveReason: "review-branch-capacity-or-transport-failure",
    });
  }
  return mergeReviewResults(completed);
}
