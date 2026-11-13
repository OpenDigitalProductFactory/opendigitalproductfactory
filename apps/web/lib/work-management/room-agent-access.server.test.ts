import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ agent: vi.fn(), human: vi.fn(), current: vi.fn(), capsules: vi.fn(), principals: vi.fn(), backlog: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { workroom: { findMany: mocks.capsules }, principal: { findMany: mocks.principals },
  backlogItem: { findFirst: mocks.backlog } } }));
vi.mock("@/lib/identity/principal-linking", () => ({ ensureAgentPrincipalIdentity: mocks.agent, syncUserPrincipal: mocks.human }));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: mocks.current }));
import { resolveAgentRoomAccess } from "./room-agent-access.server";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.agent.mockResolvedValue({ principalId: "PRN-shared-agent", sensitivityClearance: ["internal"] });
  mocks.human.mockImplementation(async (id) => ({ principalId: `PRN-${id}`, sensitivityClearance: ["internal"] }));
  mocks.current.mockResolvedValue({ isSuperuser: false });
  mocks.capsules.mockResolvedValue([]);
  mocks.principals.mockResolvedValue([]);
});
describe("human and coworker room authority intersection", () => {
  const workItem = { id: "room-a", assignedToAgentId: "shared-agent", assignedToUserId: "alice", evidence: [] };
  it.each(["content", "action"] as const)("does not let Bob borrow Alice's shared coworker admission for %s", async (requested) => {
    const result = await resolveAgentRoomAccess({ agentId: "shared-agent", userId: "bob", requested, workItem });
    expect(result.decision.level).toBe("none");
  });
  it("allows the assigned human when the coworker is separately admitted", async () => {
    const result = await resolveAgentRoomAccess({ agentId: "shared-agent", userId: "alice", requested: "action", workItem });
    expect(result.decision.level).toBe("action");
  });
  it("does not treat an unassigned room as human content admission", async () => {
    const result = await resolveAgentRoomAccess({ agentId: "shared-agent", userId: "bob", requested: "content",
      workItem: { ...workItem, assignedToUserId: null } });
    expect(result.decision.level).toBe("none");
  });
  it("refuses a disabled human even with an admitted coworker", async () => {
    mocks.current.mockResolvedValue(null);
    expect((await resolveAgentRoomAccess({ agentId: "shared-agent", userId: "alice", requested: "action", workItem })).decision.level).toBe("none");
  });
  it("human superuser does not bypass the coworker's separate admission", async () => {
    mocks.current.mockResolvedValue({ isSuperuser: true });
    expect((await resolveAgentRoomAccess({ agentId: "shared-agent", userId: "alice", requested: "action",
      workItem: { ...workItem, assignedToAgentId: null } })).decision.level).toBe("none");
  });
  it("rechecks saved coworker clearance for an existing connection on every request", async () => {
    const request = { agentId: "shared-agent", userId: "alice", requested: "action" as const, workItem };
    mocks.agent.mockResolvedValue({ principalId: "PRN-shared-agent", sensitivityClearance: ["public"] });
    expect((await resolveAgentRoomAccess(request)).decision.reason).toBe("insufficient-clearance");
    mocks.agent.mockResolvedValue({ principalId: "PRN-shared-agent", sensitivityClearance: ["public", "internal"] });
    expect((await resolveAgentRoomAccess(request)).decision.level).toBe("action");
    mocks.agent.mockResolvedValue({ principalId: "PRN-shared-agent", sensitivityClearance: ["public"] });
    expect((await resolveAgentRoomAccess(request)).decision.reason).toBe("insufficient-clearance");
  });
});

// BI-ED5561BB: caseKey rooms apply DI-5E19848444FC (platform work is public),
// so a public-cleared coworker is admitted to platform rooms and nowhere higher.
describe("room ceiling from the room's backlog item", () => {
  const platformRoom = { id: "room-p", assignedToAgentId: "shared-agent", assignedToUserId: "alice", evidence: [],
    sourceType: "backlog-item", sourceId: "BI-PLATFORM" };
  const publicAgent = { principalId: "PRN-shared-agent", sensitivityClearance: ["public"] };

  it("admits a public-cleared coworker to a platform room with no explicit ceiling", async () => {
    mocks.agent.mockResolvedValue(publicAgent);
    mocks.backlog.mockResolvedValue({ sensitivity: "internal", scopeKind: "platform", digitalProduct: null });
    const result = await resolveAgentRoomAccess({ agentId: "shared-agent", userId: "alice", requested: "content", workItem: platformRoom });
    expect(result.decision.level).toBe("content");
  });

  it.each([
    ["a non-platform internal room", { sensitivity: "internal", scopeKind: "archetype-leaf", digitalProduct: null }, []],
    ["a restricted platform room", { sensitivity: "restricted", scopeKind: "platform", digitalProduct: null }, []],
    ["a room whose policy sets internal", { sensitivity: "internal", scopeKind: "platform", digitalProduct: null },
      [{ workroomPolicy: { sensitivityCeiling: "internal" } }]],
  ])("still refuses a public-cleared coworker in %s", async (_label, backlog, evidence) => {
    mocks.agent.mockResolvedValue(publicAgent);
    mocks.backlog.mockResolvedValue(backlog);
    const result = await resolveAgentRoomAccess({ agentId: "shared-agent", userId: "alice", requested: "content",
      workItem: { ...platformRoom, evidence } });
    expect(result.decision.reason).toBe("insufficient-clearance");
  });
});
