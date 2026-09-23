import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ agent: vi.fn(), human: vi.fn(), current: vi.fn(), capsules: vi.fn(), principals: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { workroom: { findMany: mocks.capsules }, principal: { findMany: mocks.principals } } }));
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
});
