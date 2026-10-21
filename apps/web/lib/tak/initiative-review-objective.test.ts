import { describe, expect, it } from "vitest";

import { formatInitiativeReviewObjective } from "./initiative-review-objective";

const base = {
  itemId: "BI-1", workroomId: "WC-1", repositoryFullName: "o/r", branchName: "build/FB-1", headSha: "abc",
  toolName: "record_initiative_design_review", independent: true, eligibleEvidenceActivityIds: null,
  artifact: { kind: "feature-build-revision" as const, revisionId: "rev-1", valueDigest: "d" },
};

describe("formatInitiativeReviewObjective for a Build Studio revision", () => {
  it("names the design for the design gates, unchanged", () => {
    expect(formatInitiativeReviewObjective({ ...base, gate: "spec-approval" })).toContain("accepted Build Studio design revision rev-1");
  });

  it("names the implementation plan for a plan review (BI-6F2872FC)", () => {
    expect(formatInitiativeReviewObjective({ ...base, gate: "plan-review" })).toContain("accepted Build Studio implementation plan revision rev-1");
  });
});
