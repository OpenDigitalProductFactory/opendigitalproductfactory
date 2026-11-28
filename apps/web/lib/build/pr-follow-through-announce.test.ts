import { describe, expect, it } from "vitest";

import { planPrFollowThroughAnnouncement, PR_FOLLOW_THROUGH_ACTIVITY_KIND, resolvePrFollowThroughPosture } from "./pr-follow-through-announce";
import { createPrFollowThrough, decidePrFollowThrough } from "./pr-follow-through";

const room = { id: "row-1", capsuleId: "WC-1", featureBuildId: null, prNumber: 42, prUrl: "https://github.com/o/r/pull/42" };
const red = { kind: "checking", headSha: "sha1", reason: "checks-failing" } as const;
const defect = [{ name: "typecheck", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://x/9", workflowRunId: 9 }];

describe("planPrFollowThroughAnnouncement", () => {
  it("plans a staged repair once per head for the room and the escalation inbox", () => {
    const decision = decidePrFollowThrough({ followThrough: createPrFollowThrough(), readiness: red, checks: defect, authority: "propose" });
    const plan = planPrFollowThroughAnnouncement({ room, priorAttentionKey: null, decision });
    expect(plan?.activity).toMatchObject({
      roomId: "row-1",
      kind: PR_FOLLOW_THROUGH_ACTIVITY_KIND,
      payload: expect.objectContaining({ decision: "repair", mode: "propose", headSha: "sha1" }),
    });
    expect(plan?.issue).toMatchObject({
      dedupeKey: "WC-1:follow-through:repair-propose:sha1",
      proposeBoundary: true,
    });

    expect(planPrFollowThroughAnnouncement({
      room,
      priorAttentionKey: decision.followThrough.attentionKey,
      decision: { ...decision },
    })).toBeNull();
  });

  it("records a quiet room's red CI on the room without paging anyone", () => {
    const decision = decidePrFollowThrough({ followThrough: createPrFollowThrough(), readiness: red, checks: defect, authority: "record" });
    expect(planPrFollowThroughAnnouncement({ room, priorAttentionKey: null, decision }))
      .toMatchObject({ activity: { payload: { mode: "record" } }, issue: null });
  });

  it("records a dispatched repair and an infrastructure re-run as room evidence only", () => {
    const dispatched = decidePrFollowThrough({ followThrough: createPrFollowThrough(), readiness: red, checks: defect, authority: "dispatch" });
    expect(planPrFollowThroughAnnouncement({ room, priorAttentionKey: null, decision: dispatched }))
      .toMatchObject({ activity: { payload: { decision: "repair", mode: "dispatch" } }, issue: null });

    const rerun = decidePrFollowThrough({
      followThrough: createPrFollowThrough(),
      readiness: red,
      checks: [{ name: "build", status: "COMPLETED", conclusion: "CANCELLED", workflowRunId: 5 }],
      authority: "dispatch",
    });
    expect(planPrFollowThroughAnnouncement({ room, priorAttentionKey: null, decision: rerun }))
      .toMatchObject({ activity: { payload: { decision: "rerun-infrastructure", workflowRunIds: [5] } }, issue: null });
  });

  it("says nothing when CI is not red", () => {
    const decision = decidePrFollowThrough({ followThrough: createPrFollowThrough(), readiness: { kind: "ready", headSha: "sha1" }, checks: [], authority: "dispatch" });
    expect(planPrFollowThroughAnnouncement({ room, priorAttentionKey: null, decision })).toBeNull();
  });
});

describe("resolvePrFollowThroughPosture", () => {
  it("reads the room's declared posture with the turn-authority precedence", () => {
    expect(resolvePrFollowThroughPosture({ scopeClaims: null, platformDefaultActionBoundary: null }))
      .toEqual({ authority: "propose", actuationAllowed: true, level: "balanced", boundary: null });
    expect(resolvePrFollowThroughPosture({ scopeClaims: null, platformDefaultActionBoundary: "preauthorized" }).authority)
      .toBe("dispatch");
    expect(resolvePrFollowThroughPosture({
      scopeClaims: [{ workroomPosture: { proactivityLevel: "quiet" }, recordedAt: "2026-10-01T00:00:00Z" }],
      platformDefaultActionBoundary: "preauthorized",
    })).toEqual(expect.objectContaining({ authority: "record", actuationAllowed: false }));
    expect(resolvePrFollowThroughPosture({
      scopeClaims: [{ workroomPosture: { actionBoundary: "advise" }, recordedAt: "2026-10-01T00:00:00Z" }],
      platformDefaultActionBoundary: "preauthorized",
    })).toEqual(expect.objectContaining({ authority: "record", actuationAllowed: false, boundary: "advise" }));
  });
});
