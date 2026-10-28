import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  item: vi.fn(), children: vi.fn(), updateItem: vi.fn(), messages: vi.fn(), access: vi.fn(), engagement: vi.fn(),
  ensureAgent: vi.fn(), syncUser: vi.fn(), appendPolicy: vi.fn(), persistAssignments: vi.fn(),
  postComment: vi.fn(), heartbeat: vi.fn(), loadMembers: vi.fn(), workrooms: vi.fn(), workroomByCapsule: vi.fn(), workroomAccess: vi.fn(),
  executeAppointment: vi.fn(), currentUser: vi.fn(), can: vi.fn(),
  broadcastAsk: vi.fn(), broadcastAck: vi.fn(), mentionRoster: vi.fn(),
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
vi.mock("@/lib/operate/coo-broadcast.server", () => ({
  executeCooBroadcastAsk: mocks.broadcastAsk,
  executeCooBroadcastAck: mocks.broadcastAck,
}));
vi.mock("@/lib/work-management/mention-roster.server", () => ({ loadWorkspaceMentionRoster: mocks.mentionRoster }));
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
  mocks.broadcastAsk.mockResolvedValue({
    success: true, message: "Broadcast ask-1 asked 1 room(s).",
    data: { commandKey: "ask-1", asked: 1, posted: 0, dispatchInvoked: false, rooms: ["WC-ONE"] },
  });
  mocks.broadcastAck.mockResolvedValue({
    success: true, message: "Acknowledged ask-1 for WC-ONE.",
    data: { commandKey: "ask-1", capsuleId: "WC-ONE", dispatchInvoked: false },
  });
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

it("broadcasts a COO ask without dispatching a stage", async () => {
  const result = await roomMessagingPack.handlers.broadcast_workroom_ask(
    { capsuleId: "WC-ONE", body: "Pause new intake." },
    "alice",
    { agentId: "agent" },
  );
  expect(result.success).toBe(true);
  expect(result.data).toMatchObject({ dispatchInvoked: false, commandKey: "ask-1" });
  expect(mocks.broadcastAsk).toHaveBeenCalledOnce();
  expect(mocks.broadcastAsk.mock.calls[0]![0]).toMatchObject({
    capsuleId: "WC-ONE",
    body: "Pause new intake.",
    actor: { userId: "alice", agentId: "agent" },
  });
  expect(roomMessagingPack.definitions.find((tool) => tool.name === "broadcast_workroom_ask")?.consequence).toBeUndefined();
});

it("refuses a COO broadcast when the caller is not admitted to the root room", async () => {
  mocks.workroomAccess.mockResolvedValue({ decision: { level: "none", reason: "not-admitted" } });
  const result = await roomMessagingPack.handlers.broadcast_workroom_ask(
    { capsuleId: "WC-ONE", body: "Status please." },
    "alice",
    { agentId: "agent" },
  );
  expect(result).toMatchObject({ success: false, error: "forbidden" });
  expect(mocks.broadcastAsk).not.toHaveBeenCalled();
});

it("records a COO broadcast acknowledgement without dispatching a stage", async () => {
  const result = await roomMessagingPack.handlers.acknowledge_workroom_broadcast(
    { capsuleId: "WC-ONE", commandKey: "ask-1" },
    "alice",
    { agentId: "agent" },
  );
  expect(result.success).toBe(true);
  expect(result.data).toMatchObject({ dispatchInvoked: false });
  expect(mocks.broadcastAck).toHaveBeenCalledWith(expect.objectContaining({
    capsuleId: "WC-ONE",
    commandKey: "ask-1",
  }));
});

// BI-3C837677: an in-memory WorkItemMessage table honouring the where/orderBy/take
// shape read_room_messages issues, so paging is checked against real ordering.
type Row = { messageId: string; workItemId: string; senderType: string; senderAgentId: string | null;
  senderUserId: string | null; messageType: string; body: string; createdAt: Date };
