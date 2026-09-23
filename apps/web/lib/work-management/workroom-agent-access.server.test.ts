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
