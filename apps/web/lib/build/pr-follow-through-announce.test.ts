import { describe, expect, it, vi } from "vitest";

import { announcePrFollowThrough, PR_FOLLOW_THROUGH_ACTIVITY_KIND, resolvePrFollowThroughPosture } from "./pr-follow-through-announce";
import { createPrFollowThrough, decidePrFollowThrough } from "./pr-follow-through";

const room = { id: "row-1", capsuleId: "WC-1", featureBuildId: null, prNumber: 42, prUrl: "https://github.com/o/r/pull/42" };
const red = { kind: "checking", headSha: "sha1", reason: "checks-failing" } as const;
const defect = [{ name: "typecheck", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://x/9", workflowRunId: 9 }];

function deps() {
  return { recordActivity: vi.fn().mockResolvedValue(undefined), raiseIssue: vi.fn().mockResolvedValue(undefined) };
}

describe("announcePrFollowThrough", () => {
  it("raises a staged repair once per head: on the room and to the escalation inbox", async () => {
    const decision = decidePrFollowThrough({ followThrough: createPrFollowThrough(), readiness: red, checks: defect, authority: "propose" });
    const d = deps();
    await expect(announcePrFollowThrough({ room, priorAttentionKey: null, decision, deps: d })).resolves.toBe("announced");
    expect(d.recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      roomId: "row-1",
      kind: PR_FOLLOW_THROUGH_ACTIVITY_KIND,
      payload: expect.objectContaining({ decision: "repair", mode: "propose", headSha: "sha1" }),
    }));
    expect(d.raiseIssue).toHaveBeenCalledWith(expect.objectContaining({
      dedupeKey: "WC-1:follow-through:repair-propose:sha1",
      selfFixClass: "needs-human",
    }));

    const again = deps();
    await expect(announcePrFollowThrough({
      room,
      priorAttentionKey: decision.followThrough.attentionKey,
      decision: { ...decision },
      deps: again,
    })).resolves.toBe("quiet");
    expect(again.recordActivity).not.toHaveBeenCalled();
  });

  it("records a quiet room's red CI on the room without paging anyone", async () => {
    const decision = decidePrFollowThrough({ followThrough: createPrFollowThrough(), readiness: red, checks: defect, authority: "record" });
    const d = deps();
    await announcePrFollowThrough({ room, priorAttentionKey: null, decision, deps: d });
    expect(d.recordActivity).toHaveBeenCalledTimes(1);
    expect(d.raiseIssue).not.toHaveBeenCalled();
  });

  it("records a dispatched repair and an infrastructure re-run as room evidence only", async () => {
    const dispatched = decidePrFollowThrough({ followThrough: createPrFollowThrough(), readiness: red, checks: defect, authority: "dispatch" });
    const d = deps();
    await announcePrFollowThrough({ room, priorAttentionKey: null, decision: dispatched, deps: d });
    expect(d.recordActivity).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ decision: "repair", mode: "dispatch" }) }));
    expect(d.raiseIssue).not.toHaveBeenCalled();

    const rerun = decidePrFollowThrough({
      followThrough: createPrFollowThrough(),
      readiness: red,
      checks: [{ name: "build", status: "COMPLETED", conclusion: "CANCELLED", workflowRunId: 5 }],
      authority: "dispatch",
    });
    const r = deps();
    await announcePrFollowThrough({ room, priorAttentionKey: null, decision: rerun, deps: r });
    expect(r.recordActivity).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ decision: "rerun-infrastructure", workflowRunIds: [5] }) }));
    expect(r.raiseIssue).not.toHaveBeenCalled();
  });

  it("says nothing when CI is not red", async () => {
    const decision = decidePrFollowThrough({ followThrough: createPrFollowThrough(), readiness: { kind: "ready", headSha: "sha1" }, checks: [], authority: "dispatch" });
    const d = deps();
    await expect(announcePrFollowThrough({ room, priorAttentionKey: null, decision, deps: d })).resolves.toBe("quiet");
    expect(d.recordActivity).not.toHaveBeenCalled();
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
