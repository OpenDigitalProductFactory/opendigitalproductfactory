import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  room: vi.fn(), workItem: vi.fn(), actor: vi.fn(), access: vi.fn(),
  currentUser: vi.fn(), can: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: { workroom: { findUnique: mocks.room }, workItem: { findUnique: mocks.workItem } } }));
vi.mock("./handler-actor", () => ({ workCapsuleActor: mocks.actor }));
vi.mock("@/lib/work-management/workroom-agent-access.server", () => ({ resolveAgentWorkroomAccess: mocks.access }));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: mocks.currentUser }));
vi.mock("@/lib/govern/permissions", () => ({ can: mocks.can }));
import { authorizeOAuthCapsuleTarget, workroomTargetAccessRefusal } from "./oauth-workroom-ownership";
const input = { params: { capsuleId: "WC-ONE" }, userId: "alice", agentId: "claude", authSource: "oauth", action: true };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.actor.mockResolvedValue({ userId: "alice", agentId: "claude", principalId: "human-alice", agentPrincipalId: "assistant" });
  mocks.room.mockResolvedValue({ leaseHolderPrincipalId: "human-alice", requestedByPrincipalId: "human-alice", createdByPrincipalId: "assistant", workItemId: null });
  mocks.access.mockResolvedValue({ decision: { level: "none" } });
  mocks.currentUser.mockResolvedValue({ userId: "alice" });
  mocks.can.mockReturnValue(false);
});
it("authorizes each separately created room without a new login", async () => {
  mocks.access.mockResolvedValue({ decision: { level: "action" } });
  expect(await authorizeOAuthCapsuleTarget(input)).toBe(true);
  expect(await authorizeOAuthCapsuleTarget({ ...input, params: { capsuleId: "WC-TWO" } })).toBe(true);
});
it("checks data access for an owned room without a work item", async () => {
  mocks.access.mockResolvedValue({ decision: { level: "discover", reason: "insufficient-clearance" } });
  expect(await workroomTargetAccessRefusal(input)).toEqual(expect.objectContaining({ error: "workroom_data_access_required" }));
});
it("denies borrowing another human's ownership through a shared assistant", async () => {
  mocks.room.mockResolvedValue({ leaseHolderPrincipalId: "human-bob", requestedByPrincipalId: "human-bob", createdByPrincipalId: "assistant" });
  expect(await authorizeOAuthCapsuleTarget(input)).toBe(false);
});
it("denies an old unbound room instead of assigning its owner from the caller", async () => {
  mocks.room.mockResolvedValue({ leaseHolderPrincipalId: "assistant", createdByPrincipalId: "assistant" });
  expect(await authorizeOAuthCapsuleTarget(input)).toBe(false);
});
it("preserves room policy and clearance restrictions even for the owner", async () => {
  mocks.room.mockResolvedValue({ leaseHolderPrincipalId: "human-alice", createdByPrincipalId: "assistant", workItemId: "room-item" });
  mocks.workItem.mockResolvedValue({ id: "room-item" });
  expect(await authorizeOAuthCapsuleTarget(input)).toBe(false);
  mocks.access.mockResolvedValue({ decision: { level: "action" } });
  expect(await authorizeOAuthCapsuleTarget(input)).toBe(true);
  expect(mocks.access).toHaveBeenCalledWith(expect.objectContaining({ userId: "alice", agentId: "claude", requested: "action" }));
});
it("leaves non-OAuth and untargeted calls to their existing policy", async () => {
  expect(await authorizeOAuthCapsuleTarget({ ...input, authSource: "pat" })).toBe(true);
  expect(await authorizeOAuthCapsuleTarget({ ...input, params: {} })).toBe(true);
  expect(mocks.actor).not.toHaveBeenCalled();
});
it("explains insufficient data access without prescribing another login or an invitation", async () => {
  mocks.room.mockResolvedValue({ requestedByPrincipalId: "human-alice", createdByPrincipalId: "assistant", workItemId: "room-item" });
  mocks.workItem.mockResolvedValue({ id: "room-item" });
  mocks.access.mockResolvedValue({ decision: { level: "discover", reason: "insufficient-clearance" } });
  expect(await workroomTargetAccessRefusal(input)).toEqual(expect.objectContaining({
    error: "workroom_data_access_required", data: { recoveryUrl: "/platform/identity/agents" },
  }));
});
// BI-821EEB18 — a replacement assistant is told how to take the room over.
it("names the handover when only the assistant is missing, and lets the handover itself through", async () => {
  mocks.access.mockImplementation(async (args: { handover?: boolean }) => ({
    decision: args.handover ? { level: "action", reason: "authorized" } : { level: "none", reason: "not-admitted" },
  }));
  const read = await workroomTargetAccessRefusal({ ...input, action: false, toolName: "get_workroom" });
  expect(read).toMatchObject({
    error: "workroom_assistant_not_admitted",
    data: { handover: { tool: "reassign_workroom_executor", arguments: { capsuleId: "WC-ONE", toExecutorKind: "claude-desktop" } } },
  });
  expect(await workroomTargetAccessRefusal({ ...input, toolName: "reassign_workroom_executor" })).toBeNull();
  expect(mocks.access).toHaveBeenLastCalledWith(expect.objectContaining({ handover: true, requested: "action" }));
});
it("keeps the plain refusal when the person could not hand the room over either", async () => {
  mocks.access.mockResolvedValue({ decision: { level: "none", reason: "not-admitted" } });
  expect(await workroomTargetAccessRefusal({ ...input, toolName: "get_workroom" })).toMatchObject({ error: "workroom_access_denied" });
  expect(await workroomTargetAccessRefusal({ ...input, toolName: "reassign_workroom_executor" })).toMatchObject({ error: "workroom_access_denied" });
});
// BI-F4EB23C1 — a handover that cannot happen says why, before anyone is asked to approve it.
it.each([
  ["not-owner", "workroom_handover_not_owner", /does not own it/],
  ["assistant-in-room", "workroom_handover_assistant_in_room", /removed from this workroom or limited/],
] as const)("names a %s refusal for the handover and for ordinary room calls", async (handoverRefusal, error, message) => {
  mocks.access.mockResolvedValue({ decision: { level: "none", reason: "not-admitted" }, handoverRefusal });
  for (const toolName of ["reassign_workroom_executor", "get_workroom"]) {
    const refusal = await workroomTargetAccessRefusal({ ...input, toolName });
    expect(refusal).toMatchObject({ success: false, error });
    expect(refusal?.message).toMatch(message);
    expect(refusal?.message).not.toMatch(/invite_room_participant|self/);
  }
});

