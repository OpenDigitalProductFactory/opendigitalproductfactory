// BI-5C4933EB: deploy_feature must take its diff and commit hashes from the
// build's own worktree when per-build isolation is on, not the shared root.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  featureBuildFindUnique: vi.fn(),
  featureBuildUpdate: vi.fn(),
  featureBuildCount: vi.fn(),
  platformDevConfigFindUnique: vi.fn(),
  businessProfileFindFirst: vi.fn(),
  extractAndCategorizeDiff: vi.fn(),
  listSandboxCommitsAheadOfBase: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    featureBuild: {
      findUnique: (...a: unknown[]) => m.featureBuildFindUnique(...a),
      update: (...a: unknown[]) => m.featureBuildUpdate(...a),
      count: (...a: unknown[]) => m.featureBuildCount(...a),
    },
    platformDevConfig: { findUnique: (...a: unknown[]) => m.platformDevConfigFindUnique(...a) },
    businessProfile: { findFirst: (...a: unknown[]) => m.businessProfileFindFirst(...a) },
  },
}));
vi.mock("@/lib/mcp/build-tool-helpers", () => ({
  resolveActiveBuildId: async () => "FB-1",
  extractBuildIdHint: () => null,
  logBuildActivity: vi.fn(),
}));
vi.mock("@/lib/build/sandbox/sandbox-admin", () => ({
  diagnoseSandboxReadiness: async () => ({ state: "healthy", canDeploy: true }),
}));
vi.mock("@/lib/build/sandbox/sandbox-readiness-gate", () => ({
  assertSandboxReadyForDeploy: () => ({ ok: true }),
}));
vi.mock("@/lib/platform-dev-policy", () => ({
  getPlatformDevPolicyState: () => "configured",
}));
vi.mock("@/lib/build/sandbox/sandbox-promotion", () => ({
  extractAndCategorizeDiff: (...a: unknown[]) => m.extractAndCategorizeDiff(...a),
  scanForDestructiveOps: () => [],
  isNowInWindow: () => true,
}));
vi.mock("@/lib/build/sandbox/build-branch", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getClientIdentity: async () => ({ clientBranch: "client/c-1" }),
}));
vi.mock("@/lib/build/sandbox/sandbox", () => ({
  listSandboxCommitsAheadOfBase: (...a: unknown[]) => m.listSandboxCommitsAheadOfBase(...a),
}));
// Advisory steps after the diff is persisted are non-fatal (caught + warned);
// empty mocks make them fail fast instead of loading their real modules.
vi.mock("@/lib/build/disposition", () => ({}));
vi.mock("@/lib/change-impact", () => ({}));
vi.mock("@/lib/approval-authority", () => ({}));

import { deployFeature } from "./build-ship-handlers";

describe("deployFeature reads the build's workdir", () => {
  const originalIsolation = process.env.DPF_BUILD_WORKTREE_ISOLATION;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    m.featureBuildFindUnique.mockResolvedValue({
      title: "t",
      sandboxId: "sb-1",
      buildBranch: "build/FB-1",
      phase: "ship",
      createdById: "u1",
      portfolioId: null,
      brief: null,
      designDoc: null,
    });
    m.platformDevConfigFindUnique.mockResolvedValue({ contributionMode: "private", gitRemoteUrl: "x" });
    m.businessProfileFindFirst.mockResolvedValue(null);
    m.extractAndCategorizeDiff.mockResolvedValue({
      fullDiff: "diff --git a/a.ts b/a.ts\n",
      migrationFiles: [],
      codeFiles: ["a.ts"],
      hasMigrations: false,
      schemaRegressions: [],
    });
    m.listSandboxCommitsAheadOfBase.mockResolvedValue(["abc123"]);
  });
  afterEach(() => {
    if (originalIsolation === undefined) delete process.env.DPF_BUILD_WORKTREE_ISOLATION;
    else process.env.DPF_BUILD_WORKTREE_ISOLATION = originalIsolation;
  });

  it("extracts the diff and commit hashes from the build worktree when isolation is on", async () => {
    delete process.env.DPF_BUILD_WORKTREE_ISOLATION;

    const result = await deployFeature({}, "u1");

    expect(result.success).toBe(true);
    expect(m.extractAndCategorizeDiff).toHaveBeenCalledWith("sb-1", {
      baseRef: "client/c-1",
      workspace: "/workspace/.builds/FB-1",
    });
    expect(m.listSandboxCommitsAheadOfBase).toHaveBeenCalledWith("sb-1", "client/c-1", "/workspace/.builds/FB-1");
  });

  it("uses /workspace when isolation is off", async () => {
    process.env.DPF_BUILD_WORKTREE_ISOLATION = "0";

    await deployFeature({}, "u1");

    expect(m.extractAndCategorizeDiff).toHaveBeenCalledWith("sb-1", {
      baseRef: "client/c-1",
      workspace: "/workspace",
    });
    expect(m.listSandboxCommitsAheadOfBase).toHaveBeenCalledWith("sb-1", "client/c-1", "/workspace");
  });
});
