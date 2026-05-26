import { describe, expect, it } from "vitest";
import { groupFounderReviewCandidates, projectFounderReviewCandidate } from "./queue";

describe("founder review queue", () => {
  it("projects unresolved decision interactions into review cards", () => {
    const candidate = projectFounderReviewCandidate({
      interactionId: "DI-1",
      question: "Should the interface hide raw traces?",
      options: ["Hide by default", "Show raw traces"],
      outcomeType: "defer",
      outcomePayload: { unresolvedReason: "principle-gap" },
      buildId: "FB-1",
      taskRunId: null,
      routeContext: "/build",
      createdAt: new Date("2026-05-26T12:00:00.000Z"),
    });

    expect(candidate.id).toBe("DI-1");
    expect(candidate.unresolvedReason).toBe("principle-gap");
    expect(candidate.unresolvedReasonLabel).toBe("Principle gap");
    expect(candidate.primaryActionLabel).toBe("Clarify founder principle");
    expect(candidate.links.buildHref).toBe("/build?buildId=FB-1");
  });

  it("groups projected candidates by human-readable reason", () => {
    const groups = groupFounderReviewCandidates([
      projectFounderReviewCandidate({
        interactionId: "DI-1",
        question: "Clarify principle?",
        options: [],
        outcomeType: "defer",
        outcomePayload: { unresolvedReason: "principle-gap" },
        buildId: null,
        taskRunId: null,
        routeContext: "/build",
        createdAt: new Date("2026-05-26T12:00:00.000Z"),
      }),
      projectFounderReviewCandidate({
        interactionId: "DI-2",
        question: "Need evidence?",
        options: [],
        outcomeType: "defer",
        outcomePayload: { unresolvedReason: "evidence-gap" },
        buildId: null,
        taskRunId: "TR-1",
        routeContext: "/build",
        createdAt: new Date("2026-05-26T12:05:00.000Z"),
      }),
    ]);

    expect(groups.map((group) => group.label)).toEqual(["Principle gap", "Evidence gap"]);
    expect(groups[0]?.items).toHaveLength(1);
  });
});
