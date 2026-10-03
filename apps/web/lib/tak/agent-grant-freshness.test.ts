import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  agent: { findFirst: vi.fn() },
  agentToolGrant: { upsert: vi.fn(), deleteMany: vi.fn() },
  agentToolGrantRevocation: { upsert: vi.fn(), deleteMany: vi.fn() },
}));
vi.mock("@dpf/db", () => ({ prisma: db }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
});

describe("runtime grant freshness (BI-F2F09597)", () => {
  it("observes an administrator grant and revoke on the next authorization read", async () => {
    const held = new Set(["registry_read"]);
    db.agent.findFirst.mockImplementation(async () => ({
      toolGrants: [...held].map((grantKey) => ({ grantKey })),
    }));
    db.agentToolGrant.upsert.mockImplementation(async ({ create }) => {
      held.add(create.grantKey);
    });
    db.agentToolGrant.deleteMany.mockImplementation(async ({ where }) => {
      held.delete(where.grantKey);
    });
    const { getAgentToolGrantsAsync, isToolAllowedByGrants } = await import("./agent-grants");
    const { applyCoworkerToolGrant, removeCoworkerToolGrant } = await import("./coworker-tool-grant-core");
    const canReadLogs = async () => isToolAllowedByGrants(
      "admin_view_logs", await getAgentToolGrantsAsync("AGT-EXT-CODEX"),
    );
    expect(await canReadLogs()).toBe(false);
    await applyCoworkerToolGrant("codex-row", "admin_read", "operator");
    expect(await canReadLogs()).toBe(true);
    await removeCoworkerToolGrant("codex-row", "admin_read", "operator");
    expect(await canReadLogs()).toBe(false);
  });

  it("treats zero stored grants as authoritative, including after the last revoke", async () => {
    const { getAgentToolGrantsAsync } = await import("./agent-grants");
    db.agent.findFirst.mockResolvedValueOnce({ toolGrants: [{ grantKey: "admin_read" }] });
    expect(await getAgentToolGrantsAsync("AGT-EXT-CODEX")).toEqual(["admin_read"]);
    db.agent.findFirst.mockResolvedValue({ toolGrants: [] });
    expect(await getAgentToolGrantsAsync("AGT-EXT-CODEX")).toEqual([]);
  });

  it("does not allow a synchronous registry lookup to override current stored grants", async () => {
    const { getAgentToolGrants, getAgentToolGrantsAsync } = await import("./agent-grants");
    expect(getAgentToolGrants("AGT-EXT-CODEX")?.length).toBeGreaterThan(0);
    db.agent.findFirst.mockResolvedValue({ toolGrants: [] });
    expect(await getAgentToolGrantsAsync("AGT-EXT-CODEX")).toEqual([]);
  });

  it("fails closed on an authoritative read failure and recovers on the next read", async () => {
    const { getAgentToolGrantsAsync } = await import("./agent-grants");
    db.agent.findFirst.mockRejectedValueOnce(new Error("database unavailable"));
    expect(await getAgentToolGrantsAsync("AGT-EXT-CODEX")).toEqual([]);
    db.agent.findFirst.mockResolvedValue({ toolGrants: [{ grantKey: "registry_read" }] });
    expect(await getAgentToolGrantsAsync("AGT-EXT-CODEX")).toEqual(["registry_read"]);
  });

  it("does not retain a previous grant when the next authoritative read fails", async () => {
    const { getAgentToolGrantsAsync } = await import("./agent-grants");
    db.agent.findFirst.mockResolvedValueOnce({ toolGrants: [{ grantKey: "admin_read" }] });
    expect(await getAgentToolGrantsAsync("AGT-EXT-CODEX")).toEqual(["admin_read"]);
    db.agent.findFirst.mockRejectedValueOnce(new Error("database unavailable"));
    expect(await getAgentToolGrantsAsync("AGT-EXT-CODEX")).toEqual([]);
  });

  it("keeps legacy registry fallback only for a successful lookup with no stored agent", async () => {
    const { getAgentToolGrants, getAgentToolGrantsAsync } = await import("./agent-grants");
    db.agent.findFirst.mockResolvedValueOnce(null);
    expect(await getAgentToolGrantsAsync("AGT-EXT-CODEX")).toEqual(getAgentToolGrants("AGT-EXT-CODEX"));
    db.agent.findFirst.mockResolvedValue({ toolGrants: [] });
    expect(await getAgentToolGrantsAsync("AGT-EXT-CODEX")).toEqual([]);
    db.agent.findFirst.mockResolvedValue(null);
    expect(await getAgentToolGrantsAsync("unknown-coworker")).toEqual([]);
  });
});
