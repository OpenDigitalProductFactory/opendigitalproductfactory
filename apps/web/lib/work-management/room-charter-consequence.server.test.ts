import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveEscalation, type EscalationSteering } from "@/lib/govern/authority/escalation-gate";
import { resolveCallConsequence } from "@/lib/tool-consequence";

const mocks = vi.hoisted(() => ({ agent: vi.fn(), room: vi.fn(), principal: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { agent: { findUnique: mocks.agent } } }));
vi.mock("./room-participant-invitation-preflight.server", () => ({ resolveRoomMessagingWorkItem: mocks.room }));
vi.mock("@/lib/identity/principal-linking", () => ({ ensureAgentPrincipalIdentity: mocks.principal }));

import { inviteRoomParticipantConsequence } from "./room-charter-consequence.server";

const call = (params: Record<string, unknown>) =>
  inviteRoomParticipantConsequence({ toolName: "invite_room_participant", params, userId: "alice", now: new Date("2026-10-28T00:00:00Z") });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.room.mockResolvedValue({ id: "room-item", evidence: [] });
  mocks.agent.mockResolvedValue({ agentId: "change-reviewer", status: "active" });
  mocks.principal.mockResolvedValue({ principalId: "PRN-reviewer", sensitivityClearance: ["public", "internal"] });
});

it("narrows an in-charter coworker invite to non-damaging", async () => {
  await expect(call({ caseKey: "backlog-item:BI-1", agentId: "change-reviewer" }))
    .resolves.toEqual({ consequence: null, reason: "in-charter:platform-default:org-coworker:create" });
});

it("keeps authority for a person invitee", async () => {
  await expect(call({ caseKey: "backlog-item:BI-1", userId: "bob" }))
    .resolves.toEqual({ consequence: "authority", reason: "outside-charter:invitee-kind-unknown" });
  expect(mocks.room).not.toHaveBeenCalled();
});

it("keeps authority when the room is unknown", async () => {
  mocks.room.mockResolvedValue(null);
  await expect(call({ caseKey: "backlog-item:BI-404", agentId: "change-reviewer" }))
    .resolves.toEqual({ consequence: "authority", reason: "outside-charter:room-not-found" });
});

it("keeps authority when the invitee is not a local agent", async () => {
  mocks.agent.mockResolvedValue(null);
  await expect(call({ caseKey: "backlog-item:BI-1", agentId: "gaid:pub:partner:agent" }))
    .resolves.toEqual({ consequence: "authority", reason: "outside-charter:invitee-kind-unknown" });
});

it("keeps authority in a confidential room with no explicit charter", async () => {
  mocks.room.mockResolvedValue({ id: "room-item", evidence: [{ workroomPolicy: { sensitivityCeiling: "confidential" } }] });
  mocks.principal.mockResolvedValue({ principalId: "PRN-reviewer", sensitivityClearance: ["public", "internal", "confidential"] });
  await expect(call({ caseKey: "backlog-item:BI-1", agentId: "change-reviewer" }))
    .resolves.toEqual({ consequence: "authority", reason: "outside-charter:no-charter" });
});

it("honours an explicit charter that narrows the room to read-only invitees", async () => {
  mocks.room.mockResolvedValue({ id: "room-item", evidence: [{
    workroomPolicy: { charter: { admits: ["org-coworker"], classCeiling: "observe", expiresAt: null } },
  }] });
  await expect(call({ caseKey: "backlog-item:BI-1", agentId: "change-reviewer" }))
    .resolves.toEqual({ consequence: "authority", reason: "outside-charter:class-above-ceiling" });
  await expect(call({ caseKey: "backlog-item:BI-1", agentId: "change-reviewer", canAct: false }))
    .resolves.toEqual({ consequence: null, reason: "in-charter:explicit:org-coworker:observe" });
});

// The refiner only narrows; the escalation gate still decides. These run the
// real resolver and gate so the end-to-end property is pinned, not assumed.
describe("through the escalation gate", () => {
  const invite = { consequence: "authority" as const, consequenceForCall: inviteRoomParticipantConsequence };
  const decide = async (params: Record<string, unknown>, steering: EscalationSteering) => {
    const resolved = await resolveCallConsequence(invite, {
      toolName: "invite_room_participant", params, userId: "alice", now: new Date("2026-10-28T00:00:00Z"),
    });
    return resolveEscalation({
      action: { sideEffect: true, executionMode: "immediate", consequence: resolved.consequence },
      dataPolicy: { sensitivity: "internal" },
      operatorRequiresApproval: true,
      steering,
    });
  };

  it("admits an in-charter invite under recorded steering, with no person", async () => {
    await expect(decide({ caseKey: "backlog-item:BI-1", agentId: "change-reviewer" }, "room-authority"))
      .resolves.toMatchObject({ verdict: "automated", reasonCode: "steered-by-room-authority", damaging: false });
    await expect(decide({ caseKey: "backlog-item:BI-1", agentId: "change-reviewer" }, "connection-delegation"))
      .resolves.toMatchObject({ verdict: "automated", damaging: false });
  });

  it("still asks a person for an in-charter invite that nothing steers", async () => {
    await expect(decide({ caseKey: "backlog-item:BI-1", agentId: "change-reviewer" }, "none"))
      .resolves.toMatchObject({ verdict: "human", reasonCode: "unsteered-side-effect" });
  });

  it("still asks a person for an out-of-charter invite even when steered", async () => {
    await expect(decide({ caseKey: "backlog-item:BI-1", userId: "bob" }, "room-authority"))
      .resolves.toMatchObject({ verdict: "human", reasonCode: "damaging-consequence" });
  });

  it("fails closed to authority when the charter lookup throws", async () => {
    mocks.room.mockRejectedValue(new Error("db down"));
    await expect(decide({ caseKey: "backlog-item:BI-1", agentId: "change-reviewer" }, "room-authority"))
      .resolves.toMatchObject({ verdict: "human", reasonCode: "damaging-consequence" });
  });
});

it("keeps authority for a retired agent", async () => {
  mocks.agent.mockResolvedValue({ agentId: "change-reviewer", status: "retired" });
  await expect(call({ caseKey: "backlog-item:BI-1", agentId: "change-reviewer" }))
    .resolves.toEqual({ consequence: "authority", reason: "outside-charter:invitee-inactive" });
});
