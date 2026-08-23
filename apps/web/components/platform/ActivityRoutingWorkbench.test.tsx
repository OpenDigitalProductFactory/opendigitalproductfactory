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
    join(__dirname, "ActivityRoutingWorkbench.tsx"),
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
    // Two flow nodes + each node card carries a "Technical details" disclosure summary.
    const flowNodes = nodes.filter((node) => node.hasAttribute("data-activity-flow-node"));
    expect(flowNodes).toHaveLength(2);
    expect(within(flowNodes[0]).getByText("Summarize transcript")).toBeTruthy();
    // Humanized model route, not the raw provider/model ids.
    expect(within(flowNodes[0]).getByText("Z.ai · GLM 5.2")).toBeTruthy();
    expect(within(flowNodes[0]).queryByText("zai")).toBeNull();
    expect(within(flowNodes[0]).queryByText("glm-5.2")).toBeNull();
    expect(within(flowNodes[1]).getByText("Review architecture implications")).toBeTruthy();

    const drawer = screen.getByRole("region", { name: "Activity decision details" });
    expect(within(drawer).getByText("Summarize transcript")).toBeTruthy();
    // Raw route decision id is preserved behind the technical-details disclosure.
    expect(within(drawer).getByText("RD-SUMMARY")).toBeTruthy();
    expect(within(drawer).getByText("1,280")).toBeTruthy();
    expect(within(drawer).getByText("$0.0042")).toBeTruthy();
    expect(within(drawer).getByText(/Excluded frontier model/)).toBeTruthy();

    fireEvent.click(flowNodes[1]);

    expect(within(drawer).getByText("Review architecture implications")).toBeTruthy();
    expect(within(drawer).getByText("RD-REVIEW")).toBeTruthy();
    expect(within(drawer).getByText("4,820")).toBeTruthy();
    expect(within(drawer).getByText("$0.0310")).toBeTruthy();
    expect(within(drawer).getByText(/Excluded GLM/)).toBeTruthy();
  });

  it("humanizes routing internals and hides raw ids behind technical disclosure (BI-E3969A69)", () => {
    render(<ActivityRoutingWorkbench activityRouting={ACTIVITY_ROUTING_FIXTURE} />);

    // Recipe key is presented as a sentence, not the raw dotted key.
    expect(
      screen.getAllByText(/trial recipe for summarizing/i).length,
    ).toBeGreaterThan(0);

    // Flow nodes never show the raw dotted key as operator-facing text.
    const flowNodes = screen
      .getAllByRole("button")
      .filter((node) => node.hasAttribute("data-activity-flow-node"));
    for (const node of flowNodes) {
      expect(node.textContent ?? "").not.toContain("glm.center.summarize.provisional");
    }

    // The raw recipe key still exists in the DOM so an engineer can copy it,
    // but every occurrence is inside a collapsed Technical-details disclosure.
    const rawKeyOccurrences = screen.queryAllByText("glm.center.summarize.provisional");
    expect(rawKeyOccurrences.length).toBeGreaterThan(0);
    for (const occurrence of rawKeyOccurrences) {
      expect(occurrence.closest("details[data-technical-details]")).toBeTruthy();
    }

    // Confidence enum is rendered in operator language.
    const drawer = screen.getByRole("region", { name: "Activity decision details" });
    expect(within(drawer).getByText("Trial")).toBeTruthy();
  });

  it("opens an attention-first review queue with the right action per row (BI-E3969A69)", () => {
    const base = ACTIVITY_ROUTING_FIXTURE.activities[0];
    const routing: OperationsMapActivityRouting = {
      ...ACTIVITY_ROUTING_FIXTURE,
      taskRef: { buildId: "FB-QUEUE" },
      activities: [
        // Failed, no proposal → link to originating build.
        {
          ...base,
          activityId: "activity:failed",
          label: "Generate migration",
          successSignal: "failed",
          actionProposalId: null,
          actionProposalSummary: null,
          actionProposalRecommendedConfidence: null,
          approvedConfidenceOverrideId: null,
        },
        // Attention with a full proposal → queue approval.
        {
          ...base,
          activityId: "activity:attention",
          label: "Draft release notes",
          successSignal: "attention",
          actionProposalId: "PROP-1",
          actionProposalSummary: "Promote this route to calibrating.",
          actionProposalRecommendedConfidence: "calibrating",
          approvedConfidenceOverrideId: null,
        },
        // A healthy activity that must NOT appear in the queue.
        { ...base, activityId: "activity:ok", label: "Summarize call", successSignal: "valid" },
      ],
    };
    render(<ActivityRoutingWorkbench activityRouting={routing} />);

    // Queue is collapsed until the badge is pressed.
    expect(screen.queryByRole("region", { name: "Activities needing review" })).toBeNull();
    const badge = screen.getByRole("button", { name: /2 need review/i });
    fireEvent.click(badge);

    const queue = screen.getByRole("region", { name: "Activities needing review" });
    const rows = within(queue)
      .getAllByRole("listitem")
      .filter((row) => row.hasAttribute("data-review-queue-row"));
    expect(rows).toHaveLength(2);

    // Failed row (no proposal) links to the originating build.
    const failedRow = rows.find((row) => within(row).queryByText("Generate migration"));
    expect(failedRow).toBeTruthy();
    const buildLink = within(failedRow!).getByRole("link", { name: "Open originating build" });
    expect(buildLink.getAttribute("href")).toBe("/build?buildId=FB-QUEUE");

    // Attention row (proposal present) offers a governed queue-approval action.
    const attentionRow = rows.find((row) => within(row).queryByText("Draft release notes"));
    expect(within(attentionRow!).getByRole("button", { name: "Queue approval" })).toBeTruthy();

    // Healthy activity is never listed.
    expect(within(queue).queryByText("Summarize call")).toBeNull();
  });

  it("labels an unactionable flagged activity as informational when no work ref exists", () => {
    const base = ACTIVITY_ROUTING_FIXTURE.activities[0];
    const routing: OperationsMapActivityRouting = {
      ...ACTIVITY_ROUTING_FIXTURE,
      taskRef: {},
      activities: [
        {
          ...base,
          activityId: "activity:orphan",
          label: "Orphan step",
          successSignal: "failed",
          actionProposalId: null,
          actionProposalSummary: null,
          actionProposalRecommendedConfidence: null,
          approvedConfidenceOverrideId: null,
        },
      ],
    };
    render(<ActivityRoutingWorkbench activityRouting={routing} />);

    fireEvent.click(screen.getByRole("button", { name: /1 needs review/i }));
    const queue = screen.getByRole("region", { name: "Activities needing review" });
    expect(within(queue).getByText("Informational — no action available yet")).toBeTruthy();
    expect(within(queue).queryByRole("link")).toBeNull();
  });

  it("collapses an all-unknown outcome grid into one honest sentence", () => {
    const noOutcome: OperationsMapActivityRouting = {
      ...ACTIVITY_ROUTING_FIXTURE,
      activities: [
        {
          ...ACTIVITY_ROUTING_FIXTURE.activities[0],
          successSignal: "unknown",
          routeDecisionId: null,
          tokenTotal: null,
          costUsd: null,
        },
      ],
    };
    render(<ActivityRoutingWorkbench activityRouting={noOutcome} />);

    expect(
      screen.getByText("No outcome recorded yet — this route hasn't run."),
    ).toBeTruthy();
  });
});
