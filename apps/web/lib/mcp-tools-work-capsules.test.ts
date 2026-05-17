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
    // read tool — must never touch lease fields
    expect(mockPrisma.workCapsule.update).not.toHaveBeenCalled();
    expect(mockPrisma.workCapsuleActivity.create).not.toHaveBeenCalled();
  });

  it("get_work_capsule does not renew leases for read-only hydration", async () => {
    mockPrisma.workCapsule.findUnique.mockResolvedValue({
      id: "row-1",
      capsuleId: "WC-READ",
      title: "Read only",
      activities: [],
    });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool("get_work_capsule", { capsuleId: "WC-READ" }, "user-1", {
      agentId: "codex",
    });

    expect(result.success).toBe(true);
    expect(mockPrisma.workCapsule.update).not.toHaveBeenCalled();
    expect(mockPrisma.workCapsuleActivity.create).not.toHaveBeenCalled();
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
    expect(mockPrisma.workCapsule.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.workCapsule.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { capsuleId: "WC-1" },
    }));
    expect(mockPrisma.workCapsuleActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "lease-renewed", recordedByAgentId: "codex" }),
    }));
  });

  it("record_capsule_evidence auto-renews the lease after a capsule-scoped write", async () => {
    mockPrisma.workCapsule.findUnique.mockResolvedValue({ id: "row-1", capsuleId: "WC-EVIDENCE" });
    mockPrisma.workCapsule.update.mockResolvedValue({ id: "row-1", capsuleId: "WC-EVIDENCE" });
    mockPrisma.workCapsuleActivity.create.mockResolvedValue({ id: "activity-1" });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool(
      "record_capsule_evidence",
      {
        capsuleId: "WC-EVIDENCE",
        kind: "test",
        summary: "Focused MCP lease-renewal test passed.",
        command: "pnpm --filter web exec vitest run lib/mcp-tools-work-capsules.test.ts",
      },
      "user-1",
      { agentId: "codex" },
    );

    expect(result.success).toBe(true);
    expect(mockPrisma.workCapsuleActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "evidence-recorded", recordedByAgentId: "codex" }),
    }));
    expect(mockPrisma.workCapsule.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { capsuleId: "WC-EVIDENCE" },
      data: expect.objectContaining({
        leaseHolderPrincipalId: "principal-agent",
        leaseExpiresAt: expect.any(Date),
      }),
    }));
    expect(mockPrisma.workCapsuleActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "lease-renewed", recordedByAgentId: "codex" }),
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

  it("plan_capsule_worktree persists the planned workspace", async () => {
    mockPrisma.workCapsule.findUnique.mockResolvedValue({
      id: "row-1",
      capsuleId: "WC-PLANMCP",
      title: "Phase 2 MCP plan",
      status: "draft",
      baseBranch: null,
      headBranch: null,
      worktreePath: null,
    });
    mockPrisma.workCapsule.findFirst.mockResolvedValue(null);
    mockPrisma.workCapsule.update.mockResolvedValue({
      id: "row-1",
      capsuleId: "WC-PLANMCP",
      title: "Phase 2 MCP plan",
      status: "ready",
      baseBranch: "main",
      headBranch: "feat/phase-2-mcp-plan",
      worktreePath: "D:\\DPF-phase-2-mcp-plan",
      branchTaxonomy: "feat",
    });
    mockPrisma.workCapsuleActivity.create.mockResolvedValue({ id: "activity-1" });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool(
      "plan_capsule_worktree",
      { capsuleId: "WC-PLANMCP", taxonomy: "feat" },
      "user-1",
      {},
    );

    expect(result.success).toBe(true);
    expect(result.entityId).toBe("WC-PLANMCP");
    expect(mockPrisma.workCapsule.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { capsuleId: "WC-PLANMCP" },
      data: expect.objectContaining({
        branchTaxonomy: "feat",
        headBranch: "feat/phase-2-mcp-plan",
        worktreePath: expect.stringContaining("phase-2-mcp-plan"),
      }),
    }));
    expect(mockPrisma.workCapsuleActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "workspace-planned" }),
    }));
  });

  it("plan_capsule_worktree rejects an unknown taxonomy", async () => {
    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool(
      "plan_capsule_worktree",
      { capsuleId: "WC-PLANMCP", taxonomy: "wat" },
      "user-1",
      {},
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid_taxonomy");
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
    }, "user-1", { agentId: "codex" });

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
    // write tool — must auto-renew the lease after the scope write
    expect(mockPrisma.workCapsule.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { capsuleId: "WC-SCOPE" },
      data: expect.objectContaining({
        leaseHolderPrincipalId: "principal-agent",
        leaseExpiresAt: expect.any(Date),
      }),
    }));
    expect(mockPrisma.workCapsuleActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "lease-renewed", recordedByAgentId: "codex" }),
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
    }, "user-1", { agentId: "codex" });

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
    // write tool — must auto-renew the lease after the status write
    expect(mockPrisma.workCapsule.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { capsuleId: "WC-STATUS" },
      data: expect.objectContaining({
        leaseHolderPrincipalId: "principal-agent",
        leaseExpiresAt: expect.any(Date),
      }),
    }));
    expect(mockPrisma.workCapsuleActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "lease-renewed", recordedByAgentId: "codex" }),
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
    }, "user-1", { agentId: "codex" });

    expect(result.success).toBe(true);
    expect(mockPrisma.workCapsule.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        scopeClaims: [expect.objectContaining({ kind: "route", value: "/build/work" })],
      }),
    }));
    // write tool — must auto-renew the lease after the scope release
    expect(mockPrisma.workCapsule.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { capsuleId: "WC-RELEASE" },
      data: expect.objectContaining({
        leaseHolderPrincipalId: "principal-agent",
        leaseExpiresAt: expect.any(Date),
      }),
    }));
    expect(mockPrisma.workCapsuleActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "lease-renewed", recordedByAgentId: "codex" }),
    }));
  });
});
