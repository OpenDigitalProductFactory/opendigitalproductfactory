import { describe, expect, it } from "vitest";

import { appendRoomPolicyParticipant } from "./room-policy";
import { readWorkspaceRoomPolicy } from "./workspace-room-access";

function latestPolicy(evidence: unknown) {
  return readWorkspaceRoomPolicy(evidence);
}

describe("appendRoomPolicyParticipant", () => {
  it("admits an invitee with action rights when canAct", () => {
    const out = appendRoomPolicyParticipant(null, {
      principalRef: "PRN-invitee",
      roles: ["contributor"],
      canAct: true,
    });
    const policy = latestPolicy(out);
    expect(policy.admittedPrincipalRefs).toContain("PRN-invitee");
    expect(policy.actionPrincipalRefs).toContain("PRN-invitee");
    expect(policy.participants?.[0]).toMatchObject({ principalRef: "PRN-invitee", roles: ["contributor"] });
  });

  it("admits read-only (content, not action) when canAct is false", () => {
    const out = appendRoomPolicyParticipant(null, {
      principalRef: "PRN-observer",
      roles: ["observer"],
      canAct: false,
    });
    const policy = latestPolicy(out);
    expect(policy.admittedPrincipalRefs).toContain("PRN-observer");
    expect(policy.actionPrincipalRefs ?? []).not.toContain("PRN-observer");
  });

  it("appends (latest-wins) without clobbering prior evidence", () => {
    const prior = [{ workroomCycle: { boundary: 1 } }, { workroomPolicy: { admittedPrincipalRefs: ["PRN-a"], actionPrincipalRefs: ["PRN-a"], discoverablePrincipalRefs: [], sensitivityCeiling: "internal", participants: [] } }];
    const out = appendRoomPolicyParticipant(prior, { principalRef: "PRN-b", roles: ["contributor"], canAct: true });
    // prior entries preserved
    expect(out.length).toBe(prior.length + 1);
    expect(out[0]).toEqual({ workroomCycle: { boundary: 1 } });
    // latest policy now admits both a (carried) and b (new)
    const policy = latestPolicy(out);
    expect(policy.admittedPrincipalRefs).toEqual(expect.arrayContaining(["PRN-a", "PRN-b"]));
  });

  it("de-dupes a re-invited principal in the participants list", () => {
    const first = appendRoomPolicyParticipant(null, { principalRef: "PRN-x", roles: ["observer"], canAct: false });
    const second = appendRoomPolicyParticipant(first, { principalRef: "PRN-x", roles: ["contributor"], canAct: true });
    const policy = latestPolicy(second);
    const xs = (policy.participants ?? []).filter((p) => p.principalRef === "PRN-x");
    expect(xs).toHaveLength(1);
    expect(xs[0].roles).toEqual(["contributor"]);
    expect(policy.actionPrincipalRefs).toContain("PRN-x");
  });

  // BI-16DA79C5: the first invite into a room wrote a policy admitting only the
  // invitee. Access treats an explicit policy as a restriction, so the room's
  // own coordinator and assistant were locked out of their room.
  it("keeps the room's current members admitted when it writes the first policy", () => {
    const out = appendRoomPolicyParticipant(
      null,
      { principalRef: "PRN-reviewer", roles: ["contributor"], canAct: true },
      [
        { principalRef: "PRN-owner", canAct: true },
        { principalRef: "PRN-assistant", canAct: true },
        { principalRef: "PRN-reader", canAct: false },
      ],
    );
    const policy = latestPolicy(out);
    expect(policy.admittedPrincipalRefs).toEqual(expect.arrayContaining(["PRN-owner", "PRN-assistant", "PRN-reader", "PRN-reviewer"]));
    expect(policy.actionPrincipalRefs).toEqual(expect.arrayContaining(["PRN-owner", "PRN-assistant", "PRN-reviewer"]));
    expect(policy.actionPrincipalRefs).not.toContain("PRN-reader");
  });

  it("re-admits current members a narrower earlier invite policy left out", () => {
    const broken = [{ workroomPolicy: { admittedPrincipalRefs: ["PRN-reviewer"], actionPrincipalRefs: ["PRN-reviewer"], discoverablePrincipalRefs: [], participants: [] } }];
    const out = appendRoomPolicyParticipant(broken, { principalRef: "PRN-ea", roles: ["contributor"], canAct: true }, [{ principalRef: "PRN-owner", canAct: true }]);
    expect(latestPolicy(out).actionPrincipalRefs).toEqual(expect.arrayContaining(["PRN-reviewer", "PRN-owner", "PRN-ea"]));
  });
});

