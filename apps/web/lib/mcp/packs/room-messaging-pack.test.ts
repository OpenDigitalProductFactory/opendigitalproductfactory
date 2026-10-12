import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  item: vi.fn(), children: vi.fn(), updateItem: vi.fn(), messages: vi.fn(), access: vi.fn(), engagement: vi.fn(),
  ensureAgent: vi.fn(), syncUser: vi.fn(), appendPolicy: vi.fn(), persistAssignments: vi.fn(),
  postComment: vi.fn(), heartbeat: vi.fn(), loadMembers: vi.fn(), workrooms: vi.fn(), workroomByCapsule: vi.fn(), workroomAccess: vi.fn(),
  executeAppointment: vi.fn(), currentUser: vi.fn(), can: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: {
  workItem: { findFirst: mocks.item, findMany: mocks.children, update: mocks.updateItem },
  workItemMessage: { findMany: mocks.messages, create: vi.fn() },
  workroom: { findMany: mocks.workrooms, findUnique: mocks.workroomByCapsule },
  notification: { create: vi.fn() },
  agent: { findUnique: vi.fn() },
} }));
vi.mock("@/lib/identity/principal-linking", () => ({ ensureAgentPrincipalIdentity: mocks.ensureAgent, syncUserPrincipal: mocks.syncUser }));
vi.mock("@/lib/work-management/coworker-room-engagement.server", () => ({ getCoworkerRoomEngagement: mocks.engagement }));
vi.mock("@/lib/work-management/room-agent-presence.server", () => ({ heartbeatAgentWorkItemPresence: mocks.heartbeat }));
vi.mock("@/lib/work-management/post-work-item-comment", () => ({ postWorkItemComment: mocks.postComment }));
vi.mock("@/lib/work-management/room-participant-assignment.server", () => ({ persistExplicitWorkroomAssignmentsForWorkItem: mocks.persistAssignments }));
vi.mock("@/lib/work-management/room-policy", () => ({ appendRoomPolicyParticipant: mocks.appendPolicy }));
vi.mock("@/lib/work-management/room-policy-members.server", () => ({ loadRoomMembersForWorkItem: mocks.loadMembers }));
vi.mock("@/lib/work-management/room-agent-access.server", () => ({ resolveAgentRoomAccess: mocks.access }));
vi.mock("@/lib/work-management/workroom-agent-access.server", () => ({ resolveAgentWorkroomAccess: mocks.workroomAccess }));
vi.mock("@/lib/work-management/execute-coordinator-appointment.server", () => ({ executeCoordinatorAppointment: mocks.executeAppointment }));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: mocks.currentUser }));
vi.mock("@/lib/govern/permissions", () => ({ can: mocks.can }));
vi.mock("@/lib/work-management/case-key", () => ({ decodeWorkCaseKey: (key: string) => ({ sourceType: "backlog-item", sourceId: key }) }));
import { roomMessagingPack } from "./room-messaging-pack";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.item.mockImplementation(async ({ where }) => ({ id: where.OR[0].sourceId, evidence: [], assignedToUserId: "alice", assignedToAgentId: "agent" }));
  mocks.access.mockImplementation(async ({ workItem }) => ({ decision: { level: workItem.id === "parent" ? "content" : "none" }, agentPrincipalId: "PRN-agent" }));
  mocks.messages.mockResolvedValue([]);
  mocks.ensureAgent.mockResolvedValue({ principalId: "PRN-other", displayName: "Other coworker" });
  mocks.syncUser.mockResolvedValue({ principalId: "PRN-alice", displayName: "Alice" });
  mocks.appendPolicy.mockReturnValue([{ workroomPolicy: {} }]);
  mocks.loadMembers.mockResolvedValue([]);
  mocks.workrooms.mockResolvedValue([]);
  mocks.workroomByCapsule.mockResolvedValue({ id: "room-1" });
  mocks.workroomAccess.mockResolvedValue({ decision: { level: "action", reason: "authorized" } });
  mocks.executeAppointment.mockResolvedValue({ ok: true, data: { capsuleId: "WC-ONE", principalRef: "PRN-alice", displayName: "Alice" } });
  mocks.currentUser.mockResolvedValue({ userId: "alice" });
  mocks.can.mockReturnValue(false);
});
it("does not include an unadmitted child room in a parent's message feed", async () => {
  mocks.children.mockResolvedValue([{ id: "private-child", evidence: [], assignedToUserId: "bob", assignedToAgentId: "agent" }]);
  await roomMessagingPack.handlers.read_room_messages({ caseKey: "parent" }, "alice", { agentId: "agent" });
  expect(mocks.messages).toHaveBeenCalledWith(expect.objectContaining({ where: { workItemId: { in: ["parent"] } } }));
});
it("names a not-admitted invite as room_not_admitted", async () => {
  mocks.access.mockResolvedValue({ decision: { level: "none", reason: "not-admitted" }, agentPrincipalId: "PRN-agent" });
  const result = await roomMessagingPack.handlers.invite_room_participant(
    { caseKey: "private-room", agentId: "other" },
    "alice",
    { agentId: "agent" },
  );
  expect(result.success).toBe(false);
  expect(result.error).toBe("room_not_admitted");
});
it("keeps any other invite refusal as forbidden", async () => {
  mocks.access.mockResolvedValue({ decision: { level: "content", reason: "observe-only" }, agentPrincipalId: "PRN-agent" });
  const result = await roomMessagingPack.handlers.invite_room_participant(
    { caseKey: "private-room", agentId: "other" },
    "alice",
    { agentId: "agent" },
  );
  expect(result.error).toBe("forbidden");
});
it("filters shared coworker engagement to rooms admitted for the calling human", async () => {
  mocks.engagement.mockResolvedValue({ agentId: "agent", principalRef: "PRN-agent", activeRoomCount: 2,
    rooms: [{ caseKey: "parent" }, { caseKey: "private-child" }] });
  const result = await roomMessagingPack.handlers.get_coworker_room_engagement({}, "alice", { agentId: "agent" });
  expect(result.data).toMatchObject({ activeRoomCount: 1, rooms: [{ caseKey: "parent" }] });
  expect(mocks.access).toHaveBeenCalledWith(expect.objectContaining({ userId: "alice", agentId: "agent" }));
});

