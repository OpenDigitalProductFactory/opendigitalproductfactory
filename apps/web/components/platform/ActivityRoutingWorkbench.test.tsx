// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityRoutingWorkbench } from "./ActivityRoutingWorkbench";
import type { OperationsMapActivityRouting } from "@/lib/ai-operations-map/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/ai-providers", () => ({
  toggleProviderStatus: vi.fn().mockResolvedValue({}),
}));

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
      enableCandidates: [],
    },
    {
      activityId: "activity:review",
      activityClass: "critique",
      adapterTelemetryId: "ATR-REVIEW",
      approvedConfidenceOverrideId: null,
      confidence: "calibrating",
      costUsd: null,
      decisionSummary: "No allowed healthy engine can run the architecture review.",
      distributionShape: "edge",
      exclusions: [
        {
          code: "no-eligible-endpoint",
          modelId: null,
          providerId: "routing-error",
          reason: "Sixteen endpoints were excluded by the internal-data routing contract.",
          remediation: "Connect or enable a tool-capable provider for internal data.",
        },
      ],
      harnessRecipeKey: "edge.critique.balanced",
      label: "Review architecture implications",
      riskClass: "high",
      routeDecisionId: "RD-REVIEW",
      selectedModelId: null,
      selectedProviderId: null,
      successSignal: "failed",
      tokenTotal: null,
      tuningRecommendation: "observe",
      tuningRationale: "Routing is blocked until an eligible provider is available.",
      actionProposalId: null,
      actionProposalRecommendedConfidence: null,
      actionProposalSummary: null,
      enableCandidates: [
        {
          providerId: "anthropic",
          displayName: "Anthropic",
          action: "connect_credentials",
          actionLabel: "Connect & enable",
          oneClick: false,
          satisfies: ["tool use", "internal sensitivity"],
          note: "Needs credentials you must supply.",
        },
      ],
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
  afterEach(() => cleanup());

  it("renders a visible empty state when activity routing evidence is missing", () => {
    render(<ActivityRoutingWorkbench activityRouting={null} />);

    expect(screen.getByRole("region", { name: "Activity routing workbench" })).toBeTruthy();
    expect(screen.getByText("No activity route evidence yet")).toBeTruthy();
    expect(screen.getByText("Compile activity")).toBeTruthy();
    expect(screen.getByText("Bind harness")).toBeTruthy();
    expect(screen.getByText("Record outcome")).toBeTruthy();
  });

  it("renders one vertical activity list and one selected decision inspector without duplicate cards", () => {
    render(<ActivityRoutingWorkbench activityRouting={ACTIVITY_ROUTING_FIXTURE} />);

    const list = screen.getByRole("list", { name: "Activity route steps" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.hasAttribute("data-activity-list-item"))).toBe(true);
    expect(within(rows[0]).getByText("Summarize transcript")).toBeTruthy();
    expect(within(rows[0]).getByText("Z.ai · GLM 5.2")).toBeTruthy();

    const inspector = screen.getByRole("region", { name: "Activity decision details" });
    expect(within(inspector).getByText("Review architecture implications")).toBeTruthy();
    expect(screen.queryAllByTestId("activity-detail-card")).toHaveLength(0);

    const source = readWorkbenchSource();
    expect(source).not.toContain("overflow-x-auto");
    expect(source).not.toContain("data-activity-routing-step");
  });

  it("selects the first failed or attention activity by default and updates one inspector", () => {
    render(<ActivityRoutingWorkbench activityRouting={ACTIVITY_ROUTING_FIXTURE} />);

    const inspector = screen.getByRole("region", { name: "Activity decision details" });
    expect(within(inspector).getByText("Review architecture implications")).toBeTruthy();
    expect(within(inspector).getByText(/No allowed healthy engine/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Summarize transcript/i }));

    expect(within(inspector).getByText("Summarize transcript")).toBeTruthy();
    expect(within(inspector).getByText("1,280")).toBeTruthy();
    expect(within(inspector).getByText("$0.0042")).toBeTruthy();
  });

  it("filters the same activity list to attention items instead of opening a duplicate queue", () => {
    render(<ActivityRoutingWorkbench activityRouting={ACTIVITY_ROUTING_FIXTURE} />);

    fireEvent.click(screen.getByRole("button", { name: "Needs attention (1)" }));

    const list = screen.getByRole("list", { name: "Activity route steps" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list).getByText("Review architecture implications")).toBeTruthy();
    expect(within(list).queryByText("Summarize transcript")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "All activities (2)" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });

  it("surfaces a governed disabled-provider remediation for the selected blocked activity", () => {
    render(<ActivityRoutingWorkbench activityRouting={ACTIVITY_ROUTING_FIXTURE} />);

    const inspector = screen.getByRole("region", { name: "Activity decision details" });
    expect(within(inspector).getByText("Anthropic")).toBeTruthy();
    const connect = within(inspector).getByRole("link", { name: /Connect & enable/i });
    expect(connect.getAttribute("href")).toBe("/platform/ai/providers/anthropic");
    expect(within(inspector).getByText("internal sensitivity")).toBeTruthy();
  });

  it("hands only the selected decision context to the real coworker panel", () => {
    const events: Array<Record<string, unknown>> = [];
    const onOpen = (event: Event) => {
      events.push((event as CustomEvent<Record<string, unknown>>).detail);
    };
    document.addEventListener("open-agent-panel", onOpen);
    render(<ActivityRoutingWorkbench activityRouting={{ ...ACTIVITY_ROUTING_FIXTURE, taskRef: {} }} />);

    fireEvent.click(screen.getByRole("button", { name: "Ask coworker to investigate" }));
    const confirmation = screen.getByRole("region", { name: "Investigate this routing issue" });
    fireEvent.click(within(confirmation).getByRole("button", { name: "Send to coworker" }));

    document.removeEventListener("open-agent-panel", onOpen);
    expect(events).toHaveLength(1);
    expect(events[0].routeContext).toBe("/platform/ai/operations-map");
    expect(events[0].autoMessage).toContain("Review architecture implications");
    expect(events[0].autoMessage).toContain("No allowed healthy engine");
    expect(events[0].autoMessage).toContain("internal-data routing contract");
    expect(events[0].autoMessage).not.toContain("RD-REVIEW");
    expect(events[0].autoMessage).not.toContain("ATR-REVIEW");
  });

  it("keeps humanized routing labels primary and raw identifiers inside technical disclosure", () => {
    render(<ActivityRoutingWorkbench activityRouting={ACTIVITY_ROUTING_FIXTURE} />);

    const inspector = screen.getByRole("region", { name: "Activity decision details" });
    expect(within(inspector).getByText("No model selected yet")).toBeTruthy();
    for (const occurrence of within(inspector).getAllByText("RD-REVIEW")) {
      expect(occurrence.closest("details[data-technical-details]")).toBeTruthy();
    }
  });

  it("collapses an all-unknown outcome grid into one honest sentence", () => {
    render(
      <ActivityRoutingWorkbench
        activityRouting={{
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
        }}
      />,
    );

    expect(screen.getByText("No outcome recorded yet — this route hasn't run.")).toBeTruthy();
  });
});
