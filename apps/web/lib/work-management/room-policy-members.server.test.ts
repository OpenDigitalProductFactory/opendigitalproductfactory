import { describe, expect, it } from "vitest";

import { loadRoomMembersForWorkItem } from "./room-policy-members.server";

// BI-16DA79C5: the members an invite must keep in the room's policy.
function fakeDb(participants: Array<{ principalId: string; ref: string; lifecycle: string; roles: string[] }>, holders: { createdBy?: string; requestedBy?: string; lease?: string }) {
  const principals = [{ id: "p-holder", principalId: "PRN-holder" }, { id: "p-left", principalId: "PRN-left" }];
  return {
    workroom: {
      findMany: async () => [{
        createdByPrincipalId: holders.createdBy ?? null,
        requestedByPrincipalId: holders.requestedBy ?? null,
        leaseHolderPrincipalId: holders.lease ?? null,
        participants: participants.map((p) => ({ principalId: p.principalId, lifecycle: p.lifecycle, roles: p.roles, principal: { principalId: p.ref } })),
      }],
    },
    principal: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => principals.filter((p) => where.id.in.includes(p.id)) },
  } as never;
}

describe("loadRoomMembersForWorkItem", () => {
  it("keeps active members with their action rights and the room's holders", async () => {
    const members = await loadRoomMembersForWorkItem("wi-1", fakeDb([
      { principalId: "p-owner", ref: "PRN-owner", lifecycle: "active", roles: ["coordinator"] },
      { principalId: "p-reader", ref: "PRN-reader", lifecycle: "active", roles: ["observer"] },
    ], { createdBy: "p-holder" }));
    expect(members).toEqual(expect.arrayContaining([
      { principalRef: "PRN-owner", canAct: true },
      { principalRef: "PRN-reader", canAct: false },
      { principalRef: "PRN-holder", canAct: true },
    ]));
  });

  it("leaves out someone who left the room, even if they created it", async () => {
    const members = await loadRoomMembersForWorkItem("wi-1", fakeDb([
      { principalId: "p-left", ref: "PRN-left", lifecycle: "removed", roles: ["coordinator"] },
    ], { createdBy: "p-left" }));
    expect(members).toEqual([]);
  });
});
