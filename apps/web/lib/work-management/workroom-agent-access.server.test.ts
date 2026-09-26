import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ human: vi.fn(), alias: vi.fn(), agent: vi.fn(), room: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { principalAlias: { findFirst: m.alias }, agent: { findUnique: m.agent }, workroom: { findUnique: m.room } } }));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: m.human }));
import { resolveAgentWorkroomAccess } from "./workroom-agent-access.server";
const human = { id: "human-row", principalId: "PRN-human", kind: "human", status: "active", sensitivityClearance: ["internal"] };
const agent = { id: "agent-row", principalId: "PRN-agent", kind: "agent", status: "active", sensitivityClearance: ["internal"] };
const room = () => ({ id: "selected", requestedByPrincipalId: human.id, createdByPrincipalId: agent.id, leaseHolderPrincipalId: human.id, scopeClaims: [], participants: [], workItem: null });
const input = { userId: "alice", agentId: "codex", workroomId: "selected", requested: "action" as const };
beforeEach(() => {
  vi.resetAllMocks();
  m.human.mockResolvedValue({ userId: "alice", isSuperuser: true });
  m.agent.mockResolvedValue({ status: "active", archived: false });
  m.alias.mockImplementation(async ({ where }) => ({ principal: where.aliasType === "user" ? human : agent }));
  m.room.mockResolvedValue(room());
});
it("uses the selected room and reuses the connection for concurrent tasks", async () => {
  expect((await resolveAgentWorkroomAccess(input)).decision.level).toBe("action");
  expect((await resolveAgentWorkroomAccess({ ...input, workroomId: "another" })).decision.level).toBe("action");
  expect(m.room.mock.calls.map(([args]) => args.where)).toEqual([{ id: "selected" }, { id: "another" }]);
});
it("does not borrow sibling holders or work-item assignment", async () => {
  m.room.mockResolvedValue({ ...room(), createdByPrincipalId: "other-agent", workItem: { evidence: [], assignedToAgentId: "codex" } });
  expect((await resolveAgentWorkroomAccess(input)).decision.reason).toBe("not-admitted");
});
it("requires this human's membership even with a shared assistant and superuser flag", async () => {
  m.room.mockResolvedValue({ ...room(), requestedByPrincipalId: "bob", leaseHolderPrincipalId: "bob" });
  expect((await resolveAgentWorkroomAccess(input)).decision.reason).toBe("not-admitted");
});
it.each(["removed", "inactive"])("an explicit %s participant overrides historical ownership", async (lifecycle) => {
  m.room.mockResolvedValue({ ...room(), participants: [{ principalId: agent.id, lifecycle, roles: ["contributor"] }] });
  expect((await resolveAgentWorkroomAccess(input)).decision.reason).toBe("not-admitted");
});
it("an observer can read but cannot write, including a historical creator", async () => {
  m.room.mockResolvedValue({ ...room(), participants: [{ principalId: agent.id, lifecycle: "active", roles: ["observer"] }] });
  expect((await resolveAgentWorkroomAccess(input)).decision.reason).toBe("not-admitted");
  expect((await resolveAgentWorkroomAccess({ ...input, requested: "content" })).decision.level).toBe("content");
});
it("an explicit contributor can recover only this room", async () => {
  m.room.mockResolvedValue({ ...room(), createdByPrincipalId: human.id, participants: [{ principalId: agent.id, lifecycle: "active", roles: ["contributor"] }] });
  expect((await resolveAgentWorkroomAccess(input)).decision.level).toBe("action");
  m.room.mockResolvedValue({ ...room(), createdByPrincipalId: human.id });
  expect((await resolveAgentWorkroomAccess({ ...input, workroomId: "sibling" })).decision.reason).toBe("not-admitted");
});
it("checks current clearance in unanchored rooms on every request", async () => {
  m.alias.mockImplementation(async ({ where }) => ({ principal: where.aliasType === "user" ? human : { ...agent, sensitivityClearance: ["public"] } }));
  expect((await resolveAgentWorkroomAccess(input)).decision.reason).toBe("insufficient-clearance");
  m.alias.mockImplementation(async ({ where }) => ({ principal: where.aliasType === "user" ? human : agent }));
  expect((await resolveAgentWorkroomAccess(input)).decision.level).toBe("action");
});
it("preserves stricter room boundaries and case policy", async () => {
  m.room.mockResolvedValue({ ...room(), scopeClaims: [{ workroomBoundary: { sensitivityCeiling: "confidential" } }] });
  expect((await resolveAgentWorkroomAccess(input)).decision.reason).toBe("insufficient-clearance");
  m.room.mockResolvedValue({ ...room(), workItem: { evidence: [{ workroomPolicy: { actionPrincipalRefs: [human.principalId], sensitivityCeiling: "internal" } }] } });
  expect((await resolveAgentWorkroomAccess(input)).decision.reason).toBe("not-admitted");
});
it("a sensitivity-only case policy does not invent an admission denial", async () => {
  m.room.mockResolvedValue({ ...room(), workItem: { evidence: [{ workroomPolicy: { sensitivityCeiling: "internal" } }] } });
  expect((await resolveAgentWorkroomAccess(input)).decision.level).toBe("action");
});
it("explicitly denied content cannot become action access when the action field is absent", async () => {
  m.room.mockResolvedValue({ ...room(), workItem: { evidence: [{ workroomPolicy: { admittedPrincipalRefs: [] } }] } });
  expect((await resolveAgentWorkroomAccess(input)).decision.reason).toBe("not-admitted");
});
it("denies disabled humans and inactive assistant identities", async () => {
  m.human.mockResolvedValue(null);
  expect((await resolveAgentWorkroomAccess(input)).decision.reason).toBe("not-admitted");
  m.human.mockResolvedValue({ userId: "alice" });
  m.alias.mockResolvedValue({ principal: { ...agent, status: "inactive" } });
  expect((await resolveAgentWorkroomAccess(input)).decision.reason).toBe("not-admitted");
});

