import { canonicalJson } from "@/lib/shared/canonical-json";
import type { RouteDecision } from "@/lib/routing/types";

import type { RouteAndCallOptions } from "./routed-inference-options";

type ExpectedExecution = NonNullable<
  NonNullable<RouteAndCallOptions["durableAsyncOperation"]>["expectedExecution"]
>;

/** Refuse closed-caller plan drift before durable operation admission. */
export function assertDurableExecutionConstraint(
  decision: RouteDecision,
  expectedExecution: ExpectedExecution,
): void {
  const plan = decision.executionPlan;
  const expectedPlan = plan?.recipeId
    ? expectedExecution.plans.find((candidate) => candidate.recipeId === plan.recipeId)
    : null;
  if (
    !plan
    || plan.providerId !== expectedExecution.providerId
    || plan.contractFamily !== expectedExecution.contractFamily
    || plan.executionAdapter !== expectedExecution.executionAdapter
    || !expectedPlan
    || plan.modelId !== expectedPlan.modelId
    || plan.maxTokens !== expectedPlan.maxTokens
    || canonicalJson(plan.providerSettings) !== canonicalJson(expectedPlan.providerSettings)
    || canonicalJson(plan.toolPolicy) !== canonicalJson(expectedPlan.toolPolicy)
    || canonicalJson(plan.responsePolicy) !== canonicalJson(expectedPlan.responsePolicy)
    || decision.explorationMode !== expectedExecution.explorationMode
  ) throw new Error("ASYNC_OPERATION_EXECUTION_PLAN_CONSTRAINT_MISMATCH");
}
