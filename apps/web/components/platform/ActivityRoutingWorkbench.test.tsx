// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ActivityRoutingWorkbench } from "./ActivityRoutingWorkbench";
import type { OperationsMapActivityRouting } from "@/lib/ai-operations-map/types";

const ACTIVITY_ROUTING_FIXTURE: OperationsMapActivityRouting = {
  generatedAt: "2026-06-28T12:00:00.000Z",
  taskRef: { buildId: "FB-ROUTE" },
  activities: [
    {
      activityId: "activity:summarize",
      activityClass: "summarize",
      adapterTelemetryId: null,
      approvedConfidenceOverrideId: null,
      confidence: "provisional",
      costUsd: 0.0042,
      decisionSummary: "Used GLM as a provisional challenger because the summary is center-distribution and inspectable.",
      distributionShape: "center",
      exclusions: [
        {
          modelId: "frontier-large",
          providerId: "frontier",
          reason: "Excluded frontier model because this low-risk summary does not need the expensive edge harness.",
        },
      ],
      harnessRecipeKey: "glm.center.summarize.provisional",
      label: "Summarize transcript",
      riskClass: "low",
      routeDecisionId: "RD-SUMMARY",
      selectedModelId: "glm-5.2",
      selectedProviderId: "zai",
      successSignal: "valid",
      tokenTotal: 1280,
      tuningRecommendation: "observe",
      tuningRationale: "Collect more linked outcome samples before promoting this harness.",
      actionProposalId: null,
      actionProposalRecommendedConfidence: null,
      actionProposalSummary: null,
    },
    {
      activityId: "activity:review",
      activityClass: "critique",
      adapterTelemetryId: "ATR-REVIEW",
      approvedConfidenceOverrideId: "PROP-TRUST",
      confidence: "trusted",
      costUsd: 0.031,
      decisionSummary: "Escalated to a frontier review harness because the architecture decision is edge-shaped and high risk.",
      distributionShape: "edge",
      exclusions: [
        {
          modelId: "glm-5.2",
          providerId: "zai",
          reason: "Excluded GLM because the activity is high-risk architecture critique.",
        },
      ],
      harnessRecipeKey: "frontier.edge.critique.trusted",
      label: "Review architecture implications",
      riskClass: "high",
      routeDecisionId: "RD-REVIEW",
      selectedModelId: "frontier-large",
      selectedProviderId: "frontier",
      successSignal: "review-passed",
      tokenTotal: 4820,
      tuningRecommendation: "keep",
      tuningRationale: "Recent linked outcomes stayed above the trust floor.",
      actionProposalId: null,
      actionProposalRecommendedConfidence: null,
      actionProposalSummary: null,
    },
  ],
};

function readWorkbenchSource(): string {
  return readFileSync(
    join(process.cwd(), "components", "platform", "ActivityRoutingWorkbench.tsx"),
    "utf8",
  );
}

