import { describe, expect, it } from "vitest";

import type { ReviewResult } from "@/lib/feature-build-types";
import {
  buildReviewBranchArtifacts,
  collectReviewerVerdicts,
  type ReviewBranchInput,
} from "./build-reviewers";

const inconclusiveReview: ReviewResult = {
  decision: "inconclusive",
  issues: [],
  summary: "Reviewer capacity was unavailable.",
  inconclusiveReason: "capacity-exhausted",
};

describe("infrastructure-inconclusive reviewer results", () => {
  it("keeps an inconclusive branch out of semantic consensus", () => {
    const inputs: ReviewBranchInput[] = [
      {
        branchNodeId: "reviewer-1",
        role: "reviewer",
        review: inconclusiveReview,
      },
    ];

    const artifact = buildReviewBranchArtifacts(inputs)[0];
    expect(artifact).toMatchObject({
      completed: false,
      failureReason: "inconclusive: capacity-exhausted",
    });
    expect(artifact).not.toHaveProperty("recommendation");
  });

  it("preserves inconclusive as a third reviewer-verdict state", () => {
    expect(collectReviewerVerdicts(inconclusiveReview, null, null)[0]).toMatchObject({
      source: "reviewer-1",
      decision: "inconclusive",
      issueCounts: { critical: 0, important: 0, minor: 0 },
    });
  });
});
