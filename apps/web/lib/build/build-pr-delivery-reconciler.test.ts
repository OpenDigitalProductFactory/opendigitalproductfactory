import { describe, expect, it } from "vitest";

import { decideBuildPrDeliveryAction } from "./build-pr-delivery-reconciler";
import { createBuildPrDeliveryState } from "./build-pr-delivery-state";

const state = createBuildPrDeliveryState({
  repository: "o/r",
  prNumber: 42,
  prUrl: "https://github.com/o/r/pull/42",
});

describe("decideBuildPrDeliveryAction", () => {
  it("queues an evidence-cleared exact head once", () => {
    expect(decideBuildPrDeliveryAction({
      state,
      readiness: { kind: "ready", headSha: "abc" },
    })).toEqual({ kind: "queue", headSha: "abc" });
    expect(decideBuildPrDeliveryAction({
      state: { ...state, lastActuatedHeadSha: "abc", status: "queued" },
      readiness: { kind: "ready", headSha: "abc" },
    })).toEqual({ kind: "wait", status: "queued", headSha: "abc", reason: "already-actuated" });
  });

  it("updates a stale head within budget and escalates when exhausted", () => {
    expect(decideBuildPrDeliveryAction({
      state,
      readiness: { kind: "behind", headSha: "abc" },
    })).toEqual({ kind: "update-branch", headSha: "abc" });
    expect(decideBuildPrDeliveryAction({
      state: { ...state, staleUpdateAttempts: 2 },
      readiness: { kind: "behind", headSha: "abc" },
    })).toEqual({ kind: "escalate", status: "escalated", headSha: "abc", reason: "stale-update-budget-exhausted" });
  });

  it("never auto-edits conflicts and honors closure", () => {
    expect(decideBuildPrDeliveryAction({
      state,
      readiness: { kind: "conflict", headSha: "abc" },
    })).toEqual({ kind: "escalate", status: "escalated", headSha: "abc", reason: "true-merge-conflict" });
    expect(decideBuildPrDeliveryAction({
      state,
      readiness: { kind: "closed", headSha: "abc" },
    })).toEqual({ kind: "escalate", status: "closed", headSha: "abc", reason: "pull-request-closed-unmerged" });
  });

  it("keeps merge distinct from governed deployment", () => {
    expect(decideBuildPrDeliveryAction({
      state,
      readiness: { kind: "merged", headSha: "abc" },
    })).toEqual({ kind: "wait", status: "awaiting-release", headSha: "abc", reason: "merged-awaiting-governed-release" });
  });

  it("parks checks and bounds unknown observations", () => {
    expect(decideBuildPrDeliveryAction({
      state,
      readiness: { kind: "checking", headSha: "abc", reason: "checks-pending" },
    })).toEqual({ kind: "wait", status: "checking", headSha: "abc", reason: "checks-pending" });
    expect(decideBuildPrDeliveryAction({
      state: { ...state, reconciliationAttempts: 6 },
      readiness: { kind: "unknown", headSha: "abc", reason: "merge-state-unknown" },
    })).toEqual({ kind: "escalate", status: "escalated", headSha: "abc", reason: "observation-budget-exhausted:merge-state-unknown" });
  });
});
