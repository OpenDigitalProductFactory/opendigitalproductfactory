// BI-E492F313 — neither repair loop may destroy recoverable work.

import { describe, expect, it } from "vitest";

import {
  outcomeKeepsBuildRecoverable,
  resolveReviewFixOutcome,
} from "./review-fix-outcome";

describe("resolveReviewFixOutcome", () => {
  it("reports repaired when the review no longer fails", () => {
    expect(resolveReviewFixOutcome({ reviewFailed: false, regenerated: true })).toBe("repaired");
    expect(resolveReviewFixOutcome({ reviewFailed: false, regenerated: false })).toBe("repaired");
  });

  it("escalates only when a regeneration actually produced a design to review", () => {
    expect(resolveReviewFixOutcome({ reviewFailed: true, regenerated: true }))
      .toBe("escalated-after-rounds");
  });

  // The live repro: every round failed to dispatch, so the design was never
  // re-examined — yet the platform escalated as though repair were exhausted,
  // abandoning the build and deferring the owner's backlog item.
  it("does NOT escalate when no round ever produced a design", () => {
    expect(resolveReviewFixOutcome({ reviewFailed: true, regenerated: false }))
      .toBe("blocked-no-regeneration");
  });
});

// The plan path's own repro: FB-62D7C0EC returned unparseable JSON on both
// attempts of the revision, so no plan was ever re-reviewed — yet the platform
// escalated as though repair were exhausted, abandoning the build and deferring
// the owner's backlog item along with a five-issue plan review.
describe("shared across both pre-build phases", () => {
  it("keeps a plan build recoverable when no revision was ever produced", () => {
    expect(resolveReviewFixOutcome({ reviewFailed: true, regenerated: false }))
      .toBe("blocked-no-regeneration");
    expect(outcomeKeepsBuildRecoverable("blocked-no-regeneration")).toBe(true);
  });

  it("still escalates a plan the platform revised and could not fix", () => {
    expect(resolveReviewFixOutcome({ reviewFailed: true, regenerated: true }))
      .toBe("escalated-after-rounds");
    expect(outcomeKeepsBuildRecoverable("escalated-after-rounds")).toBe(false);
  });
});

describe("outcomeKeepsBuildRecoverable", () => {
  it("keeps the build recoverable only for the no-regeneration case", () => {
    expect(outcomeKeepsBuildRecoverable("blocked-no-regeneration")).toBe(true);
    expect(outcomeKeepsBuildRecoverable("escalated-after-rounds")).toBe(false);
    expect(outcomeKeepsBuildRecoverable("repaired")).toBe(false);
  });
});
