import { describe, expect, it } from "vitest";
import {
  applyHarnessConfidenceOverride,
  bindHarnessRecipeForActivity,
  isGlmHarnessRecipe,
} from "./harness-recipe";
import type { ActivityContract } from "./activity-contract";

describe("bindHarnessRecipeForActivity", () => {
  it("binds center-distribution summarization to a cheap structured harness", () => {
    const recipe = bindHarnessRecipeForActivity(makeActivity({
      activityClass: "summarize",
      distributionShape: "center",
      riskClass: "low",
      successShape: "text",
    }));

    expect(recipe).toMatchObject({
      recipeKey: "center.summarize.cheap-structured",
      activityClass: "summarize",
      distributionShape: "center",
      promptStrategy: "concise-task-packet",
      contextAssembler: "minimal-ranked-context",
      memoryPolicy: "thread-summary",
      tokenPolicy: {
        inputPacking: "compressed",
        outputBudget: "tight",
      },
      activityConfidence: "calibrating",
    });
  });

  it("binds high-risk code edit work to a frontier coding harness", () => {
    const recipe = bindHarnessRecipeForActivity(makeActivity({
      activityClass: "code-edit",
      distributionShape: "mixed",
      riskClass: "high",
      successShape: "patch",
    }));

    expect(recipe).toMatchObject({
      recipeKey: "high-risk.code-edit.frontier-coding",
      activityClass: "code-edit",
      providerFamily: "frontier",
      promptStrategy: "repo-packet-with-verification",
      memoryPolicy: "work-case-packet",
      evaluator: "tool-success",
      activityConfidence: "trusted",
    });
  });

  it("keeps GLM activity harnesses provisional until outcome samples exist", () => {
    const recipe = bindHarnessRecipeForActivity(makeActivity({
      activityClass: "extract",
      distributionShape: "center",
      riskClass: "low",
      successShape: "json",
    }), { providerId: "zai", modelId: "glm-5.2" });

    expect(isGlmHarnessRecipe(recipe)).toBe(true);
    expect(recipe).toMatchObject({
      recipeKey: "glm.center.extract.provisional",
      providerFamily: "zai",
      modelFamily: "glm",
      responsePolicy: { strictSchema: true },
      activityConfidence: "provisional",
    });
  });
});

describe("applyHarnessConfidenceOverride", () => {
  it("applies only the approved override matching activity, recipe, provider, and model", () => {
    const activity = makeActivity({
      activityClass: "summarize",
      distributionShape: "center",
      riskClass: "low",
      successShape: "text",
    });
    const recipe = bindHarnessRecipeForActivity(activity, {
      providerId: "openai",
      modelId: "gpt-4o-mini",
    });

    const overridden = applyHarnessConfidenceOverride(
      recipe,
      { providerId: "openai", modelId: "gpt-4o-mini" },
      [
        {
          calibrationKey: "summarize|center.summarize.cheap-structured|anthropic|claude-sonnet-4-5",
          proposalId: "wrong-provider",
          activityClass: "summarize",
          harnessRecipeKey: "center.summarize.cheap-structured",
          providerId: "anthropic",
          modelId: "claude-sonnet-4-5",
          confidence: "degraded",
          approvedBy: "operator",
          approvedAt: "2026-06-28T21:00:00.000Z",
        },
        {
          calibrationKey: "summarize|center.summarize.cheap-structured|openai|gpt-4o-mini",
          proposalId: "approved-promote",
          activityClass: "summarize",
          harnessRecipeKey: "center.summarize.cheap-structured",
          providerId: "openai",
          modelId: "gpt-4o-mini",
          confidence: "trusted",
          approvedBy: "operator",
          approvedAt: "2026-06-28T21:00:00.000Z",
        },
      ],
    );

    expect(recipe.activityConfidence).toBe("calibrating");
    expect(overridden.activityConfidence).toBe("trusted");
  });
});

function makeActivity(overrides: Partial<ActivityContract>): ActivityContract {
  return {
    activityId: "activity-1",
    parentRef: {},
    title: "Test activity",
    activityClass: "summarize",
    distributionShape: "center",
    riskClass: "low",
    successShape: "text",
    contextPolicy: "minimal",
    tokenEnvelope: {
      maxInputTokens: 8_000,
      maxOutputTokens: 1_000,
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
