import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ room: vi.fn(), workItem: vi.fn(), actor: vi.fn(), access: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { workroom: { findUnique: mocks.room }, workItem: { findUnique: mocks.workItem } } }));
vi.mock("./handler-actor", () => ({ workCapsuleActor: mocks.actor }));
vi.mock("@/lib/work-management/room-agent-access.server", () => ({ resolveAgentRoomAccess: mocks.access }));
import { authorizeOAuthCapsuleTarget } from "./oauth-workroom-ownership";
const input = { params: { capsuleId: "WC-ONE" }, userId: "alice", agentId: "claude", authSource: "oauth", action: true };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.actor.mockResolvedValue({ userId: "alice", agentId: "claude", principalId: "human-alice", agentPrincipalId: "assistant" });
  mocks.room.mockResolvedValue({ leaseHolderPrincipalId: "human-alice", requestedByPrincipalId: "human-alice", createdByPrincipalId: "assistant", workItemId: null });
  mocks.access.mockResolvedValue({ decision: { level: "none" } });
});
it("authorizes each separately created room without a new login", async () => {
  expect(await authorizeOAuthCapsuleTarget(input)).toBe(true);
  expect(await authorizeOAuthCapsuleTarget({ ...input, params: { capsuleId: "WC-TWO" } })).toBe(true);
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
