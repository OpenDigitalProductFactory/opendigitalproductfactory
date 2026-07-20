import { describe, expect, it } from "vitest";
import type { ActivityContract } from "../activity-contract";
import { deriveProviderSuitabilityWorkContext } from "./work-context";

function activity(activityClass: ActivityContract["activityClass"]): ActivityContract {
  return {
    activityId: `journey:${activityClass}`,
    parentRef: {},
    activityClass,
    title: "Journey verification",
    distributionShape: "center",
    riskClass: "medium",
    successShape: "text",
    contextPolicy: "retrieval",
    tokenEnvelope: { maxInputTokens: 8_000, maxOutputTokens: 1_000, compression: "summarize" },
    evaluationPolicy: { evaluator: "human-acceptance", minimumSignal: "accepted" },
    requestContractHints: {},
  };
}

describe.each([
  ["dental", "dental-practice", "healthcare-wellness", "deliver", "summarize", "health-phi"],
  ["retail", "specialty-retailer", "retail", "attract", "synthesize", "public-marketing"],
  ["credit-union", "credit-union", "banking-financial-services", "deliver", "summarize", "payments-finance"],
  ["training", "training-provider", "education-training", "deliver", "synthesize", "student-records"],
  ["software-platform", "software-platform", "software-platform", "operate-improve", "code-edit", "source-code"],
] as const)("%s provider-suitability journey", (_label, archetypeId, archetypeCategory, valueStreamStage, activityClass, expectedWorkload) => {
  it(`derives ${expectedWorkload} from the shared work-context projection`, () => {
    const context = deriveProviderSuitabilityWorkContext({
      archetypeId,
      archetypeCategory,
      valueStreamStage,
      activity: activity(activityClass),
    });

    expect(context.workloadClasses).toEqual([expectedWorkload]);
    expect(context.workloadProfiles[0]?.classificationKnown).toBe(true);
  });
});
