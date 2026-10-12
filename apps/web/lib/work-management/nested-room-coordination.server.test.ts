import { describe, expect, it, vi } from "vitest";
import { loadNestedRoomCoordination, resolveNestedRoomStallRecipient } from "./nested-room-coordination.server";

const database = () => ({
  workroomRelation: { findMany: vi.fn().mockImplementation(async ({ where }) =>
    where.toWorkroomId.in.includes("child")
      ? [{ fromWorkroomId: "parent", toWorkroomId: "child", relation: "contains" }] : []) },
  workroomParticipant: { findMany: vi.fn().mockResolvedValue([
    { workroomId: "child", roles: ["coordinator"], principal: { id: "p-child", kind: "agent", status: "active", displayName: "Child reviewer", aliases: [{ aliasType: "agent", aliasValue: "AGT-181" }] } },
    { workroomId: "parent", roles: ["coordinator"], principal: { id: "p-human", kind: "human", status: "active", displayName: "Recorded human", aliases: [] } },
  ]) },
  agent: { findMany: vi.fn().mockResolvedValue([]) },
  principal: { findMany: vi.fn().mockResolvedValue([]) },
  platformRole: { findMany: vi.fn().mockResolvedValue([]) },
  user: { findUnique: vi.fn().mockResolvedValue(null) },
});

describe("internal drive recipient binding", () => {
  it("uses the terminal person's unique current user binding", async () => {
    const db = { ...database(), principalAlias: { findMany: vi.fn().mockResolvedValue([{ aliasValue: "recorded-user" }]) } };
    db.user.findUnique.mockResolvedValue({ isActive: true, isSuperuser: false, groups: [] });
    expect(await resolveNestedRoomStallRecipient(db, { roomId: "child" })).toBe("recorded-user");
    expect(db.principalAlias.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ principalId: "p-human", aliasType: "user", issuer: "" }), take: 2,
    }));
  });
  it.each([{ aliases: [] }, { aliases: [{ aliasValue: "one" }, { aliasValue: "two" }] }])("does not guess a missing or ambiguous user binding", async ({ aliases }) => {
    const db = { ...database(), principalAlias: { findMany: vi.fn().mockResolvedValue(aliases) } };
    expect(await resolveNestedRoomStallRecipient(db, { roomId: "child" })).toBeNull();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });
  it("does not deliver to a deactivated user", async () => {
    const db = { ...database(), principalAlias: { findMany: vi.fn().mockResolvedValue([{ aliasValue: "former-user" }]) } };
    expect(await resolveNestedRoomStallRecipient(db, { roomId: "child" })).toBeNull();
  });
});

