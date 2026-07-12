// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FeatureBriefPanel } from "./FeatureBriefPanel";
import type { FeatureBuildRow, FeatureBrief, BuildChangeNarrative } from "@/lib/feature-build-types";

const brief: FeatureBrief = {
  title: "Agent budget controls",
  description: "Track agent cost events and enforce budget policy.",
  portfolioContext: "foundational",
  targetRoles: ["Platform operator"],
  inputs: [],
  dataNeeds: "AgentBudgetEvent",
  acceptanceCriteria: ["Shows spend by feature build"],
};

function makeBuild(
  overrides: { phase?: FeatureBuildRow["phase"]; engine?: string | null } = {},
): FeatureBuildRow {
  return {
    buildId: "FB-1",
    phase: overrides.phase ?? "ideate",
    happyPathState: {
      intake: {
        status: "pending",
        taxonomyNodeId: null,
        backlogItemId: null,
        epicId: null,
        constrainedGoal: null,
        failureReason: null,
      },
      execution: {
        engine: overrides.engine ?? null,
        source: null,
        status: "pending",
        failureStage: null,
      },
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
    render(<FeatureBriefPanel brief={brief} phase="ideate" build={makeBuild()} />);

    expect(screen.getByText("Taxonomy Placement")).toBeInTheDocument();
    expect(screen.getByText("Low confidence")).toBeInTheDocument();
    expect(screen.getByText("39%")).toBeInTheDocument();
    expect(screen.getAllByText("Test & Validate").length).toBeGreaterThan(0);
    expect(screen.getByText("matched: test, validate")).toBeInTheDocument();
  });
});

describe("HappyPathStatusCard engine label", () => {
  it("shows 'Pending dispatch' (not 'Not selected') pre-dispatch in ideate", () => {
    render(
      <FeatureBriefPanel brief={brief} phase="ideate" build={makeBuild({ phase: "ideate", engine: null })} />,
    );
    expect(screen.getAllByText(/Engine: Pending dispatch/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/Engine: Not selected/)).toHaveLength(0);
  });

  it("shows 'Pending dispatch' pre-dispatch in plan", () => {
    render(
      <FeatureBriefPanel brief={brief} phase="plan" build={makeBuild({ phase: "plan", engine: null })} />,
    );
    expect(screen.getAllByText(/Engine: Pending dispatch/).length).toBeGreaterThan(0);
  });

  it("shows the dispatched engine once one is assigned", () => {
    render(
      <FeatureBriefPanel brief={brief} phase="build" build={makeBuild({ phase: "build", engine: "claude" })} />,
    );
    expect(screen.getAllByText(/Engine: claude/).length).toBeGreaterThan(0);
  });

  it("keeps 'Not selected' at build phase when no engine is set (genuine gap)", () => {
    render(
      <FeatureBriefPanel brief={brief} phase="build" build={makeBuild({ phase: "build", engine: null })} />,
    );
    expect(screen.getAllByText(/Engine: Not selected/).length).toBeGreaterThan(0);
  });
});

describe("FeatureBriefPanel Build Summary (BI-5EA94BD1 — plain change summary, never the raw diff)", () => {
  const narrative = {
    headline: "Repeat customers now get an automatic 10% discount.",
    bullets: [],
    whyItMatters: "Rewards your regulars without you tracking who qualifies.",
    openQuestions: [],
    generatedAt: "2026-07-12T00:00:00.000Z",
    model: "local",
  } as unknown as BuildChangeNarrative;

  it("shows the plain change narrative in the review-phase Build Summary", () => {
    render(
      <FeatureBriefPanel brief={brief} phase="review" changeNarrative={narrative} build={makeBuild({ phase: "review" })} />,
    );
    expect(screen.getByText(/Repeat customers now get an automatic 10% discount/)).toBeInTheDocument();
    expect(screen.getByText(/Rewards your regulars/)).toBeInTheDocument();
  });

  it("says 'No plain summary yet.' instead of a raw diff when there is no narrative", () => {
    render(
      <FeatureBriefPanel brief={brief} phase="complete" changeNarrative={null} build={makeBuild({ phase: "complete" })} />,
    );
    expect(screen.getByText("No plain summary yet.")).toBeInTheDocument();
  });
});
