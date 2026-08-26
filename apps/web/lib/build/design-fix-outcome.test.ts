// BI-E492F313 — the repair loop must not destroy recoverable work.

import { describe, expect, it } from "vitest";

import {
  outcomeKeepsBuildRecoverable,
  resolveDesignFixOutcome,
} from "./design-fix-outcome";

describe("resolveDesignFixOutcome", () => {
  it("reports repaired when the review no longer fails", () => {
    expect(resolveDesignFixOutcome({ reviewFailed: false, regenerated: true })).toBe("repaired");
    expect(resolveDesignFixOutcome({ reviewFailed: false, regenerated: false })).toBe("repaired");
  });

  it("escalates only when a regeneration actually produced a design to review", () => {
    expect(resolveDesignFixOutcome({ reviewFailed: true, regenerated: true }))
      .toBe("escalated-after-rounds");
  });

  // The live repro: every round failed to dispatch, so the design was never
  // re-examined — yet the platform escalated as though repair were exhausted,
  // abandoning the build and deferring the owner's backlog item.
  it("does NOT escalate when no round ever produced a design", () => {
    expect(resolveDesignFixOutcome({ reviewFailed: true, regenerated: false }))
      .toBe("blocked-no-regeneration");
  });
});

describe("outcomeKeepsBuildRecoverable", () => {
  it("keeps the build recoverable only for the no-regeneration case", () => {
    expect(outcomeKeepsBuildRecoverable("blocked-no-regeneration")).toBe(true);
    expect(outcomeKeepsBuildRecoverable("escalated-after-rounds")).toBe(false);
    expect(outcomeKeepsBuildRecoverable("repaired")).toBe(false);
  });
});
