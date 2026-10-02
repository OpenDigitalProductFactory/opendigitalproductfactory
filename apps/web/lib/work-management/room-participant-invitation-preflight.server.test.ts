import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ item: vi.fn(), access: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { workItem: { findFirst: mocks.item } } }));
vi.mock("./room-agent-access.server", () => ({ resolveAgentRoomAccess: mocks.access }));

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
