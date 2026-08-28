import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  workroom: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  workroomActivity: {
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
    await expect(import("@/lib/mcp-tools")).resolves.toBeDefined();
  });

  it("list_workrooms returns capsule rows", async () => {
    mockPrisma.workroom.findMany.mockResolvedValue([
      {
        capsuleId: "WC-1",
        title: "Adopt work",
        status: "ready",
        source: "external-adoption",
        executorKind: "codex-desktop",
        updatedAt: new Date("2026-05-14T00:00:00.000Z"),
      },
    ]);

    const { executeTool } = await import("@/lib/mcp-tools");
    const result = await executeTool("list_workrooms", { status: "ready" }, "user-1");

    expect(result.success).toBe(true);
    expect(result.data?.capsules).toEqual([
      expect.objectContaining({ capsuleId: "WC-1", status: "ready" }),
    ]);
    // read tool — must never touch lease fields
    expect(mockPrisma.workroom.update).not.toHaveBeenCalled();
    expect(mockPrisma.workroomActivity.create).not.toHaveBeenCalled();
  });

  it("list_workrooms filters by decision scope and portfolio role", async () => {
    mockPrisma.workroom.findMany.mockResolvedValue([
      {
        capsuleId: "WC-WWWD",
        title: "Customer onboarding",
        status: "working",
        source: "manual",
        executorKind: "codex-desktop",
        decisionScope: "wwwd",
        portfolioRole: "productsAndServicesSold",
        updatedAt: new Date("2026-05-14T00:00:00.000Z"),
      },
    ]);

    const { executeTool } = await import("@/lib/mcp-tools");
    const result = await executeTool(
      "list_workrooms",
      { decisionScope: "wwwd", portfolioRole: "productsAndServicesSold" },
      "user-1",
    );

    expect(result.success).toBe(true);
    expect(mockPrisma.workroom.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        decisionScope: "wwwd",
        portfolioRole: "productsAndServicesSold",
      },
    }));
    expect(result.data?.capsules).toEqual([
      expect.objectContaining({
        capsuleId: "WC-WWWD",
        decisionScope: "wwwd",
        portfolioRole: "productsAndServicesSold",
      }),
    ]);
  });

  it("get_workroom does not renew leases for read-only hydration", async () => {
    mockPrisma.workroom.findUnique.mockResolvedValue({
      id: "row-1",
      capsuleId: "WC-READ",
      title: "Read only",
      activities: [],
    });

    const { executeTool } = await import("@/lib/mcp-tools");
    const result = await executeTool("get_workroom", { capsuleId: "WC-READ" }, "user-1", {
      agentId: "codex",
    });

    expect(result.success).toBe(true);
    expect(mockPrisma.workroom.update).not.toHaveBeenCalled();
    expect(mockPrisma.workroomActivity.create).not.toHaveBeenCalled();
  });

  it("create_workroom requires idempotencyKey", async () => {
    const { executeTool } = await import("@/lib/mcp-tools");
    const result = await executeTool(
      "create_workroom",
      { title: "No key", objective: "Missing key", source: "manual" },
      "user-1",
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("missing_idempotencyKey");
  });

  it("create_workroom accepts scope metadata without a backlog item", async () => {
    mockPrisma.workroom.findUnique.mockResolvedValue(null);
    mockPrisma.workroom.create.mockResolvedValue({ id: "row-1", capsuleId: "WC-SCOPECREATE" });
    mockPrisma.workroomActivity.create.mockResolvedValue({ id: "activity-1" });

    const { executeTool } = await import("@/lib/mcp-tools");
    const result = await executeTool(
      "create_workroom",
      {
        title: "Customer onboarding",
        objective: "Coordinate a customer onboarding work case.",
        source: "manual",
        idempotencyKey: "manual:customer-onboarding",
        decisionScope: "wwwd",
        portfolioRole: "productsAndServicesSold",
        servedPersona: "customer",
        activityKind: "delivery",
        outcomeAnchor: { kind: "work-case", id: "CASE-123" },
        servesPortfolioRoles: ["productsAndServicesSold", "manufactureAndDeliver"],
      },
      "user-1",
      { agentId: "codex" },
    );

    expect(result.success).toBe(true);
    expect(mockPrisma.workroom.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        backlogItemId: null,
        decisionScope: "wwwd",
        portfolioRole: "productsAndServicesSold",
        servedPersona: "customer",
        activityKind: "delivery",
        outcomeAnchor: { kind: "work-case", id: "CASE-123" },
        servesPortfolioRoles: ["productsAndServicesSold", "manufactureAndDeliver"],
      }),
    }));
  });

  it("create_workroom rejects invalid scope metadata", async () => {
    const { executeTool } = await import("@/lib/mcp-tools");
    const result = await executeTool(
      "create_workroom",
      {
        title: "Bad scope",
        objective: "Should not persist.",
        source: "manual",
        idempotencyKey: "manual:bad-scope",
        portfolioRole: "sales",
      },
      "user-1",
      { agentId: "codex" },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid_scope");
    expect(mockPrisma.workroom.create).not.toHaveBeenCalled();
  });

  it("heartbeat_workroom renews a lease", async () => {
    mockPrisma.workroom.update.mockResolvedValue({ id: "row-1", capsuleId: "WC-1" });
    mockPrisma.workroomActivity.create.mockResolvedValue({ id: "activity-1" });

    const { executeTool } = await import("@/lib/mcp-tools");
    const result = await executeTool("heartbeat_workroom", { capsuleId: "WC-1" }, "user-1", {
      agentId: "codex",
    });

    expect(result.success).toBe(true);
    expect(mockPrisma.workroom.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.workroom.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { capsuleId: "WC-1" },
    }));
    expect(mockPrisma.workroomActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "lease-renewed", recordedByAgentId: "codex" }),
    }));
  });

  it("record_workroom_evidence auto-renews the lease after a capsule-scoped write", async () => {
    mockPrisma.workroom.findUnique.mockResolvedValue({ id: "row-1", capsuleId: "WC-EVIDENCE" });
    mockPrisma.workroom.update.mockResolvedValue({ id: "row-1", capsuleId: "WC-EVIDENCE" });
    mockPrisma.workroomActivity.create.mockResolvedValue({ id: "activity-1" });

    const { executeTool } = await import("@/lib/mcp-tools");
    const result = await executeTool(
      "record_workroom_evidence",
      {
        capsuleId: "WC-EVIDENCE",
        kind: "test",
        summary: "Focused MCP lease-renewal test passed.",
        command: "pnpm --filter web exec vitest run lib/mcp-tools-work-capsules.test.ts",
        targetId: "RT-SANDBOX-1",
        runtimeTargetId: "target-row-1",
        verificationId: "RV-UX-1",
      },
      "user-1",
      { agentId: "codex" },
    );

    expect(result.success).toBe(true);
    expect(mockPrisma.workroomActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "evidence-recorded", recordedByAgentId: "codex" }),
    }));
    expect(mockPrisma.workroomActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        payload: expect.objectContaining({
          targetId: "RT-SANDBOX-1",
          runtimeTargetId: "target-row-1",
          verificationId: "RV-UX-1",
        }),
      }),
    }));
    expect(mockPrisma.workroom.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { capsuleId: "WC-EVIDENCE" },
      data: expect.objectContaining({
        leaseHolderPrincipalId: "principal-agent",
        leaseExpiresAt: expect.any(Date),
      }),
    }));
    expect(mockPrisma.workroomActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "lease-renewed", recordedByAgentId: "codex" }),
    }));
  });

  it("adopt_worktree creates a capsule for a branch/worktree pair", async () => {
    mockPrisma.workroom.findFirst.mockResolvedValue(null);
    mockPrisma.workroom.create.mockResolvedValue({ id: "row-1", capsuleId: "WC-ADOPT" });
    mockPrisma.workroomActivity.create.mockResolvedValue({ id: "activity-1" });

    const { executeTool } = await import("@/lib/mcp-tools");
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

  it("adopt_worktree records sessionRef as the workroom executorRef", async () => {
    // Without this the guard can prove a live claim COVERS the branch but not
    // that it is THIS session's, which is weaker than AGENTS.md 12 states.
    // claim_backlog_item_for_work already required sessionRef for exactly this
    // reason; adopt_worktree simply omitted it, so every worktree adopted
    // through it stored executorRef: null.
    mockPrisma.workroom.findFirst.mockResolvedValue(null);
    mockPrisma.workroom.create.mockResolvedValue({ id: "row-1", capsuleId: "WC-SESSION" });
    mockPrisma.workroomActivity.create.mockResolvedValue({ id: "activity-1" });

    const { executeTool } = await import("@/lib/mcp-tools");
    const result = await executeTool("adopt_worktree", {
      title: "Adopt with session identity",
      objective: "Record which session holds the claim.",
      repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      headBranch: "fix/session-identity",
      worktreePath: "D:/DPF-worktrees/session-identity",
      executorKind: "claude-desktop",
      sessionRef: "session-abc123",
    }, "user-1", { agentId: "claude" });

    expect(result.success).toBe(true);
    expect(mockPrisma.workroom.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ executorRef: "session-abc123" }) }),
    );
  });

  it("adopt_worktree without sessionRef still succeeds, storing a null executorRef", async () => {
    // Optional, not required: making it required would break every existing
    // caller and refuse claims outright, which is worse than an unattributed
    // claim. The gap is recorded rather than forced.
    mockPrisma.workroom.findFirst.mockResolvedValue(null);
    mockPrisma.workroom.create.mockResolvedValue({ id: "row-1", capsuleId: "WC-NOSESSION" });
    mockPrisma.workroomActivity.create.mockResolvedValue({ id: "activity-1" });

    const { executeTool } = await import("@/lib/mcp-tools");
    const result = await executeTool("adopt_worktree", {
      title: "Adopt without session identity",
      objective: "Legacy caller path.",
      repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      headBranch: "fix/no-session",
      worktreePath: "D:/DPF-worktrees/no-session",
    }, "user-1", { agentId: "claude" });

    expect(result.success).toBe(true);
    expect(mockPrisma.workroom.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ executorRef: null }) }),
    );
  });

  it("adopt_worktree persists scope metadata", async () => {
    mockPrisma.workroom.findFirst.mockResolvedValue(null);
    mockPrisma.workroom.create.mockResolvedValue({ id: "row-1", capsuleId: "WC-ADOPTSCOPE" });
    mockPrisma.workroomActivity.create.mockResolvedValue({ id: "activity-1" });

    const { executeTool } = await import("@/lib/mcp-tools");
    const result = await executeTool("adopt_worktree", {
      title: "Adopt scoped branch",
      objective: "Implement Work Capsule scope metadata.",
      repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      headBranch: "feat/layer-scoped-work-capsules",
      worktreePath: "D:/DPF-worktrees/layer-scoped-work-capsules",
      executorKind: "codex-desktop",
      decisionScope: "wwmd",
      portfolioRole: "manufactureAndDeliver",
      servedPersona: "platform-team",
      activityKind: "improvement",
      outcomeAnchor: { kind: "backlog-item", id: "BI-5F70A7DA" },
    }, "user-1", { agentId: "codex" });

    expect(result.success).toBe(true);
    expect(mockPrisma.workroom.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        decisionScope: "wwmd",
        portfolioRole: "manufactureAndDeliver",
        servedPersona: "platform-team",
        activityKind: "improvement",
        outcomeAnchor: { kind: "backlog-item", id: "BI-5F70A7DA" },
      }),
    }));
  });

  it("adopt_worktree returns an actionable branch conflict instead of a raw tool failure", async () => {
    mockPrisma.workroom.findFirst.mockResolvedValue({
      id: "row-existing",
      capsuleId: "WC-EXISTING",
      status: "abandoned",
      backlogItemId: "BI-OTHER",
      headBranch: "fix/recovery",
    });

    const { executeTool } = await import("@/lib/mcp-tools");
    const result = await executeTool("adopt_worktree", {
      title: "Adopt recovery branch",
      objective: "Recover useful work.",
      repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      headBranch: "fix/recovery",
      worktreePath: "D:/DPF-recovery",
      executorKind: "codex-desktop",
    }, "user-1", { agentId: "codex" });

    expect(result).toMatchObject({
      success: false,
      error: "branch_occupied",
      data: {
        capsuleId: "WC-EXISTING",
        status: "abandoned",
        backlogItemId: "BI-OTHER",
      },
    });
    expect(result.message).toMatch(/Resume that capsule.*or use a different branch/i);
    expect(mockPrisma.workroom.create).not.toHaveBeenCalled();
    expect(mockPrisma.workroom.update).not.toHaveBeenCalled();
  });

  it("plan_workroom_worktree persists the planned workspace", async () => {
    mockPrisma.workroom.findUnique.mockResolvedValue({
      id: "row-1",
      capsuleId: "WC-PLANMCP",
      title: "Phase 2 MCP plan",
      status: "draft",
      baseBranch: null,
      headBranch: null,
      worktreePath: null,
    });
    mockPrisma.workroom.findFirst.mockResolvedValue(null);
    mockPrisma.workroom.update.mockResolvedValue({
      id: "row-1",
      capsuleId: "WC-PLANMCP",
      title: "Phase 2 MCP plan",
      status: "ready",
      baseBranch: "main",
      headBranch: "feat/phase-2-mcp-plan",
      worktreePath: "D:\\DPF-phase-2-mcp-plan",
      branchTaxonomy: "feat",
    });
    mockPrisma.workroomActivity.create.mockResolvedValue({ id: "activity-1" });

    const { executeTool } = await import("@/lib/mcp-tools");
    const result = await executeTool(
      "plan_workroom_worktree",
      { capsuleId: "WC-PLANMCP", taxonomy: "feat" },
      "user-1",
      {},
    );

    expect(result.success).toBe(true);
    expect(result.entityId).toBe("WC-PLANMCP");
    expect(mockPrisma.workroom.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { capsuleId: "WC-PLANMCP" },
      data: expect.objectContaining({
        branchTaxonomy: "feat",
        headBranch: "feat/phase-2-mcp-plan",
        worktreePath: expect.stringContaining("phase-2-mcp-plan"),
      }),
    }));
    expect(mockPrisma.workroomActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "workspace-planned" }),
    }));
  });

  it("plan_workroom_worktree rejects an unknown taxonomy", async () => {
    const { executeTool } = await import("@/lib/mcp-tools");
    const result = await executeTool(
      "plan_workroom_worktree",
      { capsuleId: "WC-PLANMCP", taxonomy: "wat" },
      "user-1",
      {},
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid_taxonomy");
  });

  it("claim_workroom_scope stores typed scope claims", async () => {
    let capsule = {
      id: "row-1",
      capsuleId: "WC-SCOPE",
      scopeClaims: [],
    } as Record<string, unknown>;
    mockPrisma.workroom.findUnique.mockImplementation(async () => capsule);
    mockPrisma.workroom.update.mockImplementation(async ({ data }) => {
      capsule = { ...capsule, ...data };
      return capsule;
    });
    mockPrisma.workroomActivity.create.mockResolvedValue({ id: "activity-1" });

    const { executeTool } = await import("@/lib/mcp-tools");
    const result = await executeTool("claim_workroom_scope", {
      capsuleId: "WC-SCOPE",
      claims: [{ kind: "path", value: "apps/web/lib/work-capsules.ts", intent: "edit" }],
    }, "user-1", { agentId: "codex" });

    expect(result.success).toBe(true);
    expect(mockPrisma.workroom.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        scopeClaims: [expect.objectContaining({
          kind: "path",
          value: "apps/web/lib/work-capsules.ts",
          intent: "edit",
        })],
      }),
    }));
    // write tool — must auto-renew the lease after the scope write
    expect(mockPrisma.workroom.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { capsuleId: "WC-SCOPE" },
      data: expect.objectContaining({
        leaseHolderPrincipalId: "principal-agent",
        leaseExpiresAt: expect.any(Date),
      }),
    }));
    expect(mockPrisma.workroomActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "lease-renewed", recordedByAgentId: "codex" }),
    }));
    expect(result.data).toEqual(expect.objectContaining({
      changeImpactContract: expect.objectContaining({
        status: "resolved",
        paths: ["apps/web/lib/work-capsules.ts"],
      }),
    }));
    expect(mockPrisma.workroom.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        verificationState: expect.objectContaining({
          changeImpactContract: expect.objectContaining({ status: "resolved" }),
        }),
      }),
    }));
    expect(mockPrisma.workroomActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "change-impact-planned" }),
    }));
  });

  it("update_workroom_status writes a status override", async () => {
    mockPrisma.workroom.findUnique.mockResolvedValue({
      id: "row-1",
      capsuleId: "WC-STATUS",
      workspaceState: { note: "preserve me" },
    });
    mockPrisma.workroom.update.mockResolvedValue({ id: "row-1", capsuleId: "WC-STATUS", status: "blocked" });
    mockPrisma.workroomActivity.create.mockResolvedValue({ id: "activity-1" });

    const { executeTool } = await import("@/lib/mcp-tools");
    const result = await executeTool("update_workroom_status", {
      capsuleId: "WC-STATUS",
      status: "blocked",
      reason: "Provider credential blocked.",
    }, "user-1", { agentId: "codex" });

    expect(result.success).toBe(true);
    expect(mockPrisma.workroom.update).toHaveBeenCalledWith(expect.objectContaining({
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
    expect(mockPrisma.workroom.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { capsuleId: "WC-STATUS" },
      data: expect.objectContaining({
        leaseHolderPrincipalId: "principal-agent",
        leaseExpiresAt: expect.any(Date),
      }),
    }));
    expect(mockPrisma.workroomActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "lease-renewed", recordedByAgentId: "codex" }),
    }));
  });

  it("release_workroom_scope removes matching scope claims", async () => {
    mockPrisma.workroom.findUnique.mockResolvedValue({
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
    mockPrisma.workroom.update.mockResolvedValue({ id: "row-1", capsuleId: "WC-RELEASE" });
    mockPrisma.workroomActivity.create.mockResolvedValue({ id: "activity-1" });

    const { executeTool } = await import("@/lib/mcp-tools");
    const result = await executeTool("release_workroom_scope", {
      capsuleId: "WC-RELEASE",
      claims: [{ kind: "path", value: "apps/web/lib/work-capsules.ts" }],
    }, "user-1", { agentId: "codex" });

    expect(result.success).toBe(true);
    expect(mockPrisma.workroom.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        scopeClaims: [expect.objectContaining({ kind: "route", value: "/build/work" })],
      }),
    }));
    // write tool — must auto-renew the lease after the scope release
    expect(mockPrisma.workroom.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { capsuleId: "WC-RELEASE" },
      data: expect.objectContaining({
        leaseHolderPrincipalId: "principal-agent",
        leaseExpiresAt: expect.any(Date),
      }),
    }));
    expect(mockPrisma.workroomActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "lease-renewed", recordedByAgentId: "codex" }),
    }));
  });
});
