import { describe, expect, it } from "vitest";

import { projectActionProposalPresentation } from "./action-proposal-presentation";

describe("projectActionProposalPresentation", () => {
  it("renders activity-harness confidence overrides as routing-tuning actions", () => {
    const presentation = projectActionProposalPresentation({
      proposalId: "harness-action:plan:edge.plan.balanced:anthropic:claude-sonnet:promote",
      actionType: "activity_harness_confidence_override",
      parameters: {
        kind: "activity-harness-confidence-override",
        activityClass: "plan",
        harnessRecipeKey: "edge.plan.balanced",
        providerId: "anthropic",
        modelId: "claude-sonnet",
        confidence: "trusted",
      },
    });

    expect(presentation).toEqual({
      title: "Tune activity routing confidence",
      shortLabel: "Activity routing tuning",
      summary: "Set plan / edge.plan.balanced on anthropic/claude-sonnet to trusted.",
      details: [
        { label: "Activity", value: "plan" },
        { label: "Harness", value: "edge.plan.balanced" },
        { label: "Provider", value: "anthropic" },
        { label: "Model", value: "claude-sonnet" },
        { label: "Confidence", value: "trusted" },
      ],
    });
  });

  it("falls back to a humanized action label for unknown proposal types", () => {
    expect(projectActionProposalPresentation({
      proposalId: "AP-1",
      actionType: "create_invoice",
      parameters: {},
    })).toMatchObject({
      title: "Create invoice",
      shortLabel: "Create invoice",
      summary: "Proposed action create_invoice.",
    });
  });
});
