// The live ScopeDecider: principle_decide through the governed executor, so
// the call passes the same authority, approval and audit monitor as every other
// tool call (GPP C-9). Scoring is the kernel's; this adapter only reads the
// recommendation, its confidence and the ledger id back.

import { currentUserContext } from "@/lib/govern/current-user-context";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { err, ok } from "@/lib/shared/action-result";

import type { ScopeDecider } from "./scope-verdict";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export function principleDecideScopeDecider(ownerUserId: string, agentId?: string): ScopeDecider {
  return async (args) => {
    try {
      const userContext = await currentUserContext(ownerUserId);
      if (!userContext) return err("The candidate's owner is no longer an active user.");
      const response = await governedExecuteTool({
        toolName: "principle_decide", rawParams: { ...args }, userId: ownerUserId, userContext,
        source: "internal-mcp-session", context: { routeContext: "/platform/ai/skills", ...(agentId ? { agentId } : {}) },
      });
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