it("lets a platform manager reach the governed coordinator recovery when room admission is the defect", async () => {
  mocks.can.mockReturnValue(true);
  expect(await workroomTargetAccessRefusal({ ...input, toolName: "appoint_room_coordinator" })).toBeNull();
  expect(mocks.currentUser).toHaveBeenCalledWith("alice");
  expect(mocks.can).toHaveBeenCalledWith(expect.anything(), "manage_platform");
});

it("does not turn coordinator recovery into an arbitrary takeover path", async () => {
  expect(await workroomTargetAccessRefusal({ ...input, toolName: "appoint_room_coordinator" })).toMatchObject({
    success: false,
    error: "workroom_access_denied",
  });
});

it("preserves admitted appointment access without granting global platform authority", async () => {
  mocks.access.mockResolvedValue({ decision: { level: "action", reason: "authorized" } });
  expect(await workroomTargetAccessRefusal({ ...input, toolName: "appoint_room_coordinator" })).toBeNull();
  expect(mocks.currentUser).not.toHaveBeenCalled();
  expect(mocks.can).not.toHaveBeenCalled();
});

it("does not let platform recovery bypass the pair's data clearance", async () => {
  mocks.can.mockReturnValue(true);
  mocks.access.mockResolvedValue({ decision: { level: "discover", reason: "insufficient-clearance" } });
  expect(await workroomTargetAccessRefusal({ ...input, toolName: "appoint_room_coordinator" })).toMatchObject({
    success: false, error: "workroom_data_access_required",
  });
  expect(mocks.can).not.toHaveBeenCalled();
});

