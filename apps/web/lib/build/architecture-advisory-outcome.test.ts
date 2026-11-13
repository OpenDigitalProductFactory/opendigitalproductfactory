import { describe, expect, it } from "vitest";

import {
  deriveArchitectureAdvisoryOutcomes,
  readReviewedArtifact,
  reviewedArtifactDigest,
  type AdvisoryForOutcome,
  type BuildForOutcome,
} from "./architecture-advisory-outcome";

const DESIGN_V1 = { problemStatement: "one", proposedApproach: "reuse the ledger" };
const DESIGN_V2 = { problemStatement: "one", proposedApproach: "reuse the ledger, no new table" };

function advisory(over: Partial<AdvisoryForOutcome> & { interactionId: string }): AdvisoryForOutcome {
  return {
    buildId: "FB-1",
    kind: "design",
    digest: reviewedArtifactDigest(DESIGN_V1),
    proposedOptionId: "revise-before-building",
    createdAt: new Date("2026-10-21T10:00:00Z"),
    ...over,
  };
}

function build(over: Partial<BuildForOutcome> = {}): BuildForOutcome {
  return { buildId: "FB-1", phase: "ideate", designDoc: DESIGN_V1, buildPlan: null, ...over };
}

describe("the reviewed document's digest", () => {
  it("ignores key order, so a re-saved but unchanged document is not a revision", () => {
    expect(reviewedArtifactDigest({ a: 1, b: { c: 2, d: 3 } })).toBe(reviewedArtifactDigest({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it("changes when the document's content changes", () => {
    expect(reviewedArtifactDigest(DESIGN_V1)).not.toBe(reviewedArtifactDigest(DESIGN_V2));
  });
});

describe("reading the reviewed artifact back from a decision", () => {
  it("returns the recorded build, kind and digest", () => {
    expect(readReviewedArtifact({ reviewedArtifact: { buildId: "FB-1", kind: "plan", digest: "abc" } })).toEqual({
      buildId: "FB-1",
      kind: "plan",
      digest: "abc",
    });
  });

  it("returns null for an advisory recorded before the subject was (no inference from the question text)", () => {
    expect(readReviewedArtifact({ caller: { agentId: "AGT-WS-EA" } })).toBeNull();
    expect(readReviewedArtifact({ reviewedArtifact: { buildId: "FB-1", kind: "brief", digest: "abc" } })).toBeNull();
    expect(readReviewedArtifact(null)).toBeNull();
  });
});

describe("resolving an architecture advisory from what happened to the document (BI-22601A38)", () => {
  it("a re-review of a changed document means the design was revised before building", () => {
    const first = advisory({ interactionId: "DI-1" });
    const second = advisory({
      interactionId: "DI-2",
      digest: reviewedArtifactDigest(DESIGN_V2),
      proposedOptionId: "aligned",
      createdAt: new Date("2026-10-21T11:00:00Z"),
    });
    const outcomes = deriveArchitectureAdvisoryOutcomes([first, second], [build({ designDoc: DESIGN_V2 })]);
    expect(outcomes.get("DI-1")).toEqual({
      chosenOptionId: "revise-before-building",
      agreement: true,
      signal: "re-reviewed-with-changed-document",
      resolvedAt: "2026-10-21T11:00:00.000Z",
      evidence: { buildId: "FB-1", kind: "design", laterInteractionId: "DI-2", buildPhase: "ideate" },
    });
    // The second review saw the final document, but the build has not moved on.
    expect(outcomes.has("DI-2")).toBe(false);
  });

  it("a build that moved past the reviewed phase with the same document means it was built as reviewed", () => {
    const only = advisory({ interactionId: "DI-1", proposedOptionId: "revise-before-building" });
    const outcomes = deriveArchitectureAdvisoryOutcomes([only], [build({ phase: "build" })]);
    expect(outcomes.get("DI-1")).toMatchObject({
      chosenOptionId: "aligned",
      agreement: false,
      signal: "advanced-unchanged",
      evidence: { buildId: "FB-1", kind: "design", laterInteractionId: null, buildPhase: "build" },
    });
  });

  it("a plan review resolves only once the build is past plan", () => {
    const plan = advisory({ interactionId: "DI-P", kind: "plan", digest: reviewedArtifactDigest({ tasks: [1] }), proposedOptionId: "aligned" });
    const stillPlanning = deriveArchitectureAdvisoryOutcomes([plan], [build({ phase: "plan", buildPlan: { tasks: [1] } })]);
    expect(stillPlanning.has("DI-P")).toBe(false);
    const building = deriveArchitectureAdvisoryOutcomes([plan], [build({ phase: "review", buildPlan: { tasks: [1] } })]);
    expect(building.get("DI-P")).toMatchObject({ chosenOptionId: "aligned", agreement: true, signal: "advanced-unchanged" });
  });

  it("a re-run on the same document is not a revision; the later run's fate decides", () => {
    const first = advisory({ interactionId: "DI-1" });
    const rerun = advisory({ interactionId: "DI-2", createdAt: new Date("2026-10-21T11:00:00Z") });
    const outcomes = deriveArchitectureAdvisoryOutcomes([rerun, first], [build({ phase: "plan" })]);
    expect(outcomes.get("DI-1")).toMatchObject({ chosenOptionId: "aligned", signal: "advanced-unchanged" });
    expect(outcomes.get("DI-2")).toMatchObject({ chosenOptionId: "aligned", signal: "advanced-unchanged" });
  });

  it("infers nothing when the record does not say what happened (AC-3)", () => {
    const one = advisory({ interactionId: "DI-1" });
    // Advanced, but the document changed without a re-review: which way is unknown.
    expect(deriveArchitectureAdvisoryOutcomes([one], [build({ phase: "build", designDoc: DESIGN_V2 })]).size).toBe(0);
    // Abandoned or failed: the build ended without saying anything about the design.
    expect(deriveArchitectureAdvisoryOutcomes([one], [build({ phase: "abandoned" })]).size).toBe(0);
    expect(deriveArchitectureAdvisoryOutcomes([one], [build({ phase: "failed" })]).size).toBe(0);
    // Still in the reviewed phase.
    expect(deriveArchitectureAdvisoryOutcomes([one], [build({ phase: "ideate" })]).size).toBe(0);
    // The build is gone.
    expect(deriveArchitectureAdvisoryOutcomes([one], []).size).toBe(0);
  });

  it("resolves nothing for an advisory that recommended nothing", () => {
    const none = advisory({ interactionId: "DI-1", proposedOptionId: null });
    expect(deriveArchitectureAdvisoryOutcomes([none], [build({ phase: "build" })]).size).toBe(0);
  });

  it("never compares a design review with a later plan review", () => {
    const design = advisory({ interactionId: "DI-D" });
    const plan = advisory({
      interactionId: "DI-P",
      kind: "plan",
      digest: reviewedArtifactDigest({ tasks: [1] }),
      createdAt: new Date("2026-10-21T11:00:00Z"),
    });
    const outcomes = deriveArchitectureAdvisoryOutcomes([design, plan], [build({ phase: "plan", buildPlan: { tasks: [1] } })]);
    expect(outcomes.get("DI-D")).toMatchObject({ signal: "advanced-unchanged", chosenOptionId: "aligned" });
  });
});
