import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  room: vi.fn(), principal: vi.fn(), participants: vi.fn(), participantUpdate: vi.fn(),
  activityCreate: vi.fn(), workItemFind: vi.fn(), workItemUpdate: vi.fn(), persist: vi.fn(), members: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: {
  workroom: { findUnique: mocks.room },
  principal: { findFirst: mocks.principal },
  workroomParticipant: { findMany: mocks.participants, update: mocks.participantUpdate },
  workroomActivity: { create: mocks.activityCreate },
  workItem: { findUnique: mocks.workItemFind, update: mocks.workItemUpdate },
} }));
vi.mock("./room-participant-assignment.server", () => ({ persistWorkroomParticipantAssignment: mocks.persist }));
vi.mock("./room-policy-members.server", () => ({ loadRoomMembersForWorkItem: mocks.members }));

import { executeCoordinatorAppointment } from "./execute-coordinator-appointment.server";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.room.mockResolvedValue({ id: "room-1", capsuleId: "WC-ONE", workItemId: "work-item-1" });
  mocks.principal.mockResolvedValue({ id: "human-new", displayName: "Alice" });
  mocks.participants.mockResolvedValue([{ id: "old", principalId: "human-old", roles: ["coordinator"] }]);
  mocks.persist.mockResolvedValue({ workroomId: "room-1", principalId: "human-new" });
  mocks.members.mockResolvedValue([
    { principalRef: "PRN-old", canAct: true },
    { principalRef: "PRN-new", canAct: true },
    { principalRef: "PRN-agent", canAct: true },
  ]);
  mocks.workItemFind.mockResolvedValue({
    evidence: [{ workroomPolicy: {
      admittedPrincipalRefs: ["PRN-old", "PRN-agent"],
      actionPrincipalRefs: ["PRN-old", "PRN-agent"],
      participants: [],
    } }],
  });
});

it("adds the new coordinator to an existing explicit room policy", async () => {
  const result = await executeCoordinatorAppointment({
    capsuleId: "WC-ONE",
    principalRef: "PRN-new",
    replaceExisting: true,
    reason: "Recover the room for its active owner.",
  });

  expect(result.ok).toBe(true);
  expect(mocks.workItemUpdate).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: "work-item-1" },
    data: { evidence: expect.arrayContaining([expect.objectContaining({
      workroomPolicy: expect.objectContaining({
        admittedPrincipalRefs: expect.arrayContaining(["PRN-new", "PRN-agent"]),
        actionPrincipalRefs: expect.arrayContaining(["PRN-new", "PRN-agent"]),
      }),
    })]) },
  }));
});

it("does not invent a restrictive WorkItem policy where none existed", async () => {
  mocks.workItemFind.mockResolvedValue({ evidence: [] });
  expect((await executeCoordinatorAppointment({
    capsuleId: "WC-ONE", principalRef: "PRN-new", replaceExisting: true, reason: null,
  })).ok).toBe(true);
  expect(mocks.workItemUpdate).not.toHaveBeenCalled();
});