it.each([
  ["review_workroom_sensitivity", false],
  ["correct_workroom_sensitivity", true],
] as const)("lets a current administrator reach only the classification control plane: %s", async (toolName, action) => {
  mocks.can.mockReturnValue(true);
  mocks.access.mockResolvedValue({ decision: { level: "discover", reason: "insufficient-clearance" } });
  expect(await workroomTargetAccessRefusal({ ...input, toolName, action })).toBeNull();
  expect(mocks.currentUser).toHaveBeenCalledWith("alice");
  expect(mocks.can).toHaveBeenCalledWith(expect.anything(), "manage_platform");
  expect(mocks.access).not.toHaveBeenCalled();
  expect(mocks.room).not.toHaveBeenCalled();
});

it.each(["review_workroom_sensitivity", "correct_workroom_sensitivity"])("does not give an admitted nonadministrator classification authority: %s", async (toolName) => {
  mocks.access.mockResolvedValue({ decision: { level: "action" } });
  expect(await workroomTargetAccessRefusal({ ...input, toolName })).toMatchObject({
    success: false, error: "not_authorized",
  });
});

it("rechecks current administrator permission on each metadata request", async () => {
  mocks.can.mockReturnValue(true);
  mocks.currentUser.mockResolvedValueOnce({ userId: "alice" }).mockResolvedValueOnce(null);
  const request = { ...input, toolName: "review_workroom_sensitivity", action: false };
  expect(await workroomTargetAccessRefusal(request)).toBeNull();
  expect(await workroomTargetAccessRefusal(request)).toMatchObject({ error: "not_authorized" });
  expect(mocks.currentUser).toHaveBeenCalledTimes(2);
});

it.each([
  ["get_workroom", false],
  ["record_workroom_evidence", true],
] as const)("keeps ordinary room access denied for administrators: %s", async (toolName, action) => {
  mocks.can.mockReturnValue(true);
  mocks.access.mockResolvedValue({ decision: { level: "discover", reason: "insufficient-clearance" } });
  expect(await workroomTargetAccessRefusal({ ...input, toolName, action,
    params: { ...input.params, toolName: "review_workroom_sensitivity", administrator: true },
  })).toMatchObject({ error: "workroom_data_access_required" });
  expect(mocks.currentUser).not.toHaveBeenCalled();
});

it("does not let an unbound OAuth connection use classification recovery", async () => {
  mocks.can.mockReturnValue(true);
  expect(await workroomTargetAccessRefusal({ ...input, agentId: undefined,
    toolName: "review_workroom_sensitivity", action: false,
  })).toMatchObject({ error: "workroom_access_denied" });
  expect(mocks.currentUser).not.toHaveBeenCalled();
});

// BI-D4144471 — the person's assistant sees where the room stands before taking it over.
it("shows the stored checkpoint, bound PR and lease expiry with the not-admitted handover", async () => {
  const checkpoint = { nextAction: "Open the PR", recordedAt: "2026-10-27T00:00:00.000Z", recordedByPrincipalId: "assistant-old" };
  mocks.room.mockResolvedValue({
    id: "room-1", workspaceState: { executorCheckpoint: checkpoint }, pullRequestNumber: 42,
    pullRequestUrl: "https://github.com/o/r/pull/42", leaseExpiresAt: new Date("2026-10-27T01:00:00.000Z"),
  });
  mocks.access.mockImplementation(async (args: { handover?: boolean }) => ({
    decision: args.handover ? { level: "action", reason: "authorized" } : { level: "none", reason: "not-admitted" },
  }));
  expect(await workroomTargetAccessRefusal({ ...input, action: false, toolName: "get_workroom" })).toMatchObject({
    error: "workroom_assistant_not_admitted",
    data: {
      handover: { tool: "reassign_workroom_executor" },
      checkpoint,
      pullRequest: { number: 42, url: "https://github.com/o/r/pull/42" },
      leaseExpiresAt: "2026-10-27T01:00:00.000Z",
    },
  });
});