it("reports a partial result when membership is recorded but exact paired admission still fails", async () => {
  mocks.item.mockResolvedValue({ id: "room-item", itemId: "WI-ROOM", sourceType: "backlog-item", sourceId: "BI-ROOM", title: "Room", evidence: [] });
  mocks.access.mockResolvedValue({ decision: { level: "action", reason: "authorized" }, agentPrincipalId: "PRN-agent" });
  mocks.workrooms.mockResolvedValue([{ id: "room-1", capsuleId: "WC-ONE" }]);
  mocks.workroomAccess.mockResolvedValue({ decision: { level: "none", reason: "not-admitted" } });

  const result = await roomMessagingPack.handlers.invite_room_participant(
    { caseKey: "backlog-item:BI-ROOM", agentId: "other", canAct: true },
    "alice",
    { agentId: "agent", authSource: "oauth" },
  );

  expect(result).toMatchObject({
    success: false,
    error: "workroom_effective_admission_incomplete",
    data: {
      membershipRecorded: true,
      effectiveAdmission: false,
      blockedWorkrooms: [{ capsuleId: "WC-ONE", reason: "not-admitted" }],
      recovery: { tool: "appoint_room_coordinator", principalRef: "PRN-alice" },
    },
  });
});

it("rechecks coordinator recovery authority in the handler and denies a non-manager outside the room", async () => {
  mocks.workroomAccess.mockResolvedValue({ decision: { level: "none", reason: "not-admitted" } });
  const result = await roomMessagingPack.handlers.appoint_room_coordinator(
    { capsuleId: "WC-ONE", principalRef: "PRN-alice", replaceExisting: true },
    "alice",
    { agentId: "agent", authSource: "oauth" },
  );
  expect(result).toMatchObject({ success: false, error: "workroom_access_denied" });
  expect(mocks.executeAppointment).not.toHaveBeenCalled();
});

it("allows a platform manager to execute the consequence-gated single-room recovery", async () => {
  mocks.workroomAccess.mockResolvedValue({ decision: { level: "none", reason: "not-admitted" } });
  mocks.can.mockReturnValue(true);
  const result = await roomMessagingPack.handlers.appoint_room_coordinator(
    { capsuleId: "WC-ONE", principalRef: "PRN-alice", replaceExisting: true },
    "alice",
    { agentId: "agent", authSource: "oauth" },
  );
  expect(result.success).toBe(true);
  expect(mocks.currentUser).toHaveBeenCalledWith("alice");
  expect(mocks.executeAppointment).toHaveBeenCalledOnce();
});
