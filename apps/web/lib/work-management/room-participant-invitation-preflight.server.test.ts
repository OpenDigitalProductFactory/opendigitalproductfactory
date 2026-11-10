import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ item: vi.fn(), access: vi.fn(), invitee: vi.fn(), ceiling: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { workItem: { findFirst: mocks.item } } }));
vi.mock("./room-agent-access.server", () => ({ resolveAgentRoomAccess: mocks.access }));
vi.mock("@/lib/identity/principal-linking", () => ({ ensureAgentPrincipalIdentity: mocks.invitee }));
vi.mock("./room-sensitivity-ceiling.server", () => ({ resolveWorkItemRoomSensitivityCeiling: mocks.ceiling }));

import { preflightRoomParticipantInvitation } from "./room-participant-invitation-preflight.server";

const invitationItem = {
  id: "work-item-row",
  itemId: "WI-1",
  sourceType: "backlog-item",
  sourceId: "BI-1",
  title: "Recover this room",
  evidence: [],
  assignedToAgentId: null,
  assignedToUserId: "owner",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.item.mockResolvedValue(invitationItem);
  mocks.access.mockResolvedValue({ decision: { level: "none", reason: "not-admitted" } });
});

describe("room participant invitation preflight", () => {
  it("resolves a backlog address and returns an actionable terminal refusal", async () => {
    const result = await preflightRoomParticipantInvitation({
      params: { caseKey: "backlog-item:BI-1", agentId: "AGT-EXT-CODEX" },
      userId: "owner",
      agentId: "AGT-EXT-CODEX",
    });

    expect(mocks.item).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [
      { sourceType: "backlog-item", sourceId: "BI-1" },
      { sourceType: "backlog-item", itemId: "BI-1" },
    ] } }));
    expect(result).toMatchObject({
      verdict: "deny",
      result: { error: "room_not_admitted", data: { recovery: {
        control: "room-participants", caseKey: "backlog-item:BI-1",
      } } },
    });
    if (result.verdict === "deny") expect(result.result.message).toContain("cannot invite itself");
  });

  it("resolves a capsule address through its canonical WorkItem anchor", async () => {
    await preflightRoomParticipantInvitation({
      params: { caseKey: "work-capsule:WC-1", agentId: "AGT-EXT-CODEX" },
      userId: "owner",
      agentId: "AGT-EXT-CODEX",
    });
    expect(mocks.item).toHaveBeenCalledWith(expect.objectContaining({
      where: { capsules: { some: { capsuleId: "WC-1" } } },
    }));
  });

  it("passes an already-admitted caller and returns the resolved item once", async () => {
    mocks.access.mockResolvedValue({ decision: { level: "action", reason: "assigned-coworker" } });
    await expect(preflightRoomParticipantInvitation({
      params: { caseKey: "backlog-item:BI-1", userId: "teammate" },
      userId: "owner",
      agentId: "AGT-EXT-CODEX",
    })).resolves.toMatchObject({
      verdict: "allow", agentId: "AGT-EXT-CODEX", caseKey: "backlog-item:BI-1",
    });
    expect(mocks.item).toHaveBeenCalledTimes(1);
  });

  it("validates the caller and target before reading room state", async () => {
    await expect(preflightRoomParticipantInvitation({ params: {}, userId: "owner" }))
      .resolves.toMatchObject({ verdict: "deny", result: { error: "invalid_caller" } });
    await expect(preflightRoomParticipantInvitation({
      params: { caseKey: "backlog-item:BI-1" }, userId: "owner", agentId: "codex",
    })).resolves.toMatchObject({ verdict: "deny", result: { error: "invalid_input" } });
    expect(mocks.item).not.toHaveBeenCalled();
  });
});

// BI-6AE64074: an invitee that cannot read the room is named before any card,
// and the owner can admit it and raise its data access in one approval.
describe("invitee data access", () => {
  const invite = (params: Record<string, unknown>) => preflightRoomParticipantInvitation({
    params: { caseKey: "backlog-item:BI-1", agentId: "change-reviewer", ...params },
    userId: "owner",
    agentId: "AGT-EXT-CLAUDE",
  });

  beforeEach(() => {
    mocks.access.mockResolvedValue({ decision: { level: "action", reason: "authorized" } });
    mocks.ceiling.mockResolvedValue("internal");
    mocks.invitee.mockResolvedValue({ principalId: "PRN-reviewer", displayName: "Change Reviewer", sensitivityClearance: ["public"] });
  });

  it("refuses a coworker that cannot read the room, naming both levels and the raise", async () => {
    const result = await invite({});
    expect(result).toMatchObject({
      verdict: "deny",
      result: {
        success: false,
        error: "invitee_clearance_below_room",
        data: { inviteeDataAccess: "public", roomLevel: "internal", recovery: { param: "raiseClearanceTo", value: "internal" } },
      },
    });
    if (result.verdict === "deny") {
      expect(result.result.message).toContain("Change Reviewer");
      expect(result.result.message).toContain("raiseClearanceTo");
    }
  });

  it("points a restricted room to Coworker data access instead of offering a raise", async () => {
    mocks.ceiling.mockResolvedValue("restricted");
    expect(await invite({})).toMatchObject({ verdict: "deny", result: {
      error: "invitee_clearance_below_room",
      data: { recovery: { control: "coworker-data-access", recoveryUrl: "/platform/identity/agents" } },
    } });
    expect(await invite({ raiseClearanceTo: "restricted" })).toMatchObject({ verdict: "deny", result: { error: "invalid_input" } });
  });

  it("refuses a raise to anything other than the room's own level", async () => {
    expect(await invite({ raiseClearanceTo: "confidential" })).toMatchObject({ verdict: "deny", result: { error: "invalid_input" } });
    expect(await invite({ raiseClearanceTo: "everything" })).toMatchObject({ verdict: "deny", result: { error: "invalid_input" } });
  });

  it("plans the raise up to the room's level when asked", async () => {
    expect(await invite({ raiseClearanceTo: "internal" })).toMatchObject({
      verdict: "allow",
      clearanceRaise: { agentId: "change-reviewer", from: ["public"], to: ["public", "internal"], level: "internal" },
    });
  });

  it("admits an already-cleared coworker without a raise", async () => {
    mocks.invitee.mockResolvedValue({ principalId: "PRN-reviewer", displayName: "Change Reviewer", sensitivityClearance: ["public", "internal"] });
    expect(await invite({})).toMatchObject({ verdict: "allow", clearanceRaise: null });
    expect(await invite({ raiseClearanceTo: "internal" })).toMatchObject({ verdict: "allow", clearanceRaise: null });
  });

  it("does not check data access for a person invitee", async () => {
    const result = await preflightRoomParticipantInvitation({
      params: { caseKey: "backlog-item:BI-1", userId: "bob" }, userId: "owner", agentId: "AGT-EXT-CLAUDE",
    });
    expect(result).toMatchObject({ verdict: "allow", clearanceRaise: null });
    expect(mocks.invitee).not.toHaveBeenCalled();
  });
});
