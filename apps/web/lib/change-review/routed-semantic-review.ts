import { routeAndCall } from "@/lib/inference/routed-inference";
import { inspectLocalProviderCapacity } from "@/lib/routing/local-provider-capacity";
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

async function localCiCapacityGuard(): Promise<SemanticReviewResult | null> {
  const capacity = await inspectLocalProviderCapacity();
  if (capacity.available) return null;
  if (capacity.reason === "local-ci-active-capacity-reservation") {
    return {
      decision: "inconclusive",
      issues: [],
      summary: "Semantic review deferred while governed local CI owns host capacity.",
      inconclusiveReason: "local-ci-active-capacity-reservation",
    };
  }
  if (capacity.reason === "local-ci-queued-capacity-reservation") {
    return {
      decision: "inconclusive",
      issues: [],
      summary: "Semantic review deferred so the established local-CI queue can claim the next safe host window.",
      inconclusiveReason: "local-ci-queued-capacity-reservation",
    };
  }
  return {
    decision: "inconclusive",
    issues: [],
    summary: "Semantic review deferred because host-capacity ownership could not be verified.",
    inconclusiveReason: "local-ci-capacity-reservation-unavailable",
  };
}

/** Execute the governed Change Reviewer plus content-scoped specialist branches. */
export async function dispatchRoutedSemanticReview(
  prompt: string,
  context: SemanticChangeReviewDispatchContext,
): Promise<SemanticReviewResult> {
  // Local-CI admission already accounts for a model that is resident before
  // the lease is bound. Protect the opposite ordering too: once local CI owns
  // the host, no semantic-review route may begin because a remote route can
  // still fall back to the bundled 32k-context model after dispatch. Returning
  // an infrastructure-inconclusive result keeps the immutable review identity
  // retryable without misclassifying capacity as a code finding.
  const capacityGuard = await localCiCapacityGuard();
  if (capacityGuard) return capacityGuard;

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
      "confidential",
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
