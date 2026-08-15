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
    const prior = [{ workRoomCycle: { boundary: 1 } }, { workRoomPolicy: { admittedPrincipalRefs: ["PRN-a"], actionPrincipalRefs: ["PRN-a"], discoverablePrincipalRefs: [], sensitivityCeiling: "internal", participants: [] } }];
    const out = appendRoomPolicyParticipant(prior, { principalRef: "PRN-b", roles: ["contributor"], canAct: true });
    // prior entries preserved
    expect(out.length).toBe(prior.length + 1);
    expect(out[0]).toEqual({ workRoomCycle: { boundary: 1 } });
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
});
