import { describe, expect, it } from "vitest";
import {
  activityHarnessProposalParameters,
  activityHarnessOverridesFromProposalRows,
  buildActivityHarnessApprovalProposalCommand,
} from "./activity-harness-approval-source";

describe("activityHarnessOverridesFromProposalRows", () => {
  it("converts approved agent action proposals into confidence overrides", () => {
    const rows = [
      {
        proposalId: "AP-1",
        actionType: "activity_harness_confidence_override",
        parameters: activityHarnessProposalParameters({
          proposalId: "harness-action:summarize:center.summarize.cheap-structured:openai:gpt-4o-mini:promote",
          activityClass: "summarize",
          harnessRecipeKey: "center.summarize.cheap-structured",
          providerId: "openai",
          modelId: "gpt-4o-mini",
          confidence: "trusted",
        }),
        status: "approved",
        decidedById: "user-1",
        decidedAt: new Date("2026-06-28T21:00:00.000Z"),
      },
    ];

    expect(activityHarnessOverridesFromProposalRows(rows)).toEqual([
      {
        calibrationKey: "summarize|center.summarize.cheap-structured|openai|gpt-4o-mini",
        proposalId: "harness-action:summarize:center.summarize.cheap-structured:openai:gpt-4o-mini:promote",
        activityClass: "summarize",
        harnessRecipeKey: "center.summarize.cheap-structured",
        providerId: "openai",
        modelId: "gpt-4o-mini",
        confidence: "trusted",
        approvedBy: "user-1",
        approvedAt: "2026-06-28T21:00:00.000Z",
      },
    ]);
  });

  it("ignores pending, rejected, non-routing, and malformed proposal rows", () => {
    const rows = [
      {
        proposalId: "AP-pending",
        actionType: "activity_harness_confidence_override",
        parameters: activityHarnessProposalParameters({
          proposalId: "pending",
          activityClass: "summarize",
          harnessRecipeKey: "center.summarize.cheap-structured",
          providerId: "openai",
          modelId: "gpt-4o-mini",
          confidence: "trusted",
        }),
        status: "proposed",
        decidedById: null,
        decidedAt: null,
      },
      {
        proposalId: "AP-rejected",
        actionType: "activity_harness_confidence_override",
        parameters: activityHarnessProposalParameters({
          proposalId: "rejected",
          activityClass: "summarize",
          harnessRecipeKey: "center.summarize.cheap-structured",
          providerId: "openai",
          modelId: "gpt-4o-mini",
          confidence: "trusted",
        }),
        status: "rejected",
        decidedById: "user-1",
        decidedAt: new Date("2026-06-28T21:00:00.000Z"),
      },
      {
        proposalId: "AP-other",
        actionType: "create_epic",
        parameters: { name: "Not a harness override" },
        status: "approved",
        decidedById: "user-1",
        decidedAt: new Date("2026-06-28T21:00:00.000Z"),
      },
      {
        proposalId: "AP-bad",
        actionType: "activity_harness_confidence_override",
        parameters: { activityClass: "summarize" },
        status: "approved",
        decidedById: "user-1",
        decidedAt: new Date("2026-06-28T21:00:00.000Z"),
      },
    ];

    expect(activityHarnessOverridesFromProposalRows(rows)).toEqual([]);
  });
});

describe("buildActivityHarnessApprovalProposalCommand", () => {
  it("builds the AgentActionProposal envelope for a Workbench tuning action", () => {
    const command = buildActivityHarnessApprovalProposalCommand({
      proposalId: "harness-action:plan:edge.plan.balanced:anthropic:claude-sonnet:promote",
      activityClass: "plan",
      harnessRecipeKey: "edge.plan.balanced",
      providerId: "anthropic",
      modelId: "claude-sonnet",
      confidence: "trusted",
      summary: "Promote edge.plan.balanced for plan on anthropic/claude-sonnet after approval.",
    });

    expect(command).toEqual({
      proposalId: "harness-action:plan:edge.plan.balanced:anthropic:claude-sonnet:promote",
      actionType: "activity_harness_confidence_override",
      messageContent:
        "Approve activity routing change: Promote edge.plan.balanced for plan on anthropic/claude-sonnet after approval.",
      parameters: {
        kind: "activity-harness-confidence-override",
        proposalId: "harness-action:plan:edge.plan.balanced:anthropic:claude-sonnet:promote",
        activityClass: "plan",
        harnessRecipeKey: "edge.plan.balanced",
        providerId: "anthropic",
        modelId: "claude-sonnet",
        confidence: "trusted",
      },
    });
  });
});
