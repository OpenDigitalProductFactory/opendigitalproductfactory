// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FeatureBriefPanel } from "./FeatureBriefPanel";
import type { FeatureBuildRow, FeatureBrief } from "@/lib/feature-build-types";

const brief: FeatureBrief = {
  title: "Agent budget controls",
  description: "Track agent cost events and enforce budget policy.",
  portfolioContext: "foundational",
  targetRoles: ["Platform operator"],
  inputs: [],
  dataNeeds: "AgentBudgetEvent",
  acceptanceCriteria: ["Shows spend by feature build"],
};

function makeBuild(): FeatureBuildRow {
  return {
    buildId: "FB-1",
    happyPathState: {
      intake: {
        status: "pending",
        taxonomyNodeId: null,
        backlogItemId: null,
        epicId: null,
        constrainedGoal: null,
        failureReason: null,
      },
      execution: { engine: null, source: null, status: "pending", failureStage: null },
      verification: { status: "pending", checks: [] },
    },
    deliberationSummary: null,
    designDoc: null,
    designReview: null,
    taxonomyAttribution: {
      method: "heuristic",
      confidence: 0.394,
      confirmedNodeId: null,
      topCandidate: {
        nodeId: "manufacturing_and_delivery/requirement_to_deploy/test_validate",
        nodeName: "Test & Validate",
        score: 0.394,
        evidence: "matched: test, validate",
      },
      candidates: [
        {
          nodeId: "manufacturing_and_delivery/requirement_to_deploy/test_validate",
          nodeName: "Test & Validate",
          score: 0.394,
          evidence: "matched: test, validate",
        },
      ],
      proposedNewNode: null,
      attributedAt: "2026-05-21T00:00:00.000Z",
    },
  } as unknown as FeatureBuildRow;
}

describe("FeatureBriefPanel taxonomy placement", () => {
  it("surfaces low-confidence placement evidence beside the brief", () => {
    render(<FeatureBriefPanel brief={brief} phase="ideate" diffSummary={null} build={makeBuild()} />);

    expect(screen.getByText("Taxonomy Placement")).toBeInTheDocument();
    expect(screen.getByText("Low confidence")).toBeInTheDocument();
    expect(screen.getByText("39%")).toBeInTheDocument();
    expect(screen.getAllByText("Test & Validate").length).toBeGreaterThan(0);
    expect(screen.getByText("matched: test, validate")).toBeInTheDocument();
  });
});
