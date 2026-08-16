import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  runtimeTarget: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  runtimeVerification: {
    create: vi.fn(),
  },
  buildActivity: {
    create: vi.fn(),
  },
  workroom: {
    findUnique: vi.fn(),
  },
  featureBuild: {
    findUnique: vi.fn(),
  },
  gitPromotionCandidate: {
    findUnique: vi.fn(),
  },
  workroomActivity: {
    create: vi.fn(),
  },
  $transaction: vi.fn(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma)),
};

vi.mock("@dpf/db", () => ({
  DISCOVERY_TRIAGE_AGENT_ID: "AGT-DISCOVERY",
  prisma: mockPrisma,
}));

vi.mock("@/lib/identity/principal-linking", () => ({
  ensureAgentPrincipalIdentity: vi.fn(async () => ({ id: "principal-agent" })),
  syncUserPrincipal: vi.fn(async () => ({ id: "principal-user" })),
}));

function resetMocks() {
  vi.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma));
}

describe("runtime coordination MCP tools", () => {
  beforeEach(() => resetMocks());

  it("register_runtime_target is exposed with runtime enum validation", async () => {
    const { PLATFORM_TOOLS } = await import("./mcp-tools");
    const tool = PLATFORM_TOOLS.find((candidate) => candidate.name === "register_runtime_target");
    const schema = tool?.inputSchema as { properties?: Record<string, { enum?: string[] }> } | undefined;

    expect(tool).toBeDefined();
    expect(tool?.requiredCapability).toBe("manage_backlog");
    expect(schema?.properties?.kind).toMatchObject({
      enum: ["root-portal", "dev-portal", "build-sandbox", "git-promotion-sandbox", "external-preview", "ad-hoc-debug"],
    });
  });

  it("register_runtime_target persists a target and returns whether it can satisfy final acceptance", async () => {
    mockPrisma.runtimeTarget.findUnique.mockResolvedValueOnce(null);
    mockPrisma.runtimeTarget.create.mockResolvedValueOnce({
      id: "target-row-1",
      targetId: "RT-ROOT-PORTAL",
      kind: "root-portal",
      status: "running",
    });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool("register_runtime_target", {
      targetId: "RT-ROOT-PORTAL",
      kind: "root-portal",
      status: "running",
      acceptanceRoleOverride: "debug-only",
      serviceName: "portal",
      containerName: "dpf-portal-1",
      hostUrl: "http://localhost:3000",
      port: 3000,
    }, "user-1", { agentId: "codex" });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      acceptanceRole: "debug-only",
      canSatisfyFinalAcceptance: false,
    });
    expect(mockPrisma.runtimeTarget.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ targetId: "RT-ROOT-PORTAL", kind: "root-portal" }),
    }));
  });

  it("resolves semantic capsule and target ids for external agent calls", async () => {
    mockPrisma.runtimeTarget.findUnique.mockResolvedValueOnce({
      id: "target-row-1",
      targetId: "RT-ROOT-PORTAL",
    });
    mockPrisma.workroom.findUnique.mockResolvedValueOnce({
      id: "capsule-row-1",
      capsuleId: "WC-RUNTIME",
    });
    mockPrisma.buildActivity.create.mockResolvedValueOnce({
      id: "build-activity-1",
    });
    mockPrisma.runtimeVerification.create.mockResolvedValueOnce({
      id: "verification-row-1",
      verificationId: "RV-RUNTIME-1",
      status: "passed",
    });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool("record_runtime_verification", {
      verificationId: "RV-RUNTIME-1",
      kind: "production-build",
      status: "passed",
      targetId: "RT-ROOT-PORTAL",
      capsuleId: "WC-RUNTIME",
      buildId: "FB-1",
      command: "pnpm --filter web build",
    }, "user-1", { agentId: "codex" });

    expect(result.success).toBe(true);
    expect(mockPrisma.runtimeVerification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        runtimeTargetId: "target-row-1",
        workCapsuleId: "capsule-row-1",
        buildActivityId: "build-activity-1",
      }),
    }));
    expect(mockPrisma.featureBuild.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.buildActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        buildId: "FB-1",
        tool: "runtime_verification:production-build",
      }),
    }));
  });

  it("record_runtime_verification rejects multiple primary attach points", async () => {
    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool("record_runtime_verification", {
      verificationId: "RV-BAD",
      kind: "ux",
      status: "passed",
      runtimeTargetId: "target-row-1",
      featureBuildId: "feature-build-row-1",
    }, "user-1", { agentId: "codex" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid_input");
    expect(result.message).toContain("exactly one primary attach point");
  });

  it("heartbeat_runtime_target returns a tool error instead of throwing on missing targets", async () => {
    mockPrisma.runtimeTarget.update.mockRejectedValueOnce(new Error("RuntimeTarget not found"));

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool("heartbeat_runtime_target", {
      targetId: "RT-MISSING",
    }, "user-1", { agentId: "codex" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid_input");
    expect(result.message).toContain("RuntimeTarget not found");
  });
});
