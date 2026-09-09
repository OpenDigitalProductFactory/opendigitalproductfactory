import { describe, expect, it } from "vitest";

import type { PullRequestObservation } from "@/lib/contributor-change-lanes/pull-request-observation";

import {
  describePullRequestBindingPlan,
  resolvePullRequestBindings,
  type BindablePullRequestRoom,
} from "./pull-request-binding";

const REPO = "OpenDigitalProductFactory/opendigitalproductfactory";

function observation(over: Partial<PullRequestObservation> = {}): PullRequestObservation {
  return {
    repositoryFullName: REPO,
    number: 5029,
    url: `https://github.com/${REPO}/pull/5029`,
    title: "Bounded delivery control plane pilot",
    headBranch: "feat/bounded-delivery-control-plane-pilot",
    headSha: "abc1234",
    state: "merged",
    isDraft: false,
    mergeStateStatus: null,
    mergeCommitSha: "def5678",
    mergedAt: "2026-09-03T21:38:35.000Z",
    providerUpdatedAt: "2026-09-03T21:38:35.000Z",
    observedAt: "2026-09-08T00:00:00.000Z",
    providerApiVersion: "github-rest/2022-11-28",
    observationFingerprint: "fp",
    ...over,
  } as PullRequestObservation;
}

function room(over: Partial<BindablePullRequestRoom> = {}): BindablePullRequestRoom {
  return {
    capsuleId: "WC-1B73A988",
    repositoryFullName: REPO,
    headBranch: "feat/bounded-delivery-control-plane-pilot",
    pullRequestNumber: null,
    pullRequestUrl: null,
    ...over,
  };
}

describe("resolvePullRequestBindings", () => {
  // The exact row that motivated this: WC-1B73A988 read `live` for three days on
  // a branch whose PR #5029 had already merged, because nothing bound the two.
  it("binds a room to the pull request its branch produced", () => {
    const plan = resolvePullRequestBindings({ rooms: [room()], observations: [observation()] });

    expect(plan.bindings).toEqual([
      {
        capsuleId: "WC-1B73A988",
        pullRequestNumber: 5029,
        pullRequestUrl: `https://github.com/${REPO}/pull/5029`,
        state: "merged",
      },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it("never overwrites a room that already carries an answer", () => {
    const plan = resolvePullRequestBindings({
      rooms: [room({ pullRequestNumber: 4242, pullRequestUrl: "https://example/4242" })],
      observations: [observation()],
    });

    expect(plan.bindings).toEqual([]);
    expect(plan.skipped).toEqual([{ capsuleId: "WC-1B73A988", reason: "already-bound" }]);
  });

  it("prefers the open pull request when a branch carries several", () => {
    const plan = resolvePullRequestBindings({
      rooms: [room()],
      observations: [
        observation({ number: 4817, state: "closed" }),
        observation({ number: 5029, state: "merged" }),
        observation({ number: 5100, state: "open" }),
      ],
    });

    expect(plan.bindings[0]?.pullRequestNumber).toBe(5100);
    expect(plan.bindings[0]?.state).toBe("open");
  });

  it("prefers the newest when several share the same state", () => {
    const plan = resolvePullRequestBindings({
      rooms: [room()],
      observations: [
        observation({ number: 4817, state: "closed" }),
        observation({ number: 4900, state: "closed" }),
      ],
    });

    expect(plan.bindings[0]?.pullRequestNumber).toBe(4900);
  });

  it("does not bind across repositories that happen to share a branch name", () => {
    const plan = resolvePullRequestBindings({
      rooms: [room({ repositoryFullName: "other/repo" })],
      observations: [observation()],
    });

    expect(plan.bindings).toEqual([]);
    expect(plan.skipped).toEqual([
      { capsuleId: "WC-1B73A988", reason: "no-observation-for-branch" },
    ]);
  });

  it("reports a room with no branch rather than silently passing over it", () => {
    const plan = resolvePullRequestBindings({
      rooms: [room({ capsuleId: "WC-BUILDSTUDIO", headBranch: null })],
      observations: [observation()],
    });

    expect(plan.bindings).toEqual([]);
    expect(plan.skipped).toEqual([{ capsuleId: "WC-BUILDSTUDIO", reason: "no-head-branch" }]);
  });

  it("is deterministic and idempotent across a re-run", () => {
    const rooms = [room({ capsuleId: "WC-B" }), room({ capsuleId: "WC-A" })];
    const observations = [observation()];

    const first = resolvePullRequestBindings({ rooms, observations });
    const second = resolvePullRequestBindings({ rooms, observations });
    expect(first).toEqual(second);
    expect(first.bindings.map((b) => b.capsuleId)).toEqual(["WC-A", "WC-B"]);

    // Applying the plan and re-running binds nothing further.
    const applied = rooms.map((r) => ({ ...r, pullRequestNumber: 5029 }));
    expect(resolvePullRequestBindings({ rooms: applied, observations }).bindings).toEqual([]);
  });
});

describe("describePullRequestBindingPlan", () => {
  // A sweep reporting only what it bound reads as complete coverage.
  it("names what it could not answer for, not only what it bound", () => {
    const plan = resolvePullRequestBindings({
      rooms: [
        room({ capsuleId: "WC-BOUND" }),
        room({ capsuleId: "WC-ALREADY", pullRequestNumber: 1 }),
        room({ capsuleId: "WC-NOBRANCH", headBranch: null }),
        room({ capsuleId: "WC-NOPR", headBranch: "feat/never-opened" }),
      ],
      observations: [observation()],
    });

    const sentence = describePullRequestBindingPlan(plan);
    expect(sentence).toContain("bound 1");
    expect(sentence).toContain("1 already bound");
    expect(sentence).toContain("1 with no branch");
    expect(sentence).toContain("1 whose branch has no observed PR");
  });
});
