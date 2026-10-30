import type { WorkShapeDefinition } from "../kernel/gpp/work-shape-contracts.js";

/** One fixed synthetic activity, not a reusable scheduler or practice catalog. */
export const definition: WorkShapeDefinition = {
  key: "synthetic-policy-work", version: "1.0.0",
  title: "Synthetic recurring work", description: "One local observation with a bounded host admission.",
  triggers: ["claim"],
  stages: [{ key: "author", title: "Prepare synthetic observation", accountablePrincipalRef: "agent:synthetic-author",
    advance: { kind: "status-change", condition: "The host accepted the exact synthetic observation." },
    evidence: ["passing-test"], tools: ["synthetic_observation"],
    deadline: { afterDays: 1, description: "One day to provide the synthetic observation." } }],
  stopConditions: [
    { kind: "success", condition: "Observation accepted.", disposition: "proceed" },
    { kind: "failure", condition: "Input unavailable.", disposition: "inconclusive" },
    { kind: "budget", condition: "Synthetic allowance absent.", disposition: "awaiting-person" },
  ],
  grants: ["synthetic:observe"], measures: [],
  budgets: [{ kind: "findings-per-run", limit: 1, unit: "synthetic-observation" }],
  reviewPoint: { everyDays: 1, description: "Review the synthetic occurrence." }, collaborationShape: null,
};

export function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export function equal(actual: unknown, expected: unknown, message: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}
