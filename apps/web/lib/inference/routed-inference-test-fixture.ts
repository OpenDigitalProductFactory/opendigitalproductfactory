import type { ActivityContract } from "@/lib/routing/activity-contract";

/** Fresh activity values for routed execution tests; no shared mutable state. */
export function makeActivity(overrides: Partial<ActivityContract> = {}): ActivityContract {
  return {
    activityId: "request:REQ-1:01:summarize",
    parentRef: { taskRunId: "TASK-1" },
    activityClass: "summarize",
    title: "Distill source material",
    distributionShape: "center",
    riskClass: "low",
    successShape: "text",
    contextPolicy: "retrieval",
    tokenEnvelope: {
      maxInputTokens: 64000,
      maxOutputTokens: 2000,
      compression: "summarize",
    },
    evaluationPolicy: {
      evaluator: "human-acceptance",
      minimumSignal: "accepted",
    },
    requestContractHints: {},
    ...overrides,
  };
}
