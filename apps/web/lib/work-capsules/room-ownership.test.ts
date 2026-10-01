// BI-36FC2981 — a delivery room is born owned: the person the work is for is
// its Process Overseer, and their assistant is admitted. Decisions somebody
// already made (an existing owner, a removal) always stand.
import { describe, expect, it, vi } from "vitest";

import {
  describeRoomOwnership,
  establishRoomOwnership,
  resolveRoomOwnershipPrincipals,
  ROOM_ASSISTANT_REASON,
  ROOM_OWNERSHIP_REASON,
} from "./room-ownership";

type Row = { id: string; principalId: string; roles: string[]; lifecycle: string };

function participants(rows: Row[] = []) {
  return {
    workroomParticipant: {
      findMany: vi.fn(async () => rows),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
  };
}

describe("resolveRoomOwnershipPrincipals", () => {
  const userPrincipal = vi.fn(async () => "PRN-HUMAN-FROM-USER");

  it("OAuth: the token's human owns the room and the assistant acts for them", async () => {
    await expect(resolveRoomOwnershipPrincipals(
      { userId: "u1", agentId: "AGT-EXT-CODEX", principalId: "HUMAN", agentPrincipalId: "ASSISTANT" },
      userPrincipal,
    )).resolves.toEqual({ ownerPrincipalId: "HUMAN", assistantPrincipalId: "ASSISTANT" });
  });

  it("a token with no agent: the person is the owner and there is no assistant", async () => {
    await expect(resolveRoomOwnershipPrincipals(
      { userId: "u1", agentId: null, principalId: "HUMAN" },
      userPrincipal,
    )).resolves.toEqual({ ownerPrincipalId: "HUMAN", assistantPrincipalId: null });
  });

  it("an agent acting without OAuth: the owner is its user, the agent is the assistant", async () => {
    await expect(resolveRoomOwnershipPrincipals(
      { userId: "u1", agentId: "AGT-WS-BUILD", principalId: "AGENT" },
      userPrincipal,
    )).resolves.toEqual({ ownerPrincipalId: "PRN-HUMAN-FROM-USER", assistantPrincipalId: "AGENT" });
    expect(userPrincipal).toHaveBeenCalledWith("u1");
  });
});

describe("establishRoomOwnership", () => {
  it("makes the owner the coordinator and admits the assistant as a contributor", async () => {
    const db = participants();
    const outcome = await establishRoomOwnership(db, {
      workroomId: "room-1", ownerPrincipalId: "HUMAN", assistantPrincipalId: "ASSISTANT",
    });
    expect(outcome).toMatchObject({ coordinatorPrincipalId: "HUMAN", ownerAppointed: true, assistantAdmitted: true });
    expect(db.workroomParticipant.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      principalId: "HUMAN", roles: ["coordinator"], assignmentSource: "explicit", enteredReason: ROOM_OWNERSHIP_REASON,
    }) });
    expect(db.workroomParticipant.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      principalId: "ASSISTANT", roles: ["contributor"], enteredReason: ROOM_ASSISTANT_REASON,
    }) });
  });

  it("keeps an existing owner and still admits the assistant", async () => {
    const db = participants([{ id: "p1", principalId: "SOMEONE", roles: ["coordinator"], lifecycle: "active" }]);
    const outcome = await establishRoomOwnership(db, {
      workroomId: "room-1", ownerPrincipalId: "HUMAN", assistantPrincipalId: "ASSISTANT",
    });
    expect(outcome).toMatchObject({ coordinatorPrincipalId: "SOMEONE", ownerAppointed: false, assistantAdmitted: true });
    expect(db.workroomParticipant.create).toHaveBeenCalledTimes(1);
    expect(db.workroomParticipant.update).not.toHaveBeenCalled();
  });

  it("adds the coordinator role to an owner already in the room as a contributor", async () => {
    const db = participants([{ id: "p1", principalId: "HUMAN", roles: ["contributor"], lifecycle: "active" }]);
    const outcome = await establishRoomOwnership(db, {
      workroomId: "room-1", ownerPrincipalId: "HUMAN", assistantPrincipalId: null,
    });
    expect(outcome.ownerAppointed).toBe(true);
    expect(db.workroomParticipant.update).toHaveBeenCalledWith({
      where: { id: "p1" }, data: { roles: ["contributor", "coordinator"] },
    });
  });

  it("never re-admits a removed owner or a removed assistant", async () => {
    const db = participants([
      { id: "p1", principalId: "HUMAN", roles: ["coordinator"], lifecycle: "removed" },
      { id: "p2", principalId: "ASSISTANT", roles: ["contributor"], lifecycle: "removed" },
    ]);
    const outcome = await establishRoomOwnership(db, {
      workroomId: "room-1", ownerPrincipalId: "HUMAN", assistantPrincipalId: "ASSISTANT",
    });
    expect(outcome).toMatchObject({ ownerAppointed: false, assistantAdmitted: false, coordinatorPrincipalId: null });
    expect(outcome.skipped).toHaveLength(2);
    expect(db.workroomParticipant.create).not.toHaveBeenCalled();
    expect(db.workroomParticipant.update).not.toHaveBeenCalled();
  });

  it("reports an unresolved owner instead of inventing one", async () => {
    const db = participants();
    const outcome = await establishRoomOwnership(db, {
      workroomId: "room-1", ownerPrincipalId: null, assistantPrincipalId: null,
    });
    expect(outcome.ownerAppointed).toBe(false);
    expect(outcome.skipped).toEqual(["No person could be resolved as the room's owner."]);
  });

  it("does not admit the owner twice when the assistant resolves to the same principal", async () => {
    const db = participants();
    await establishRoomOwnership(db, { workroomId: "room-1", ownerPrincipalId: "HUMAN", assistantPrincipalId: "HUMAN" });
    expect(db.workroomParticipant.create).toHaveBeenCalledTimes(1);
  });
});

describe("describeRoomOwnership", () => {
  it("says nothing when nothing changed", () => {
    expect(describeRoomOwnership({ coordinatorPrincipalId: "X", ownerAppointed: false, assistantAdmitted: false, skipped: [] }))
      .toBeNull();
  });

  it("names both changes in one plain sentence", () => {
    expect(describeRoomOwnership({ coordinatorPrincipalId: "X", ownerAppointed: true, assistantAdmitted: true, skipped: [] }))
      .toBe("The person this work is for now owns the room, and their assistant was admitted.");
  });
});
