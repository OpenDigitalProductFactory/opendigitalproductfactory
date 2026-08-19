import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    featureBuild: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    featurePack: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    improvementProposal: {
      updateMany: vi.fn(),
    },
    buildActivity: {
      create: vi.fn().mockResolvedValue({ id: "activity-1" }),
    },
    platformDevConfig: {
      findUnique: vi.fn(),
    },
  },
}));

const mockDiagnoseSandboxReadiness = vi.hoisted(() => vi.fn());
const mockRecoverSandbox = vi.hoisted(() => vi.fn());
const mockResolveHiveToken = vi.hoisted(() => vi.fn());
const mockCreateBranchAndPR = vi.hoisted(() => vi.fn());

vi.mock("@dpf/db", () => ({
  DISCOVERY_TRIAGE_AGENT_ID: "AGT-DISCOVERY",
  prisma: mockPrisma,
}));

vi.mock("@/lib/tak/prompt-loader", () => ({
  loadPrompt: vi.fn(async (_category: string, _slug: string, fallback: string) => fallback),
}));

vi.mock("@/lib/build/sandbox/sandbox-admin", () => ({
  diagnoseSandboxReadiness: mockDiagnoseSandboxReadiness,
}));

vi.mock("@/lib/build/sandbox/sandbox-recovery", () => ({
  recoverSandbox: mockRecoverSandbox,
}));

vi.mock("@/lib/build/identity-privacy", () => ({
  resolveHiveToken: mockResolveHiveToken,
  getPlatformIdentity: vi.fn(async () => ({
    authorName: "dpf-agent-a1b2c3d4",
    authorEmail: "agent-a1b2c3d4@hive.dpf",
    clientId: "a1b2c3d4-0000-0000-0000-000000000000",
    shortId: "a1b2c3d4",
    dcoSignoff: "Signed-off-by: dpf-agent-a1b2c3d4 <agent-a1b2c3d4@hive.dpf>",
  })),
  generatePrivateBranchName: vi.fn(() => "dpf/a1b2c3d4/sandbox-fix"),
  generateAnonymousCommitMessage: vi.fn(() => "feat: Sandbox fix\n\nSigned-off-by: dpf-agent-a1b2c3d4 <agent-a1b2c3d4@hive.dpf>"),
}));

vi.mock("@/lib/build/github-api-commit", () => ({
  createBranchAndPR: mockCreateBranchAndPR,
}));

vi.mock("@/lib/platform-dev-policy", () => ({
  getPlatformDevPolicyState: vi.fn(() => "contribution_ready"),
}));

import { executeTool, PLATFORM_TOOLS } from "@/lib/mcp-tools";
import { getBuildPhasePrompt } from "@/lib/build/build-agent-prompts";

const FORBIDDEN_SANDBOX_HANDOFF_PATTERNS = [
  "user must run",
  "user needs to run",
  "tell the user to run",
  "docker compose up -d sandbox",
] as const;

