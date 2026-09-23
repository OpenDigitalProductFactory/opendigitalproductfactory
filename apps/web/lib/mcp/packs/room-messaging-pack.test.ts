import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ item: vi.fn(), children: vi.fn(), messages: vi.fn(), access: vi.fn(), engagement: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { workItem: { findFirst: mocks.item, findMany: mocks.children }, workItemMessage: { findMany: mocks.messages } } }));
vi.mock("@/lib/identity/principal-linking", () => ({ ensureAgentPrincipalIdentity: vi.fn(), syncUserPrincipal: vi.fn() }));
vi.mock("@/lib/work-management/coworker-room-engagement.server", () => ({ getCoworkerRoomEngagement: mocks.engagement }));
vi.mock("@/lib/work-management/room-agent-presence.server", () => ({ heartbeatAgentWorkItemPresence: vi.fn() }));
vi.mock("@/lib/work-management/post-work-item-comment", () => ({ postWorkItemComment: vi.fn() }));
vi.mock("@/lib/work-management/room-participant-assignment.server", () => ({ persistExplicitWorkroomAssignmentsForWorkItem: vi.fn() }));
vi.mock("@/lib/work-management/room-policy", () => ({ appendRoomPolicyParticipant: vi.fn() }));
vi.mock("@/lib/work-management/room-agent-access.server", () => ({ resolveAgentRoomAccess: mocks.access }));
vi.mock("@/lib/work-management/workspace-case-loader", () => ({ decodeWorkCaseKey: (key: string) => ({ sourceType: "backlog-item", sourceId: key }) }));
import { roomMessagingPack } from "./room-messaging-pack";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.item.mockImplementation(async ({ where }) => ({ id: where.OR[0].sourceId, evidence: [], assignedToUserId: "alice", assignedToAgentId: "agent" }));
  mocks.access.mockImplementation(async ({ workItem }) => ({ decision: { level: workItem.id === "parent" ? "content" : "none" }, agentPrincipalId: "PRN-agent" }));
  mocks.messages.mockResolvedValue([]);
});
it("does not include an unadmitted child room in a parent's message feed", async () => {
  mocks.children.mockResolvedValue([{ id: "private-child", evidence: [], assignedToUserId: "bob", assignedToAgentId: "agent" }]);
  await roomMessagingPack.handlers.read_room_messages({ caseKey: "parent" }, "alice", { agentId: "agent" });
  expect(mocks.messages).toHaveBeenCalledWith(expect.objectContaining({ where: { workItemId: { in: ["parent"] } } }));
});
it("filters shared coworker engagement to rooms admitted for the calling human", async () => {
  mocks.engagement.mockResolvedValue({ agentId: "agent", principalRef: "PRN-agent", activeRoomCount: 2,
    rooms: [{ caseKey: "parent" }, { caseKey: "private-child" }] });
  const result = await roomMessagingPack.handlers.get_coworker_room_engagement({}, "alice", { agentId: "agent" });
  expect(result.data).toMatchObject({ activeRoomCount: 1, rooms: [{ caseKey: "parent" }] });
  expect(mocks.access).toHaveBeenCalledWith(expect.objectContaining({ userId: "alice", agentId: "agent" }));
});
