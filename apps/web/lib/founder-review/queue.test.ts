import { describe, expect, expectTypeOf, it } from "vitest";
import type { WikiPerspective } from "@/lib/wiki/perspective-intent";
import {
  groupFounderReviewCandidates,
  projectFounderReviewCandidate,
  type FounderReviewCandidate,
} from "./queue";

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
    expect(candidate.perspective).toBe("wwmd");
    expect(candidate.links.buildHref).toBe("/build?buildId=FB-1");
    expect(candidate.links.decisionCanvasHref).toBe("/platform/ai/decisions/DI-1");
  });

  it("uses operating-policy wording for WWWD principle gaps", () => {
    const candidate = projectFounderReviewCandidate({
      interactionId: "DI-ORG",
      question: "Should we change the guarantee?",
      options: [],
      outcomeType: "defer",
      outcomePayload: { unresolvedReason: "principle-gap" },
      buildId: null,
      taskRunId: null,
      routeContext: "/storefront",
      createdAt: new Date("2026-05-26T12:00:00.000Z"),
      profile: {
        profileId: "profile-org",
        name: "WWWD Organization",
        kind: "organization",
      },
    });

    expect(candidate.perspective).toBe("wwwd");
    expect(candidate.profileLabel).toBe("WWWD Organization");
    expect(candidate.primaryActionLabel).toBe("Clarify operating policy");
  });

  // Reconciliation with PR #1343 (BI-F5179C9E): the candidate's perspective
  // field must use the canonical WikiPerspective enum. The default for a
  // missing profile is "wwmd" (founder-review queue legacy default).
  it("types `perspective` as the canonical WikiPerspective", () => {
    expectTypeOf<FounderReviewCandidate["perspective"]>().toEqualTypeOf<WikiPerspective>();
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
