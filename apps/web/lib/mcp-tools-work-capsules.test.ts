import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  workCapsule: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  workCapsuleActivity: {
    create: vi.fn(),
  },
};

vi.mock("@dpf/db", () => ({
  DISCOVERY_TRIAGE_AGENT_ID: "AGT-DISCOVERY",
  prisma: mockPrisma,
}));

vi.mock("@/lib/identity/principal-linking", () => ({
  ensureAgentPrincipalIdentity: vi.fn(async () => ({ id: "principal-agent" })),
  syncUserPrincipal: vi.fn(async () => ({ id: "principal-user" })),
}));

describe("work capsule MCP tools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("imports mcp-tools without runtime error under the @dpf/db mock", async () => {
    await expect(import("./mcp-tools")).resolves.toBeDefined();
  });

  it("list_work_capsules returns capsule rows", async () => {
    mockPrisma.workCapsule.findMany.mockResolvedValue([
      {
        capsuleId: "WC-1",
        title: "Adopt work",
        status: "ready",
        source: "external-adoption",
        executorKind: "codex-desktop",
        updatedAt: new Date("2026-05-14T00:00:00.000Z"),
      },
    ]);

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool("list_work_capsules", { status: "ready" }, "user-1");

    expect(result.success).toBe(true);
    expect(result.data?.capsules).toEqual([
      expect.objectContaining({ capsuleId: "WC-1", status: "ready" }),
    ]);
  });

  it("create_work_capsule requires idempotencyKey", async () => {
    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool(
      "create_work_capsule",
      { title: "No key", objective: "Missing key", source: "manual" },
      "user-1",
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("missing_idempotencyKey");
  });

  it("heartbeat_capsule renews a lease", async () => {
    mockPrisma.workCapsule.update.mockResolvedValue({ id: "row-1", capsuleId: "WC-1" });
    mockPrisma.workCapsuleActivity.create.mockResolvedValue({ id: "activity-1" });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool("heartbeat_capsule", { capsuleId: "WC-1" }, "user-1", {
      agentId: "codex",
    });

    expect(result.success).toBe(true);
    expect(mockPrisma.workCapsule.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { capsuleId: "WC-1" },
    }));
  });

  it("adopt_worktree creates a capsule for a branch/worktree pair", async () => {
    mockPrisma.workCapsule.findFirst.mockResolvedValue(null);
    mockPrisma.workCapsule.create.mockResolvedValue({ id: "row-1", capsuleId: "WC-ADOPT" });
    mockPrisma.workCapsuleActivity.create.mockResolvedValue({ id: "activity-1" });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool("adopt_worktree", {
      title: "Adopt recovery branch",
      objective: "Recover useful work.",
      repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      headBranch: "fix/recovery",
      worktreePath: "D:/DPF-recovery",
      executorKind: "codex-desktop",
    }, "user-1", { agentId: "codex" });

    expect(result.success).toBe(true);
    expect(result.entityId).toBe("WC-ADOPT");
  });

  it("claim_capsule_scope stores typed scope claims", async () => {
    mockPrisma.workCapsule.findUnique.mockResolvedValue({
      id: "row-1",
      capsuleId: "WC-SCOPE",
      scopeClaims: [],
    });
    mockPrisma.workCapsule.update.mockResolvedValue({ id: "row-1", capsuleId: "WC-SCOPE" });
    mockPrisma.workCapsuleActivity.create.mockResolvedValue({ id: "activity-1" });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool("claim_capsule_scope", {
      capsuleId: "WC-SCOPE",
      claims: [{ kind: "path", value: "apps/web/lib/work-capsules.ts", intent: "edit" }],
    }, "user-1");

    expect(result.success).toBe(true);
    expect(mockPrisma.workCapsule.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        scopeClaims: [expect.objectContaining({
          kind: "path",
          value: "apps/web/lib/work-capsules.ts",
          intent: "edit",
        })],
      }),
    }));
  });

  it("update_work_capsule_status writes a status override", async () => {
    mockPrisma.workCapsule.findUnique.mockResolvedValue({
      id: "row-1",
      capsuleId: "WC-STATUS",
      workspaceState: { note: "preserve me" },
    });
    mockPrisma.workCapsule.update.mockResolvedValue({ id: "row-1", capsuleId: "WC-STATUS", status: "blocked" });
    mockPrisma.workCapsuleActivity.create.mockResolvedValue({ id: "activity-1" });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool("update_work_capsule_status", {
      capsuleId: "WC-STATUS",
      status: "blocked",
      reason: "Provider credential blocked.",
    }, "user-1");

    expect(result.success).toBe(true);
    expect(mockPrisma.workCapsule.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { capsuleId: "WC-STATUS" },
      data: expect.objectContaining({
        status: "blocked",
        workspaceState: expect.objectContaining({
          note: "preserve me",
          statusOverride: expect.objectContaining({ reason: "Provider credential blocked." }),
        }),
      }),
    }));
  });

  it("release_capsule_scope removes matching scope claims", async () => {
    mockPrisma.workCapsule.findUnique.mockResolvedValue({
      id: "row-1",
      capsuleId: "WC-RELEASE",
      scopeClaims: [
        {
          kind: "path",
          value: "apps/web/lib/work-capsules.ts",
          intent: "edit",
          recordedAt: "2026-05-14T00:00:00.000Z",
          recordedByPrincipalId: "principal-1",
        },
        {
          kind: "route",
          value: "/build/work",
          intent: "read",
          recordedAt: "2026-05-14T00:00:00.000Z",
          recordedByPrincipalId: "principal-1",
        },
      ],
    });
    mockPrisma.workCapsule.update.mockResolvedValue({ id: "row-1", capsuleId: "WC-RELEASE" });
    mockPrisma.workCapsuleActivity.create.mockResolvedValue({ id: "activity-1" });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool("release_capsule_scope", {
      capsuleId: "WC-RELEASE",
      claims: [{ kind: "path", value: "apps/web/lib/work-capsules.ts" }],
    }, "user-1");

    expect(result.success).toBe(true);
    expect(mockPrisma.workCapsule.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        scopeClaims: [expect.objectContaining({ kind: "route", value: "/build/work" })],
      }),
    }));
  });
});
