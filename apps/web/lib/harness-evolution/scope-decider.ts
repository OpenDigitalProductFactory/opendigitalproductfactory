// The live ScopeDecider: principle_decide through the in-process tool
// executor, the same path Build Studio's decision service uses
// (lib/build/decision-service.ts). Scoring is the kernel's; this adapter only
// reads the recommendation, its confidence and the ledger id back.

import { executeTool } from "@/lib/mcp-tools";
import { err, ok } from "@/lib/shared/action-result";

import type { ScopeDecider } from "./scope-verdict";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export function principleDecideScopeDecider(ownerUserId: string): ScopeDecider {
  return async (args) => {
    try {
      const response = await executeTool("principle_decide", { ...args }, ownerUserId, { routeContext: "/platform/ai/skills" });
      if (!response.success) return err(response.error ?? "principle_decide refused");
      const data = asRecord(response.data);
      const recommendation = asRecord(data.recommendation);
      const blockers = Array.isArray(data.autonomyBlockers) ? data.autonomyBlockers.filter((b): b is string => typeof b === "string") : [];
      return ok({
        interactionId: typeof asRecord(data.ledger).interactionId === "string" ? (asRecord(data.ledger).interactionId as string) : null,
        recommendedOptionId: typeof recommendation.optionId === "string" ? recommendation.optionId : null,
        confidence: typeof recommendation.confidence === "string" ? recommendation.confidence : null,
        autonomyBlockers: blockers,
      });
    } catch (error) {
      return err(error instanceof Error ? error.message : "principle_decide failed");
    }
  };
}
