import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  featureBuild: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
};

const mockDiagnoseSandboxReadiness = vi.hoisted(() => vi.fn());
const mockRecoverSandbox = vi.hoisted(() => vi.fn());

vi.mock("@dpf/db", () => ({
  DISCOVERY_TRIAGE_AGENT_ID: "AGT-DISCOVERY",
  prisma: mockPrisma,
}));

vi.mock("@/lib/tak/prompt-loader", () => ({
  loadPrompt: vi.fn(async (_category: string, _slug: string, fallback: string) => fallback),
}));

vi.mock("@/lib/integrate/sandbox/sandbox-admin", () => ({
  diagnoseSandboxReadiness: mockDiagnoseSandboxReadiness,
}));

vi.mock("@/lib/integrate/sandbox/sandbox-recovery", () => ({
  recoverSandbox: mockRecoverSandbox,
}));

const FORBIDDEN_SANDBOX_HANDOFF_PATTERNS = [
  "user must run",
  "user needs to run",
  "tell the user to run",
  "docker compose up -d sandbox",
] as const;

describe("sandbox admin MCP and coworker messaging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes diagnose_sandbox as a read-only build/review/ship tool", async () => {
    const { PLATFORM_TOOLS } = await import("./mcp-tools");

    const tool = PLATFORM_TOOLS.find((candidate) => candidate.name === "diagnose_sandbox");

    expect(tool).toBeDefined();
    expect(tool?.requiredCapability).toBe("view_platform");
    expect(tool?.sideEffect).toBe(false);
    expect(tool?.buildPhases).toEqual(["build", "review", "ship"]);
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });
  });

  it("exposes recover_sandbox as a governed side-effect tool", async () => {
    const { PLATFORM_TOOLS } = await import("./mcp-tools");

    const tool = PLATFORM_TOOLS.find((candidate) => candidate.name === "recover_sandbox");
    const schema = tool?.inputSchema as { properties?: Record<string, { enum?: string[] }> } | undefined;

    expect(tool).toBeDefined();
    expect(tool?.requiredCapability).toBe("view_platform");
    expect(tool?.sideEffect).toBe(true);
    expect(tool?.buildPhases).toEqual(["build", "review", "ship"]);
    expect(schema?.properties?.action.enum).toContain("reset_build_phase");
    expect(schema?.properties?.action.enum).toContain("release_stale_slot");
  });

  it("does not tell the coworker to hand Docker commands back to the user", async () => {
    const [{ PLATFORM_TOOLS }, { getBuildPhasePrompt }] = await Promise.all([
      import("./mcp-tools"),
      import("./integrate/build-agent-prompts"),
    ]);
    const sandboxToolText = PLATFORM_TOOLS
      .filter((tool) => tool.name.includes("sandbox") || tool.description.toLowerCase().includes("sandbox"))
      .map((tool) => `${tool.name}: ${tool.description}`)
      .join("\n");
    const buildPrompt = await getBuildPhasePrompt("build");
    const text = `${sandboxToolText}\n${buildPrompt}`.toLowerCase();

    for (const forbidden of FORBIDDEN_SANDBOX_HANDOFF_PATTERNS) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("executeTool routes diagnose_sandbox to the readiness diagnosis service", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValueOnce({
      buildId: "FB-SANDBOX-1",
      createdById: "user-1",
    });
    mockDiagnoseSandboxReadiness.mockResolvedValueOnce({
      buildId: "FB-SANDBOX-1",
      state: "not_found",
      canDeploy: false,
      canContribute: false,
      summary: "The registered sandbox container no longer exists.",
      checks: [],
      recommendedActions: [{ action: "restart", label: "Restart sandbox", requiresApproval: true }],
      inspectedAt: "2026-05-22T12:00:00.000Z",
      runtimeTargetId: null,
      containerId: null,
      branchName: "build/FB-SANDBOX-1",
    });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool("diagnose_sandbox", {
      buildId: "FB-SANDBOX-1",
      expectedWorkspaceRoot: "D:\\DPF\\.worktrees\\FB-SANDBOX-1",
    }, "user-1", { agentId: "AGT-ORCH-300" });

    expect(result.success).toBe(true);
    expect(result.message).toContain("Sandbox readiness: not_found");
    expect(result.data).toMatchObject({
      buildId: "FB-SANDBOX-1",
      state: "not_found",
    });
    expect(mockDiagnoseSandboxReadiness).toHaveBeenCalledWith(expect.objectContaining({
      buildId: "FB-SANDBOX-1",
      expectedWorkspaceRoot: "D:\\DPF\\.worktrees\\FB-SANDBOX-1",
    }));
  });

  it("executeTool validates and routes recover_sandbox to the recovery service", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValueOnce({
      buildId: "FB-SANDBOX-1",
      createdById: "user-1",
    });
    mockRecoverSandbox.mockResolvedValueOnce({
      success: true,
      message: "Build phase reset recorded; no phase was auto-dispatched.",
      snapshot: {
        buildId: "FB-SANDBOX-1",
        state: "not_found",
        canDeploy: false,
        canContribute: false,
        summary: "phase reset",
        checks: [],
        recommendedActions: [],
        inspectedAt: "2026-05-22T12:00:00.000Z",
      },
    });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool("recover_sandbox", {
      buildId: "FB-SANDBOX-1",
      action: "reset_build_phase",
      confirmation: { acknowledgeReset: true, reason: "stuck mid phase" },
    }, "user-1", { agentId: "AGT-ORCH-300" });

    expect(result.success).toBe(true);
    expect(result.entityId).toBe("FB-SANDBOX-1");
    expect(mockRecoverSandbox).toHaveBeenCalledWith(expect.objectContaining({
      buildId: "FB-SANDBOX-1",
      action: "reset_build_phase",
      confirmation: { acknowledgeReset: true, reason: "stuck mid phase" },
    }));
  });

  it("rejects invalid recover_sandbox actions before the recovery service runs", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValueOnce({
      buildId: "FB-SANDBOX-1",
      createdById: "user-1",
    });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool("recover_sandbox", {
      buildId: "FB-SANDBOX-1",
      action: "docker_shell",
    }, "user-1", { agentId: "AGT-ORCH-300" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid_action");
    expect(mockRecoverSandbox).not.toHaveBeenCalled();
  });
});
