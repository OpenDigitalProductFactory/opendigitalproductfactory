// A reviewer branch refused by its own daily token budget never reached a
// provider. Reporting it as an uncertain provider outcome sent operators to
// reconcile an execution that never happened (BI-F3B6713F).
import { AgentBudgetExhaustedError } from "@/lib/routing/inference-error";
export { semanticReviewBudgetRefusalAction } from "./semantic-review-recovery-policy";

export type SemanticReviewBudgetRefusal = {
  agentId: string;
  actualTokens: number;
  limitTokens: number;
  resetAt: string;
};

/** The typed refusal, directly or behind the fallback chain's summary error. */
export function semanticReviewBudgetRefusal(error: unknown): SemanticReviewBudgetRefusal | null {
  for (let current = error, depth = 0; current instanceof Error && depth < 5; current = current.cause, depth += 1) {
    if (current instanceof AgentBudgetExhaustedError) {
      const { agentId, actualTokens, limitTokens, resetAt } = current;
      return { agentId, actualTokens, limitTokens, resetAt };
    }
  }
  return null;
}
