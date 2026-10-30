import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  config: vi.fn(), build: vi.fn(), findPack: vi.fn(), createPack: vi.fn(), updatePack: vi.fn(),
  forge: vi.fn(), finalize: vi.fn().mockResolvedValue(undefined), reconcile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@dpf/db", () => ({ prisma: {
  platformDevConfig: { findUnique: mocks.config }, featureBuild: { findUnique: mocks.build },
  featurePack: { findFirst: mocks.findPack, create: mocks.createPack, update: mocks.updatePack },
} }));
vi.mock("@/lib/mcp/build-tool-helpers", () => ({ logBuildActivity: vi.fn(), extractBuildIdHint: vi.fn(), resolveActiveBuildId: vi.fn(async () => "FB-1") }));
vi.mock("@/lib/mcp/contribution-hive-delivery", () => ({ finalizeHiveContribution: mocks.finalize, reconcileHiveContributionDelivery: mocks.reconcile }));
vi.mock("@/lib/platform-dev-policy", () => ({ getPlatformDevPolicyState: () => "contribution_ready" }));
vi.mock("@/lib/build/identity-privacy", () => ({
  resolveHiveToken: async () => "synthetic-test-token", getPlatformIdentity: async () => ({ dcoSignoff: "synthetic-dco", clientId: "synthetic-id", authorName: "synthetic-author" }),
  generatePrivateBranchName: () => "synthetic-branch", generateAnonymousCommitMessage: () => "synthetic-message",
}));
vi.mock("@/lib/build/sandbox/sandbox-admin", () => ({ diagnoseSandboxReadiness: async () => ({}) }));
vi.mock("@/lib/build/sandbox/sandbox-readiness-gate", () => ({ assertSandboxReadyForContribution: () => ({ ok: true }) }));
vi.mock("@/lib/build/private-paths", () => ({ loadPrivatePathPatterns: async () => [], compilePrivatePathMatcher: () => ({}), stripPrivatePathsFromDiff: (diff: string) => ({ kept: diff }) }));
vi.mock("@/lib/build/disposition", () => ({ mayShareToPublicHive: () => true, privateDispositionBlockMessage: () => "private" }));
vi.mock("@/lib/build/sandbox-state", () => ({ buildSandboxStateFromRecord: () => ({}), assertSandboxReadyForPromotion: () => ({ ok: true }), serializePlanDocument: () => "plan" }));
vi.mock("@/lib/build/contribution-review", () => ({ analyzeContributionSeedFit: async () => ({ allFiles: ["a.ts"], seedFit: {}, securityScan: { passed: true, criticalCount: 0, warningCount: 0 } }) }));
vi.mock("@/lib/build/github-api-commit", () => ({ createBranchAndPR: mocks.forge }));
import { contributionHivePack } from "./contribution-hive-pack";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.mockResolvedValue({ contributionMode: "contribute_all", dcoAcceptedAt: new Date(0), upstreamRemoteUrl: "https://github.com/synthetic/receiver.git" });
  mocks.build.mockResolvedValue({ id: "build-row", title: "Synthetic result", createdById: "requester", diffPatch: "diff --git a/a.ts b/a.ts\n", brief: {}, disposition: "shareable" });
  mocks.findPack.mockResolvedValue(null); mocks.createPack.mockResolvedValue({}); mocks.updatePack.mockResolvedValue({});
  mocks.forge.mockResolvedValue({ prUrl: null, prNumber: null });
});
describe("pack transport receipt", () => {
  it("marks a retry's rewritten current payload local until its own PR receipt exists", async () => {
    mocks.findPack.mockResolvedValue({ packId: "FP-existing", status: "contributed", manifest: { prUrl: "https://github.com/synthetic/receiver/pull/old", files: ["old.ts"] } });
    const result = await contributionHivePack.handlers.contribute_to_hive({}, "requester");
    expect(mocks.createPack).not.toHaveBeenCalled();
    expect(mocks.updatePack).toHaveBeenCalledWith(expect.objectContaining({ where: { packId: "FP-existing" }, data: expect.objectContaining({ status: "local", manifest: expect.not.objectContaining({ prUrl: expect.any(String) }) }) }));
    expect(result.success).toBe(false);
  });
  it("persists only a local pack before an attempted PR and keeps it local on failure", async () => {
    const result = await contributionHivePack.handlers.contribute_to_hive({}, "requester");
    expect(mocks.createPack).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "local" }) }));
    expect(mocks.updatePack.mock.calls.some(([args]) => args.data.status === "contributed")).toBe(false);
    expect(result.success).toBe(false);
  });
  it("records contribution only together with the actual PR receipt", async () => {
    const prUrl = "https://github.com/synthetic/receiver/pull/42";
    mocks.forge.mockResolvedValue({ prUrl, prNumber: null });
    const result = await contributionHivePack.handlers.contribute_to_hive({}, "requester");
    expect(mocks.updatePack).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "contributed", manifest: expect.objectContaining({ prUrl }) }) }));
    expect(result.success).toBe(true);
  });
});