type Bound = { createdAt?: { lt?: Date; gt?: Date } | Date; messageId?: { lt?: string; gt?: string } };
function matchesBound(row: Row, bound: Bound): boolean {
  if (bound.createdAt instanceof Date) {
    if (row.createdAt.getTime() !== bound.createdAt.getTime()) return false;
  } else if (bound.createdAt) {
    if (bound.createdAt.lt && !(row.createdAt < bound.createdAt.lt)) return false;
    if (bound.createdAt.gt && !(row.createdAt > bound.createdAt.gt)) return false;
  }
  if (bound.messageId?.lt && !(row.messageId < bound.messageId.lt)) return false;
  if (bound.messageId?.gt && !(row.messageId > bound.messageId.gt)) return false;
  return true;
}
function seedRoom(count: number): Row[] {
  // Pairs share a timestamp so the messageId tie-break is exercised.
  return Array.from({ length: count }, (_, index) => ({
    messageId: `m${String(index).padStart(3, "0")}`,
    workItemId: "parent",
    senderType: "agent",
    senderAgentId: "agent",
    senderUserId: null,
    messageType: "comment",
    body: `message ${index}`,
    createdAt: new Date(Date.UTC(2026, 9, 27, 0, 0, Math.floor(index / 2))),
  }));
}
function useTable(rows: Row[]) {
  mocks.messages.mockImplementation(async (args: {
    where: { workItemId: { in: string[] }; OR?: Bound[] };
    orderBy: Array<Record<string, "asc" | "desc">>;
    take: number;
  }) => {
    const direction = args.orderBy[0]?.createdAt ?? "asc";
    const sign = direction === "asc" ? 1 : -1;
    return rows
      .filter((row) => args.where.workItemId.in.includes(row.workItemId))
      .filter((row) => !args.where.OR || args.where.OR.some((bound) => matchesBound(row, bound)))
      .sort((a, b) => sign * (a.createdAt.getTime() - b.createdAt.getTime() || a.messageId.localeCompare(b.messageId)))
      .slice(0, args.take);
  });
}
async function readRoom(params: Record<string, unknown> = {}) {
  return roomMessagingPack.handlers.read_room_messages({ caseKey: "parent", ...params }, "alice", { agentId: "agent" });
}
type Page = { messages: Array<{ messageId: string }>; order: string; hasMore: boolean;
  newestCursor: string | null; oldestCursor: string | null };

it("returns the 20 newest messages, newest first, with cursors, in a room past 20 messages", async () => {
  mocks.children.mockResolvedValue([]);
  useTable(seedRoom(25));
  const result = await readRoom();
  expect(result.success).toBe(true);
  const page = result.data as Page;
  expect(page.order).toBe("newest-first");
  expect(page.messages).toHaveLength(20);
  expect(page.messages[0]?.messageId).toBe("m024");
  expect(page.messages[19]?.messageId).toBe("m005");
  expect(page.hasMore).toBe(true);
  expect(page.newestCursor).toEqual(expect.any(String));
  expect(page.oldestCursor).toEqual(expect.any(String));
});

it("pages back with beforeCursor across equal timestamps without skipping or repeating", async () => {
  mocks.children.mockResolvedValue([]);
  const rows = seedRoom(45);
  useTable(rows);
  const seen: string[] = [];
  let page = (await readRoom({ limit: 7 })).data as Page;
  seen.push(...page.messages.map((message) => message.messageId));
  while (page.hasMore) {
    page = (await readRoom({ limit: 7, beforeCursor: page.oldestCursor })).data as Page;
    seen.push(...page.messages.map((message) => message.messageId));
  }
  expect(seen).toEqual(rows.map((row) => row.messageId).reverse());
});

it("resumes with sinceCursor returning only later messages, oldest first", async () => {
  mocks.children.mockResolvedValue([]);
  const rows = seedRoom(25);
  useTable(rows.slice(0, 20));
  const first = (await readRoom()).data as Page;
  expect(first.messages[0]?.messageId).toBe("m019");

  useTable(rows);
  const later = (await readRoom({ sinceCursor: first.newestCursor })).data as Page;
  expect(later.order).toBe("oldest-first");
  expect(later.messages.map((message) => message.messageId)).toEqual(["m020", "m021", "m022", "m023", "m024"]);
  expect(later.hasMore).toBe(false);

  const none = (await readRoom({ sinceCursor: later.newestCursor })).data as Page;
  expect(none.messages).toEqual([]);
  expect(none.newestCursor).toBe(later.newestCursor);
});

it("refuses a malformed cursor and a call that sets both cursors", async () => {
  mocks.children.mockResolvedValue([]);
  useTable(seedRoom(3));
  expect(await readRoom({ sinceCursor: "not-a-cursor" })).toMatchObject({ success: false, error: "invalid_input" });
  const page = (await readRoom()).data as Page;
  expect(await readRoom({ sinceCursor: page.newestCursor, beforeCursor: page.oldestCursor }))
    .toMatchObject({ success: false, error: "invalid_input" });
});

it("resolves @mentions in an agent's post against the workspace mention roster", async () => {
  const roster = { "release-coworker": { type: "agent", id: "release-agent" } };
  mocks.mentionRoster.mockResolvedValue(roster);
  mocks.item.mockResolvedValue({ id: "room-item", itemId: "WI-ROOM", sourceType: "backlog-item", sourceId: "BI-ROOM", title: "Room", evidence: [] });
  mocks.access.mockResolvedValue({ decision: { level: "action", reason: "authorized" }, agentPrincipalId: "PRN-agent" });
  mocks.postComment.mockResolvedValue({ messageId: "msg-1", notifiedUserIds: [], mentionedAgentIds: ["release-agent"] });

  const result = await roomMessagingPack.handlers.post_room_message(
    { caseKey: "backlog-item:BI-ROOM", body: "@release-coworker please verify the build" },
    "alice",
    { agentId: "agent" },
  );

  expect(result.success).toBe(true);
  expect(mocks.postComment).toHaveBeenCalledWith(expect.objectContaining({ roster }));
});
