import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ room: vi.fn(), workItem: vi.fn(), actor: vi.fn(), access: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { workroom: { findUnique: mocks.room }, workItem: { findUnique: mocks.workItem } } }));
vi.mock("./handler-actor", () => ({ workCapsuleActor: mocks.actor }));
vi.mock("@/lib/work-management/workroom-agent-access.server", () => ({ resolveAgentWorkroomAccess: mocks.access }));
import { authorizeOAuthCapsuleTarget, workroomTargetAccessRefusal } from "./oauth-workroom-ownership";
const input = { params: { capsuleId: "WC-ONE" }, userId: "alice", agentId: "claude", authSource: "oauth", action: true };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.actor.mockResolvedValue({ userId: "alice", agentId: "claude", principalId: "human-alice", agentPrincipalId: "assistant" });
  mocks.room.mockResolvedValue({ leaseHolderPrincipalId: "human-alice", requestedByPrincipalId: "human-alice", createdByPrincipalId: "assistant", workItemId: null });
  mocks.access.mockResolvedValue({ decision: { level: "none" } });
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
