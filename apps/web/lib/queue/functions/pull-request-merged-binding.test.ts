import { describe, expect, it } from "vitest";

import { planMergeBinding, type MergeBindingCandidate } from "./pull-request-merged-binding";

const room = (overrides: Partial<MergeBindingCandidate> = {}): MergeBindingCandidate => ({
  id: "row-1",
  capsuleId: "WC-1B73A988",
  headBranch: "fix/thing",
  pullRequestNumber: null,
  ...overrides,
});

describe("planMergeBinding", () => {
  it("binds an unbound room to the pull request that merged its branch", () => {
    expect(planMergeBinding(room(), 5228)).toEqual({
      bind: true,
      roomId: "row-1",
      capsuleId: "WC-1B73A988",
      pullRequestNumber: 5228,
    });
  });

  // GitHub re-delivers webhooks. A second delivery must be a no-op, not a
  // second write — the subscriber has to be idempotent by construction rather
  // than by luck.
  it("is idempotent: a re-delivered webhook finds the room already bound", () => {
    expect(planMergeBinding(room({ pullRequestNumber: 5228 }), 5228)).toEqual({
      bind: false,
      reason: "already-bound",
    });
  });

  // Two answers is a conflict a person should see. Silently repointing would
  // erase the record of which PR actually delivered the room's work.
  it("never repoints a room already bound to a different pull request", () => {
    expect(planMergeBinding(room({ pullRequestNumber: 5001 }), 5228)).toEqual({
      bind: false,
      reason: "bound-to-another-pull-request",
    });
  });

  it("reports plainly when no room claims the branch, which is normal", () => {
    expect(planMergeBinding(null, 5228)).toEqual({
      bind: false,
      reason: "no-room-for-branch",
    });
  });
});
