import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ current: vi.fn(), alias: vi.fn(), aliases: vi.fn(), agents: vi.fn(), agent: vi.fn(), update: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: mocks.current }));
vi.mock("@dpf/db", () => ({ prisma: { principalAlias: { findFirst: mocks.alias, findMany: mocks.aliases }, agent: { findMany: mocks.agents }, $transaction: (fn: (tx: unknown) => unknown) => fn({
  principalAlias: { findFirst: mocks.alias }, agent: { findUnique: mocks.agent },
  principal: { updateMany: mocks.update }, authorizationDecisionLog: { create: mocks.audit },
}) } }));
import { setCoworkerDataAccess, listCoworkerDataAccessChoices } from "./coworker-data-access";

const input = { agentId: "AGT-EXT-CODEX", expected: ["public"], levels: ["public", "internal"], reason: "Approved internal development work" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.current.mockResolvedValue({ userId: "alice", isSuperuser: true, platformRoles: [] });
  mocks.alias.mockResolvedValue({ principal: { id: "human", kind: "human", status: "active", sensitivityClearance: ["public", "internal"] } });
  mocks.agent.mockResolvedValue({ status: "active", archived: false });
  mocks.update.mockResolvedValue({ count: 1 });
  mocks.audit.mockResolvedValue({});
  mocks.alias.mockImplementation(async ({ where }) => ({ principal: where.aliasType === "user"
    ? { id: "human", kind: "human", status: "active", sensitivityClearance: ["public", "internal"] }
    : { id: "agent", kind: "agent", status: "active", sensitivityClearance: ["public"] } }));
});
describe("audited coworker data access", () => {
  it("keeps distinct legacy assistant identities editable without replacing their connection", async () => {
    mocks.agents.mockResolvedValue([{ agentId: "AGT-EXT-CODEX", name: "Codex" }, { agentId: "external-codex", name: "Codex" }]);
    mocks.aliases.mockResolvedValue([
      { aliasValue: "AGT-EXT-CODEX", principal: { sensitivityClearance: ["internal"] } },
      { aliasValue: "external-codex", principal: { sensitivityClearance: ["public"] } },
    ]);
    expect(await listCoworkerDataAccessChoices("alice")).toEqual([
      { agentId: "AGT-EXT-CODEX", name: "Codex", levels: ["internal"], editable: true },
      { agentId: "external-codex", name: "Codex", levels: ["public"], editable: true },
    ]);
    mocks.current.mockResolvedValue(null);
    expect(await listCoworkerDataAccessChoices("alice")).toEqual([]);
  });
  it("updates the exact linked assistant with an atomic before/after audit", async () => {
    await expect(setCoworkerDataAccess("alice", input)).resolves.toEqual({ levels: ["public", "internal"] });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "agent", kind: "agent", status: "active", sensitivityClearance: { equals: ["public"] } }, data: { sensitivityClearance: ["public", "internal"] } });
    expect(mocks.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ actorRef: "alice", actionKey: "coworker-data-access", objectRef: "AGT-EXT-CODEX", rationale: expect.objectContaining({ before: ["public"], after: ["public", "internal"] }) }) });
  });
  it("does not trust a previous login's administrator role", async () => {
    mocks.current.mockResolvedValue({ userId: "alice", isSuperuser: false, platformRoles: ["HR-600"] });
    await expect(setCoworkerDataAccess("alice", input)).rejects.toThrow("manage coworkers");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("refuses disabled humans", async () => {
    mocks.current.mockResolvedValue(null);
    await expect(setCoworkerDataAccess("alice", input)).rejects.toThrow("manage coworkers");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("cannot grant beyond the administrator's recorded access, even for a superuser", async () => {
    await expect(setCoworkerDataAccess("alice", { ...input, levels: ["public", "restricted"] })).rejects.toThrow("your own data access");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each([{ levels: ["bogus"] }, { levels: [] }])("refuses invalid levels $levels", async ({ levels }) => {
    await expect(setCoworkerDataAccess("alice", { ...input, levels })).rejects.toThrow();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("refuses archived coworkers", async () => {
    mocks.agent.mockResolvedValue({ status: "active", archived: true });
    await expect(setCoworkerDataAccess("alice", input)).rejects.toThrow("active coworker");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("does not overwrite a concurrent permission change", async () => {
    mocks.update.mockResolvedValue({ count: 0 });
    await expect(setCoworkerDataAccess("alice", input)).rejects.toThrow("changed");
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("fails the transaction when the audit cannot be saved", async () => {
    mocks.audit.mockRejectedValue(new Error("audit unavailable"));
    await expect(setCoworkerDataAccess("alice", input)).rejects.toThrow("audit unavailable");
  });
  it("allows explicit revocation without changing login, grants or room membership", async () => {
    await expect(setCoworkerDataAccess("alice", { ...input, expected: ["public", "internal"], levels: ["public"] })).resolves.toEqual({ levels: ["public"] });
    expect(mocks.update.mock.calls[0][0].data).toEqual({ sensitivityClearance: ["public"] });
  });
});