describe("ActivityRoutingWorkbench", () => {
  afterEach(() => {
    cleanup();
  });

  it("owns the activity routing UI and governed approval action outside the topology map", () => {
    const source = readWorkbenchSource();

    expect(source).toContain("export function ActivityRoutingWorkbench");
    expect(source).toContain('from "@/lib/actions/activity-harness-routing"');
    expect(source).toContain("Activity routing workbench");
    expect(source).toContain("Why this model?");
    expect(source).toContain("distributionShape");
    expect(source).toContain("riskClass");
    expect(source).toContain("selectedProviderId");
    expect(source).toContain("selectedModelId");
    expect(source).toContain("harnessRecipeKey");
    expect(source).toContain("confidence");
    expect(source).toContain("Harness");
    expect(source).toContain("Confidence");
    expect(source).toContain("Tuning");
    expect(source).toContain("tuningRecommendation");
    expect(source).toContain("tuningRationale");
    expect(source).toContain("actionProposalSummary");
    expect(source).toContain("actionProposalRecommendedConfidence");
    expect(source).toContain("proposeActivityHarnessOverrideAction");
    expect(source).toContain("Queue approval");
    expect(source).toContain("approvedConfidenceOverrideId");
    expect(source).toContain("Approved override");
    expect(source).toContain("successSignal");
    expect(source).toContain("data-activity-routing-step");
  });

  it("keeps the activity flow rail and selected decision drawer in the workbench module", () => {
    const source = readWorkbenchSource();

    expect(source).toContain("ActivityFlowRail");
    expect(source).toContain("aria-label=\"Activity routing flow\"");
    expect(source).toContain("data-activity-flow-node");
    expect(source).toContain("data-activity-flow-connector");
    expect(source).toContain("activityFlowConnectorClass");
    expect(source).toContain("Model path");
    expect(source).toContain("activityFlowConfidenceClass");
    expect(source).toContain("activityFlowRiskClass");
    expect(source).toContain("ActivityDecisionDrawer");
    expect(source).toContain("selectedActivityId");
    expect(source).toContain("onSelectActivity");
    expect(source).toContain("aria-label=\"Activity decision details\"");
    expect(source).toContain("data-activity-flow-selected");
    expect(source).toContain("Decision path");
    expect(source).toContain("Outcome evidence");
    expect(source).toContain("Routing confidence");
    expect(source).toContain("Alternatives excluded");
    expect(source).toContain("activityDecisionPanelClass");
  });

  it("renders a visible empty state when no activity routing evidence exists yet", () => {
    const source = readWorkbenchSource();

    expect(source).toContain("No activity route evidence yet");
    expect(source).toContain("ActivityContract");
    expect(source).toContain("route decisions with harness evidence");
    expect(source).toContain("data-activity-routing-empty");
    expect(source).not.toContain("if (!activityRouting || activityRouting.activities.length === 0) return null;");
  });

  it("renders the empty state instead of disappearing when activity evidence is missing", () => {
    render(<ActivityRoutingWorkbench activityRouting={null} />);

    expect(screen.getByRole("region", { name: "Activity routing workbench" })).toBeTruthy();
    expect(screen.getByText("No activity route evidence yet")).toBeTruthy();
    expect(screen.getByText("Compile activity")).toBeTruthy();
    expect(screen.getByText("Bind harness")).toBeTruthy();
    expect(screen.getByText("Record outcome")).toBeTruthy();
  });

  it("renders a selectable activity rail and updates the decision drawer", () => {
    render(<ActivityRoutingWorkbench activityRouting={ACTIVITY_ROUTING_FIXTURE} />);

    expect(screen.getByRole("region", { name: "Activity routing workbench" })).toBeTruthy();
    expect(screen.getByLabelText("Activity routing flow")).toBeTruthy();
    const nodes = screen.getAllByRole("button");
    expect(nodes).toHaveLength(2);
    expect(within(nodes[0]).getByText("Summarize transcript")).toBeTruthy();
    expect(within(nodes[0]).getByText("zai")).toBeTruthy();
    expect(within(nodes[0]).getByText("glm-5.2")).toBeTruthy();
    expect(within(nodes[1]).getByText("Review architecture implications")).toBeTruthy();

    const drawer = screen.getByRole("region", { name: "Activity decision details" });
    expect(within(drawer).getByText("Summarize transcript")).toBeTruthy();
    expect(within(drawer).getByText("RD-SUMMARY")).toBeTruthy();
    expect(within(drawer).getByText("1,280")).toBeTruthy();
    expect(within(drawer).getByText("$0.0042")).toBeTruthy();
    expect(within(drawer).getByText(/Excluded frontier model/)).toBeTruthy();

    fireEvent.click(nodes[1]);

    expect(within(drawer).getByText("Review architecture implications")).toBeTruthy();
    expect(within(drawer).getByText("RD-REVIEW")).toBeTruthy();
    expect(within(drawer).getByText("4,820")).toBeTruthy();
    expect(within(drawer).getByText("$0.0310")).toBeTruthy();
    expect(within(drawer).getByText(/Excluded GLM/)).toBeTruthy();
  });
});