// BI-821EEB18 — a person hands their own room to a replacement assistant.
const replacement = { id: "new-agent-row", principalId: "PRN-new-agent", kind: "agent", status: "active", sensitivityClearance: ["internal"] };
const ownedRoom = (participants: unknown[] = [{ principalId: human.id, lifecycle: "active", roles: ["coordinator"] }]) =>
  ({ ...room(), leaseHolderPrincipalId: agent.id, requestedByPrincipalId: human.id, participants });
const asReplacement = () => m.alias.mockImplementation(async ({ where }) => ({ principal: where.aliasType === "user" ? human : replacement }));
it("lets the owner hand the room to an assistant nobody admitted, only through a handover", async () => {
  asReplacement();
  m.room.mockResolvedValue(ownedRoom());
  expect((await resolveAgentWorkroomAccess(input)).decision.reason).toBe("not-admitted");
  expect((await resolveAgentWorkroomAccess({ ...input, requested: "content" })).decision.reason).toBe("not-admitted");
  const handover = await resolveAgentWorkroomAccess({ ...input, handover: true });
  expect(handover).toMatchObject({ decision: { level: "action" }, handover: true });
  // A handover grants no content read on its own terms.
  expect((await resolveAgentWorkroomAccess({ ...input, requested: "content", handover: true })).decision.reason).toBe("not-admitted");
});
it.each([
  ["removed", [{ principalId: human.id, lifecycle: "active", roles: ["coordinator"] }, { principalId: replacement.id, lifecycle: "removed", roles: ["contributor"] }]],
  ["narrowed to observer", [{ principalId: human.id, lifecycle: "active", roles: ["coordinator"] }, { principalId: replacement.id, lifecycle: "active", roles: ["observer"] }]],
  ["the person only contributes", [{ principalId: human.id, lifecycle: "active", roles: ["contributor"] }, { principalId: "bob", lifecycle: "active", roles: ["coordinator"] }]],
  ["someone else oversees a legacy room", [{ principalId: "bob", lifecycle: "active", roles: ["coordinator"] }]],
])("refuses a handover when %s", async (_case, participants) => {
  asReplacement();
  m.room.mockResolvedValue(ownedRoom(participants));
  expect((await resolveAgentWorkroomAccess({ ...input, handover: true })).decision.level).toBe("none");
});
// BI-A27B903D — an AI coordinator acts for people; it never displaces the room's owner.
const aiCoordinator = { principalId: "ai-coordinator-row", lifecycle: "active", roles: ["coordinator"], principal: { kind: "agent" } };
it("lets the person who holds the room hand it over when only an AI coworker coordinates it", async () => {
  asReplacement();
  m.room.mockResolvedValue(ownedRoom([aiCoordinator]));
  expect((await resolveAgentWorkroomAccess({ ...input, handover: true })).decision.level).toBe("action");
  // A human coordinator still takes the room over, and an agent holder gains nothing.
  m.room.mockResolvedValue(ownedRoom([aiCoordinator, { principalId: "bob", lifecycle: "active", roles: ["coordinator"], principal: { kind: "human" } }]));
  expect((await resolveAgentWorkroomAccess({ ...input, handover: true })).decision.level).toBe("none");
  m.room.mockResolvedValue({ ...ownedRoom([aiCoordinator]), requestedByPrincipalId: "bob", createdByPrincipalId: "bob" });
  expect((await resolveAgentWorkroomAccess({ ...input, handover: true })).decision.level).toBe("none");
});
it("lets a legacy holder hand over a room nobody oversees, and still checks the assistant's clearance", async () => {
  m.alias.mockImplementation(async ({ where }) => ({ principal: where.aliasType === "user" ? human : { ...replacement, sensitivityClearance: ["public"] } }));
  m.room.mockResolvedValue(ownedRoom([]));
  expect((await resolveAgentWorkroomAccess({ ...input, handover: true })).decision.reason).toBe("insufficient-clearance");
  asReplacement();
  expect((await resolveAgentWorkroomAccess({ ...input, handover: true })).decision.level).toBe("action");
  m.room.mockResolvedValue({ ...ownedRoom([]), requestedByPrincipalId: "bob", leaseHolderPrincipalId: "bob" });
  expect((await resolveAgentWorkroomAccess({ ...input, handover: true })).decision.level).toBe("none");
});