it("shows null checkpoint and pull request when the room has neither", async () => {
  mocks.room.mockResolvedValue({ id: "room-1", workspaceState: {}, pullRequestNumber: null, pullRequestUrl: null, leaseExpiresAt: null });
  mocks.access.mockImplementation(async (args: { handover?: boolean }) => ({
    decision: args.handover ? { level: "action", reason: "authorized" } : { level: "none", reason: "not-admitted" },
  }));
  expect(await workroomTargetAccessRefusal({ ...input, action: false, toolName: "get_workroom" })).toMatchObject({
    data: { checkpoint: null, pullRequest: null, leaseExpiresAt: null },
  });
});

// A batched handover is checked room by room, exactly as a single one.
it("checks handover eligibility for every room in a batch", async () => {
  mocks.room.mockImplementation(async ({ where }: { where: { capsuleId: string } }) => ({ id: `row-${where.capsuleId}` }));
  mocks.access.mockResolvedValue({ decision: { level: "action", reason: "authorized" } });
  const batch = { ...input, toolName: "reassign_workroom_executor", params: { capsuleIds: ["WC-ONE", "WC-TWO"], toExecutorKind: "claude-desktop" } };
  expect(await workroomTargetAccessRefusal(batch)).toBeNull();
  expect(mocks.access).toHaveBeenCalledTimes(2);
  expect(mocks.access).toHaveBeenCalledWith(expect.objectContaining({ workroomId: "row-WC-ONE", handover: true, requested: "action" }));
  expect(mocks.access).toHaveBeenCalledWith(expect.objectContaining({ workroomId: "row-WC-TWO", handover: true, requested: "action" }));
});

it("refuses the whole batch when any room is not handover-eligible", async () => {
  mocks.room.mockImplementation(async ({ where }: { where: { capsuleId: string } }) => ({ id: `row-${where.capsuleId}` }));
  mocks.access.mockImplementation(async (args: { workroomId: string }) => args.workroomId === "row-WC-TWO"
    ? { decision: { level: "none", reason: "not-admitted" }, handoverRefusal: "not-owner" }
    : { decision: { level: "action", reason: "authorized" } });
  const batch = { ...input, toolName: "reassign_workroom_executor", params: { capsuleIds: ["WC-ONE", "WC-TWO"], toExecutorKind: "claude-desktop" } };
  expect(await workroomTargetAccessRefusal(batch)).toMatchObject({ success: false, error: "workroom_handover_not_owner", data: { capsuleId: "WC-TWO" } });
});

it("refuses a malformed batch before reading any room", async () => {
  for (const capsuleIds of [[], "WC-ONE", ["WC-ONE", 3], Array.from({ length: 21 }, (_, i) => `WC-${i}`)]) {
    expect(await workroomTargetAccessRefusal({ ...input, toolName: "reassign_workroom_executor", params: { capsuleIds } }))
      .toMatchObject({ success: false, error: "invalid_input" });
  }
  expect(mocks.room).not.toHaveBeenCalled();
});

it("checks a capsuleId sent alongside a batch too", async () => {
  mocks.room.mockImplementation(async ({ where }: { where: { capsuleId: string } }) => ({ id: `row-${where.capsuleId}` }));
  mocks.access.mockImplementation(async (args: { workroomId: string }) => args.workroomId === "row-WC-EXTRA"
    ? { decision: { level: "none", reason: "not-admitted" } }
    : { decision: { level: "action", reason: "authorized" } });
  const batch = { ...input, toolName: "reassign_workroom_executor", params: { capsuleIds: ["WC-ONE"], capsuleId: "WC-EXTRA" } };
  expect(await workroomTargetAccessRefusal(batch)).toMatchObject({ success: false, error: "workroom_access_denied" });
});
