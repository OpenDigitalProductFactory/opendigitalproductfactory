import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ current: vi.fn(), alias: vi.fn(), room: vi.fn(), bindings: vi.fn(), consent: vi.fn(), save: vi.fn(), audit: vi.fn(), tx: vi.fn() }));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: m.current }));
vi.mock("@/lib/auth/oauth-identity-binding", () => ({ resolveOAuthConsent: m.consent }));
vi.mock("./room-participant-assignment.server", () => ({ persistWorkroomParticipantAssignment: m.save }));
vi.mock("@dpf/db", () => { const db = {
  principalAlias: { findFirst: m.alias }, workroom: { findUnique: m.room }, authorityBinding: { findMany: m.bindings }, authorizationDecisionLog: { create: m.audit },
}; return { prisma: { ...db, $transaction: (fn: (tx: unknown) => unknown, options: unknown) => { m.tx(options); return fn(db); } } }; });
import { listWorkroomAssistantChoices, inviteWorkroomAssistant } from "./workroom-assistant-invitation";
const human = { id: "human", principalId: "PRN-human", kind: "human", status: "active", sensitivityClearance: ["internal"] };
const assistant = { id: "assistant", principalId: "PRN-assistant", kind: "agent", status: "active", sensitivityClearance: ["internal"] };
const room = () => ({ id: "room-one", capsuleId: "WC-ONE", requestedByPrincipalId: human.id, createdByPrincipalId: human.id, leaseHolderPrincipalId: human.id, scopeClaims: [], participants: [], workItem: null });
const binding = { id: "binding", oauthClientId: "client", resourceRef: "https://dpf/api/mcp/v1", grants: [{ grantKey: "mcp:read", mode: "allow" }], appliedAgent: { agentId: "codex", displayName: "Codex" } };
const input = { workroomId: "room-one", agentId: "codex", role: "contributor" as const };
beforeEach(() => {
  vi.resetAllMocks();
  m.current.mockResolvedValue({ userId: "alice", isSuperuser: false });
  m.alias.mockImplementation(async ({ where }) => ({ principal: where.aliasType === "user" ? human : assistant }));
  m.room.mockResolvedValue(room()); m.bindings.mockResolvedValue([binding]);
  m.consent.mockResolvedValue({ agentId: "codex" }); m.save.mockResolvedValue({ workroomId: "room-one", principalId: "assistant" });
});
it("lists only the current human's still-authorized OAuth assistants", async () => {
  expect(await listWorkroomAssistantChoices("alice", "room-one")).toEqual([{ agentId: "codex", name: "Codex", role: null }]);
  expect(m.bindings).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ oauthUserId: "alice", oauthPurpose: "consent", status: "active", oauthClient: { revokedAt: null } }) }));
  m.consent.mockResolvedValue(null);
  expect(await listWorkroomAssistantChoices("alice", "room-one")).toEqual([]);
});
it("loads a contributor's current assignment instead of silently offering a downgrade", async () => {
  m.room.mockResolvedValue({ ...room(), participants: [{ principalId: assistant.id, lifecycle: "active", roles: ["contributor"] }] });
  expect(await listWorkroomAssistantChoices("alice", "room-one")).toEqual([{ agentId: "codex", name: "Codex", role: "contributor" }]);
});
it("invites only the selected room with an atomic actor/before/after audit", async () => {
  await expect(inviteWorkroomAssistant("alice", input)).resolves.toEqual({ agentId: "codex", role: "contributor" });
  expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ workroomId: "room-one", principalRef: "PRN-assistant", roles: ["contributor"] }), expect.anything());
  expect(m.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ actorRef: "alice", objectRef: "WC-ONE", agentContextRef: "codex", rationale: expect.objectContaining({ before: null, after: { lifecycle: "active", roles: ["contributor"] } }) }) });
  expect(m.tx).toHaveBeenCalledWith({ isolationLevel: "Serializable" });
});
it("does not admit a different human's assistant or a revoked connection", async () => {
  m.bindings.mockResolvedValue([]);
  await expect(inviteWorkroomAssistant("alice", input)).rejects.toThrow("approved connection");
  expect(m.save).not.toHaveBeenCalled();
});
it("does not let a non-owner or disabled human manage the room", async () => {
  m.room.mockResolvedValue({ ...room(), requestedByPrincipalId: "bob", leaseHolderPrincipalId: "bob", createdByPrincipalId: "bob" });
  await expect(inviteWorkroomAssistant("alice", input)).rejects.toThrow("room owner");
  m.current.mockResolvedValue(null);
  await expect(inviteWorkroomAssistant("alice", input)).rejects.toThrow("room owner");
  expect(m.save).not.toHaveBeenCalled();
});
it("a case content denial also prevents its owner granting room access", async () => {
  m.room.mockResolvedValue({ ...room(), workItem: { evidence: [{ workroomPolicy: { admittedPrincipalRefs: [] } }] } });
  await expect(inviteWorkroomAssistant("alice", input)).rejects.toThrow("room owner");
  expect(m.save).not.toHaveBeenCalled();
});
it("requires current human clearance and active assistant identity", async () => {
  m.room.mockResolvedValue({ ...room(), scopeClaims: [{ workroomBoundary: { sensitivityCeiling: "restricted" } }] });
  await expect(inviteWorkroomAssistant("alice", input)).rejects.toThrow("information");
  m.room.mockResolvedValue(room());
  m.alias.mockImplementation(async ({ where }) => ({ principal: where.aliasType === "user" ? human : { ...assistant, status: "inactive" } }));
  await expect(inviteWorkroomAssistant("alice", input)).rejects.toThrow("active assistant");
  expect(m.save).not.toHaveBeenCalled();
});
it("does not overwrite governance roles through the recovery control", async () => {
  m.room.mockResolvedValue({ ...room(), participants: [{ principalId: assistant.id, lifecycle: "active", roles: ["coordinator"] }] });
  await expect(inviteWorkroomAssistant("alice", input)).rejects.toThrow("assigned role");
  expect(m.save).not.toHaveBeenCalled();
});
it("reactivates a removed participant with only the explicitly selected role", async () => {
  m.room.mockResolvedValue({ ...room(), participants: [{ principalId: assistant.id, lifecycle: "archived", roles: ["coordinator"] }] });
  await inviteWorkroomAssistant("alice", { ...input, role: "observer" });
  expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ roles: ["observer"] }), expect.anything());
});
it("fails without a saved audit and rejects unsupported roles", async () => {
  m.audit.mockRejectedValue(new Error("audit unavailable"));
  await expect(inviteWorkroomAssistant("alice", input)).rejects.toThrow("audit unavailable");
  await expect(inviteWorkroomAssistant("alice", { ...input, role: "coordinator" as "contributor" })).rejects.toThrow("Read only");
});