describe("authorized nested room projection", () => {
  it("does not read participants or continue walking beyond an inaccessible parent", async () => {
    const db = database();
    const canReadRoom = vi.fn().mockImplementation(async roomId => roomId === "child");
    const result = await loadNestedRoomCoordination(db, { roomId: "child", canReadRoom });
    expect(result.escalation).toMatchObject({ state: "setup-required", reason: "incomplete-responsibility-lineage", steps: [] });
    expect(db.workroomParticipant.findMany).not.toHaveBeenCalled();
    expect(db.workroomRelation.findMany).toHaveBeenCalledOnce();
    expect(canReadRoom).toHaveBeenCalledWith("parent");
    expect(JSON.stringify(result)).not.toContain("Recorded human");
  });
  it("reads no lineage or participants when the subject room itself is denied", async () => {
    const db = database();
    const result = await loadNestedRoomCoordination(db, { roomId: "child", canReadRoom: async () => false });
    expect(result.escalation).toMatchObject({ state: "setup-required", reason: "incomplete-responsibility-lineage", steps: [] });
    expect(db.workroomRelation.findMany).not.toHaveBeenCalled();
    expect(db.workroomParticipant.findMany).not.toHaveBeenCalled();
  });
  it("shares the existing bounded relation walk and uses persisted coordinators", async () => {
    const db = database();
    const result = await loadNestedRoomCoordination(db, { roomId: "child", canReadRoom: async () => true });
    expect(result.escalation).toMatchObject({ state: "resolved", steps: [
      { ref: "p-child", displayName: "Child reviewer" }, { ref: "p-human", displayName: "Recorded human" },
    ] });
    expect(result.delegations).toHaveLength(1);
    expect(db.workroomParticipant.findMany).toHaveBeenCalledOnce();
    expect(db.platformRole.findMany).not.toHaveBeenCalled();
  });
  it("resolves a registry escalation to its active named human role holder", async () => {
    const db = database();
    db.workroomParticipant.findMany.mockResolvedValue([
      { workroomId: "child", roles: ["coordinator"], principal: { id: "p-child", kind: "agent", status: "active", displayName: "Child reviewer", aliases: [{ aliasType: "agent", aliasValue: "AGT-181" }] } },
      { workroomId: "parent", roles: ["coordinator"], principal: { id: "p-parent", kind: "agent", status: "active", displayName: "Parent owner", aliases: [{ aliasType: "agent", aliasValue: "AGT-182" }] } },
    ]);
    db.agent.findMany.mockResolvedValue([{ agentId: "AGT-182", displayName: "Parent owner", escalatesTo: "HR-OWNER" }]);
    db.platformRole.findMany.mockResolvedValue([{ roleId: "HR-OWNER", name: "Responsible human", users: [{ userId: "human-user" }] }]);
    db.user.findUnique.mockResolvedValue({ isActive: true, isSuperuser: false, groups: [{ platformRole: { roleId: "HR-OWNER" } }] });
    db.principal.findMany.mockResolvedValue([{ id: "p-human", kind: "human", status: "active", displayName: "Alex Morgan" }]);
    const result = await loadNestedRoomCoordination(db, { roomId: "child", canReadRoom: async () => true });
    expect(result.escalation).toMatchObject({ state: "resolved", steps: [
      { displayName: "Child reviewer" }, { displayName: "Parent owner" },
      { displayName: "Responsible human" }, { displayName: "Alex Morgan" },
    ] });
    expect(db.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "human-user" } }));
  });
  it("does not accept an inactive principal as a recorded coordinator", async () => {
    const db = database();
    db.workroomParticipant.findMany.mockResolvedValue([
      { workroomId: "child", roles: ["coordinator"], principal: { id: "p-inactive", kind: "human", status: "inactive", displayName: "Former owner", aliases: [] } },
    ]);
    const result = await loadNestedRoomCoordination(db, { roomId: "child", canReadRoom: async () => true });
    expect(result.escalation).toMatchObject({ state: "setup-required", reason: "coordinator-not-recorded" });
    expect(JSON.stringify(result)).not.toContain("Former owner");
    expect(db.agent.findMany).not.toHaveBeenCalled();
  });
  it("does not select a human whose role membership changed during the read", async () => {
    const db = database();
    db.workroomRelation.findMany.mockResolvedValue([]);
    db.workroomParticipant.findMany.mockResolvedValue([
      { workroomId: "child", roles: ["coordinator"], principal: { id: "p-child", kind: "agent", status: "active", displayName: "Child reviewer", aliases: [{ aliasType: "agent", aliasValue: "AGT-181" }] } },
    ]);
    db.agent.findMany.mockResolvedValue([{ agentId: "AGT-181", displayName: "Child reviewer", escalatesTo: "HR-OWNER" }]);
    db.platformRole.findMany.mockResolvedValue([{ roleId: "HR-OWNER", name: "Responsible human", users: [{ userId: "former-owner" }] }]);
    db.user.findUnique.mockResolvedValue({ isActive: true, isSuperuser: true, groups: [] });
    db.principal.findMany.mockResolvedValue([{ id: "p-human", kind: "human", status: "active", displayName: "Former owner" }]);
    const result = await loadNestedRoomCoordination(db, { roomId: "child", canReadRoom: async () => true });
    expect(result.escalation).toMatchObject({ state: "setup-required", reason: "human-role-unfilled" });
    expect(db.principal.findMany).not.toHaveBeenCalled();
  });
  it("reports a truncated coordinator read without presenting a route", async () => {
    const db = database();
    db.workroomParticipant.findMany.mockResolvedValue(Array.from({ length: 1001 }, () => ({})));
    const result = await loadNestedRoomCoordination(db, { roomId: "child", canReadRoom: async () => true });
    expect(result).toEqual({ delegations: [], escalation: { state: "setup-required", reason: "coordinator-read-incomplete", steps: [] } });
    expect(db.agent.findMany).not.toHaveBeenCalled();
  });
});