describe("sandbox admin MCP and coworker messaging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.buildActivity.create.mockResolvedValue({ id: "activity-1" });
    mockPrisma.featurePack.findFirst.mockResolvedValue(null);
    mockPrisma.featurePack.create.mockResolvedValue({ packId: "FP-TEST" });
    mockPrisma.featurePack.update.mockResolvedValue({ packId: "FP-TEST" });
    mockPrisma.improvementProposal.updateMany.mockResolvedValue({ count: 0 });
    mockCreateBranchAndPR.mockResolvedValue({
      branchName: "dpf/a1b2c3d4/sandbox-fix",
      commitSha: "commit-sha",
      prUrl: null,
      prNumber: null,
    });
  });

  it("exposes diagnose_sandbox as a read-only build/review/ship tool", async () => {

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

    const result = await executeTool("recover_sandbox", {
      buildId: "FB-SANDBOX-1",
      action: "docker_shell",
    }, "user-1", { agentId: "AGT-ORCH-300" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid_action");
    expect(mockRecoverSandbox).not.toHaveBeenCalled();
  });

  it("blocks deploy_feature before diff extraction when sandbox readiness is red", async () => {
    mockPrisma.featureBuild.findUnique
      .mockResolvedValueOnce({
        buildId: "FB-SANDBOX-1",
        createdById: "user-1",
      })
      .mockResolvedValueOnce({
        sandboxId: "dpf-sandbox-1",
        buildBranch: "build/FB-SANDBOX-1",
        phase: "ship",
        createdById: "user-1",
      });
    mockDiagnoseSandboxReadiness.mockResolvedValueOnce({
      buildId: "FB-SANDBOX-1",
      state: "detached",
      canDeploy: false,
      canContribute: false,
      summary: "The sandbox is detached from this build.",
      checks: [],
      recommendedActions: [],
      inspectedAt: "2026-05-22T12:00:00.000Z",
    });

    const result = await executeTool("deploy_feature", {
      buildId: "FB-SANDBOX-1",
    }, "user-1", { agentId: "AGT-ORCH-400" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Sandbox readiness blocked deploy_feature.");
    expect(result.data).toMatchObject({ state: "detached" });
    expect(mockPrisma.buildActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        buildId: "FB-SANDBOX-1",
        tool: "deploy_feature",
        summary: expect.stringContaining("not ready"),
      }),
    }));
  });

  it("blocks contribute_to_hive before FeaturePack creation when sandbox readiness is red", async () => {
    mockPrisma.featureBuild.findUnique
      .mockResolvedValueOnce({
        buildId: "FB-SANDBOX-1",
        createdById: "user-1",
      })
      .mockResolvedValueOnce({
        id: "feature-build-row-1",
        title: "Sandbox fix",
        brief: {},
        diffPatch: "diff --git a/a.ts b/a.ts\n",
        diffSummary: "summary",
        sandboxId: "dpf-sandbox-1",
        portfolioId: null,
        createdById: "user-1",
        createdBy: { email: "admin@dpf.local" },
      });
    mockPrisma.platformDevConfig.findUnique.mockResolvedValueOnce({
      contributionMode: "contribute_all",
      upstreamRemoteUrl: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git",
      dcoAcceptedAt: new Date("2026-05-22T12:00:00.000Z"),
      gitRemoteUrl: null,
    });
    mockResolveHiveToken.mockResolvedValueOnce("ghp_test");
    mockDiagnoseSandboxReadiness.mockResolvedValueOnce({
      buildId: "FB-SANDBOX-1",
      state: "stale_source",
      canDeploy: false,
      canContribute: false,
      summary: "The sandbox source is stale.",
      checks: [],
      recommendedActions: [],
      inspectedAt: "2026-05-22T12:00:00.000Z",
    });

    const result = await executeTool("contribute_to_hive", {
      buildId: "FB-SANDBOX-1",
    }, "user-1", { agentId: "AGT-ORCH-500" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Sandbox readiness blocked contribution.");
    expect(result.data).toMatchObject({ state: "stale_source" });
    expect(mockPrisma.buildActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        buildId: "FB-SANDBOX-1",
        tool: "contribute_to_hive",
        summary: expect.stringContaining("upstream contribution"),
      }),
    }));
  });

  it("blocks contribute_to_hive when hive contributions are paused (master pause overrides contributionMode)", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValueOnce({
      buildId: "FB-PAUSE-1",
      createdById: "user-1",
    });
    mockPrisma.platformDevConfig.findUnique.mockResolvedValueOnce({
      contributionMode: "contribute_all",
      upstreamRemoteUrl: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git",
      dcoAcceptedAt: new Date("2026-05-22T12:00:00.000Z"),
      gitRemoteUrl: null,
      hiveContributionsPaused: true,
    });

    const result = await executeTool("contribute_to_hive", {
      buildId: "FB-PAUSE-1",
    }, "user-1", { agentId: "AGT-ORCH-PAUSE" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Hive contributions are paused.");
    // The master pause must short-circuit before any PR prerequisite or PR machinery.
    expect(mockResolveHiveToken).not.toHaveBeenCalled();
    expect(mockDiagnoseSandboxReadiness).not.toHaveBeenCalled();
    expect(mockCreateBranchAndPR).not.toHaveBeenCalled();
  });

  it("blocks create_portal_pr when the captured diff misses files promised by the build plan", async () => {
    mockPrisma.featureBuild.findUnique
      .mockResolvedValueOnce({
        buildId: "FB-PROMOTE-1",
        createdById: "user-1",
      })
      .mockResolvedValueOnce({
        id: "feature-build-row-1",
        title: "Ollama model management",
        diffPatch: "diff --git a/packages/db/prisma/schema.prisma b/packages/db/prisma/schema.prisma\n@@ -1 +1,2 @@\n+new\n",
        buildBranch: "build/FB-PROMOTE-1",
        gitCommitHashes: ["abc1234"],
        updatedAt: new Date("2026-05-22T12:00:00.000Z"),
        buildExecState: {
          sourceCurrency: {
            source: "sandbox-git",
            status: "ahead",
            recommendedAction: "allow",
            workspace: "/workspace",
            branch: "build/FB-PROMOTE-1",
            headSha: "head",
            headTreeSha: "tree-head",
            targetRef: "origin/main",
            targetSha: "target",
            targetTreeSha: "tree-target",
            mergeBaseSha: "target",
            aheadBy: 1,
            behindBy: 0,
            dirty: false,
            localSourceChangeCount: 1,
            checkedAt: "2026-05-22T12:00:00.000Z",
            reason: "Sandbox has local source commits.",
          },
        },
        verificationOut: { typecheckPassed: true, testsPassed: 1, testsFailed: 0 },
        acceptanceMet: [{ met: true }],
        phase: "ship",
        designDoc: null,
        buildPlan: "## File Structure\n- Create `apps/web/lib/inference/ollama-url.ts`: URL resolver\n",
        description: null,
        productVersions: [],
      });

    const result = await executeTool("create_portal_pr", {
      buildId: "FB-PROMOTE-1",
    }, "user-1", { agentId: "AGT-ORCH-600" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Sandbox promotion integrity blocked PR creation.");
    expect(result.message).toContain("missing files promised by the build plan");
    expect(mockCreateBranchAndPR).not.toHaveBeenCalled();
  });

  it("blocks contribute_to_hive before FeaturePack creation when persisted source-currency says pause", async () => {
    mockPrisma.featureBuild.findUnique
      .mockResolvedValueOnce({
        buildId: "FB-PROMOTE-2",
        createdById: "user-1",
      })
      .mockResolvedValueOnce({
        id: "feature-build-row-2",
        title: "Ollama model management",
        brief: {},
        diffPatch: "diff --git a/apps/web/lib/inference/ollama-url.ts b/apps/web/lib/inference/ollama-url.ts\n@@ -1 +1,2 @@\n+new\n",
        diffSummary: "summary",
        // Confirmed shareable so the test reaches the sandbox-promotion-integrity
        // check it targets (the disposition gate fires first otherwise).
        disposition: "shareable",
        dispositionSuggestionReason: null,
        sandboxId: "dpf-sandbox-2",
        portfolioId: null,
        createdById: "user-1",
        createdBy: { email: "admin@dpf.local" },
        buildBranch: "build/FB-PROMOTE-2",
        gitCommitHashes: ["abc1234"],
        updatedAt: new Date("2026-05-22T12:00:00.000Z"),
        buildPlan: "## File Structure\n- Create `apps/web/lib/inference/ollama-url.ts`: URL resolver\n",
        description: null,
        buildExecState: {
          sourceCurrency: {
            source: "sandbox-git",
            status: "diverged",
            recommendedAction: "pause",
            workspace: "/workspace",
            branch: "build/FB-PROMOTE-2",
            headSha: "head",
            headTreeSha: "tree-head",
            targetRef: "origin/main",
            targetSha: "target",
            targetTreeSha: "tree-target",
            mergeBaseSha: "base",
            aheadBy: 6,
            behindBy: 1,
            dirty: false,
            localSourceChangeCount: 6,
            checkedAt: "2026-05-22T12:00:00.000Z",
            reason: "Sandbox has local commits and is missing origin/main commits.",
          },
        },
      });
    mockPrisma.platformDevConfig.findUnique.mockResolvedValueOnce({
      contributionMode: "contribute_all",
      upstreamRemoteUrl: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git",
      dcoAcceptedAt: new Date("2026-05-22T12:00:00.000Z"),
      gitRemoteUrl: null,
    });
    mockResolveHiveToken.mockResolvedValueOnce("ghp_test");
    mockDiagnoseSandboxReadiness.mockResolvedValueOnce({
      buildId: "FB-PROMOTE-2",
      state: "healthy",
      canDeploy: true,
      canContribute: true,
      summary: "Sandbox is running, bound to the expected worktree, current, clean, and verified.",
      checks: [],
      recommendedActions: [],
      inspectedAt: "2026-05-22T12:00:00.000Z",
    });

    const result = await executeTool("contribute_to_hive", {
      buildId: "FB-PROMOTE-2",
    }, "user-1", { agentId: "AGT-ORCH-700" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Sandbox promotion integrity blocked contribution.");
    expect(result.message).toContain("source is not promotable");
    expect(mockPrisma.featurePack.findFirst).not.toHaveBeenCalled();
    expect(mockCreateBranchAndPR).not.toHaveBeenCalled();
  });
});
