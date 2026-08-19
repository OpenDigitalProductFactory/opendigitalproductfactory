import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  platformDevConfigFindUnique: vi.fn(),
  featureBuildCount: vi.fn(),
  featureBuildFindFirst: vi.fn(),
  featureBuildUpdate: vi.fn(),
  digitalProductFindUnique: vi.fn(),
  digitalProductUpdate: vi.fn(),
  modelProfileFindFirst: vi.fn(),
  agentActionProposalUpdateMany: vi.fn(),
  backlogItemFindFirst: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    platformDevConfig: { findUnique: (...a: unknown[]) => db.platformDevConfigFindUnique(...a) },
    featureBuild: {
      count: (...a: unknown[]) => db.featureBuildCount(...a),
      findFirst: (...a: unknown[]) => db.featureBuildFindFirst(...a),
      update: (...a: unknown[]) => db.featureBuildUpdate(...a),
    },
    digitalProduct: {
      findUnique: (...a: unknown[]) => db.digitalProductFindUnique(...a),
      update: (...a: unknown[]) => db.digitalProductUpdate(...a),
    },
    modelProfile: { findFirst: (...a: unknown[]) => db.modelProfileFindFirst(...a) },
    agentActionProposal: { updateMany: (...a: unknown[]) => db.agentActionProposalUpdateMany(...a) },
    backlogItem: { findFirst: (...a: unknown[]) => db.backlogItemFindFirst(...a) },
    $transaction: (...a: unknown[]) => db.transaction(...a),
  },
}));

const teeUp = vi.hoisted(() => ({ promoteBacklogItemToBuildDraft: vi.fn() }));
vi.mock("@/lib/governed-backlog-tee-up", () => teeUp);

const routeCtx = vi.hoisted(() => ({ inferProviderIdFromRouteContext: vi.fn() }));
vi.mock("@/lib/ai-provider-route-context", () => routeCtx);

const wipCap = vi.hoisted(() => ({
  wipCapReached: vi.fn(() => false),
  // BI-937128F6: the promote gate now derives from the unified, pool-aware model.
  decideUnifiedWip: vi.fn(() => ({
    pool: "bs-sandbox",
    pressure: 0,
    capacity: 3,
    admitted: true,
  })),
  BUILD_WIP_CAP: 8,
  BuildWipCapError: class extends Error {
    constructor() {
      super("wip cap reached");
    }
  },
  TERMINAL_BUILD_PHASES: ["ship"],
}));
vi.mock("@/lib/build/wip-cap", () => wipCap);

const unifiedWipQuery = vi.hoisted(() => ({
  loadActiveUnifiedWip: vi.fn(async () => ({
    total: 0,
    perSurface: {},
    bsSandboxContending: 0,
    sharedLeaseContending: 0,
    hostWorktreeOnly: 0,
  })),
  poolPressure: vi.fn(() => 0),
}));
vi.mock("@/lib/build/unified-wip-query", () => unifiedWipQuery);

const ideateOnApproval = vi.hoisted(() => ({ dispatchIdeateForApprovedBuild: vi.fn() }));
vi.mock("@/lib/build/ideate-on-approval", () => ideateOnApproval);

const preflight = vi.hoisted(() => ({ resolveLiveInstallReadiness: vi.fn() }));
vi.mock("@/lib/verify/preflight-service", () => preflight);

const toolScript = vi.hoisted(() => ({ runToolScript: vi.fn() }));
vi.mock("@/lib/tak/tool-script", () => toolScript);

const codebaseTools = vi.hoisted(() => ({
  readProjectFile: vi.fn(),
  writeProjectFile: vi.fn(),
  generateSimpleDiff: vi.fn(() => "diff"),
}));
vi.mock("@/lib/build/codebase-tools", () => codebaseTools);

const gitUtils = vi.hoisted(() => ({
  isGitAvailable: vi.fn(async () => false),
  commitFile: vi.fn(),
  formatCommitMessage: vi.fn(() => "msg"),
}));
vi.mock("@/lib/git-utils", () => gitUtils);

const endpointRunner = vi.hoisted(() => ({ runEndpointTests: vi.fn() }));
vi.mock("@/lib/endpoint-test-runner", () => endpointRunner);

const selfAbandon = vi.hoisted(() => ({ abandonOwnStalledBuild: vi.fn() }));
vi.mock("@/lib/build/self-abandon-eligibility", () => selfAbandon);

import { buildOpsPack } from "./build-ops-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const DEFINITION_TOOLS = [
  "promote_to_build_studio",
  "abandon_stalled_build",
  "update_lifecycle",
  "verify_live_install_readiness",
  "run_tool_script",
  "propose_file_change",
  "run_endpoint_tests",
];
// generate_code is a removed tool: it registers a handler but no definition.
const HANDLER_TOOLS = [...DEFINITION_TOOLS, "generate_code"];

const EXPECTED_GRANTS: Record<string, string[]> = {
  promote_to_build_studio: ["build_lifecycle"],
  abandon_stalled_build: ["build_lifecycle"],
  update_lifecycle: ["backlog_write"],
  verify_live_install_readiness: ["release_plan_read"],
  run_tool_script: ["tool_script_exec"],
  propose_file_change: ["file_read"],
  run_endpoint_tests: ["agent_control_read"],
  generate_code: ["sandbox_execute"],
};

beforeEach(() => {
  vi.clearAllMocks();
  wipCap.wipCapReached.mockReturnValue(false);
  wipCap.decideUnifiedWip.mockReturnValue({
    pool: "bs-sandbox",
    pressure: 0,
    capacity: 3,
    admitted: true,
  });
  unifiedWipQuery.loadActiveUnifiedWip.mockResolvedValue({
    total: 0,
    perSurface: {},
    bsSandboxContending: 0,
    sharedLeaseContending: 0,
    hostWorktreeOnly: 0,
  });
  unifiedWipQuery.poolPressure.mockReturnValue(0);
  routeCtx.inferProviderIdFromRouteContext.mockReturnValue(null);
  gitUtils.isGitAvailable.mockResolvedValue(false);
});

describe("build-ops pack — registration", () => {
  it("advertises the build-ops definitions", () => {
    expect(buildOpsPack.definitions.map((d) => d.name).sort()).toEqual([...DEFINITION_TOOLS].sort());
    expect(buildOpsPack.packId).toBe("build-ops");
  });

  it("registers handlers for every definition plus the handler-only generate_code guard", () => {
    expect(Object.keys(buildOpsPack.handlers).sort()).toEqual([...HANDLER_TOOLS].sort());
    for (const def of buildOpsPack.definitions) {
      expect(buildOpsPack.handlers[def.name], def.name).toBeTypeOf("function");
    }
  });

  it("keeps the removed generate_code tool out of the advertised definitions", () => {
    const names = buildOpsPack.definitions.map((d) => d.name);
    expect(names).not.toContain("generate_code");
    expect(buildOpsPack.handlers.generate_code).toBeTypeOf("function");
  });

  it("descriptions are provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of buildOpsPack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("grants mirror agent-grants for every tool", () => {
    for (const t of HANDLER_TOOLS) {
      expect(buildOpsPack.grants[t]).toEqual(EXPECTED_GRANTS[t]);
      expect(isToolAllowedByGrants(t, EXPECTED_GRANTS[t])).toBe(true);
    }
  });
});

describe("build-ops pack — handler behavior (delegation preserved)", () => {
  it("generate_code returns the removed-tool guard", async () => {
    const res = await buildOpsPack.handlers.generate_code({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("Tool removed.");
    expect(res.message).toContain("have been removed");
  });

  it("update_lifecycle reports not found for an unknown product", async () => {
    db.digitalProductFindUnique.mockResolvedValue(null);
    const res = await buildOpsPack.handlers.update_lifecycle({ productId: "DP-x" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("Product not found");
    expect(db.digitalProductUpdate).not.toHaveBeenCalled();
  });

  it("update_lifecycle updates stage/status for a known product", async () => {
    db.digitalProductFindUnique.mockResolvedValue({ productId: "DP-1" });
    db.digitalProductUpdate.mockResolvedValue({});
    const res = await buildOpsPack.handlers.update_lifecycle(
      { productId: "DP-1", lifecycleStage: "production", lifecycleStatus: "active" },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(db.digitalProductUpdate).toHaveBeenCalledWith({
      where: { productId: "DP-1" },
      data: { lifecycleStage: "production", lifecycleStatus: "active" },
    });
  });

  it("verify_live_install_readiness requires a featureSha", async () => {
    const res = await buildOpsPack.handlers.verify_live_install_readiness({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("missing_feature_sha");
    expect(preflight.resolveLiveInstallReadiness).not.toHaveBeenCalled();
  });

  it("verify_live_install_readiness surfaces the preflight verdict", async () => {
    preflight.resolveLiveInstallReadiness.mockResolvedValue({ verdict: "CAN-TEST", reason: "served" });
    const res = await buildOpsPack.handlers.verify_live_install_readiness({ featureSha: "abc123" }, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toBe("CAN-TEST: served");
    expect(preflight.resolveLiveInstallReadiness).toHaveBeenCalledWith({ featureSha: "abc123" });
  });

  it("run_tool_script delegates to the governed script runner with context", async () => {
    toolScript.runToolScript.mockResolvedValue({ success: true, message: "ran" });
    const res = await buildOpsPack.handlers.run_tool_script(
      { code: "emit(1)" },
      "u1",
      { agentId: "a1", threadId: "t1", routeContext: "/build" },
    );
    expect(res.success).toBe(true);
    expect(toolScript.runToolScript).toHaveBeenCalledWith(
      { code: "emit(1)" },
      { userId: "u1", agentId: "a1", threadId: "t1", routeContext: "/build" },
    );
  });

  it("propose_file_change applies the change (no git available)", async () => {
    codebaseTools.readProjectFile.mockResolvedValue({ content: "old" });
    codebaseTools.writeProjectFile.mockResolvedValue({ ok: true });
    const res = await buildOpsPack.handlers.propose_file_change(
      { path: "foo.ts", newContent: "new", description: "tweak" },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(res.message).toContain("Applied change to foo.ts");
    expect(codebaseTools.writeProjectFile).toHaveBeenCalledWith("foo.ts", "new");
  });

  it("run_endpoint_tests errors when no endpoint and no allEndpoints", async () => {
    const res = await buildOpsPack.handlers.run_endpoint_tests({}, "u1", {});
    expect(res.success).toBe(false);
    expect(res.message).toContain("requires endpointId or allEndpoints");
    expect(endpointRunner.runEndpointTests).not.toHaveBeenCalled();
  });

  it("run_endpoint_tests delegates for an explicit endpoint", async () => {
    db.modelProfileFindFirst.mockResolvedValue({ modelId: "m1" });
    endpointRunner.runEndpointTests.mockResolvedValue([
      { endpointId: "openai", probes: [{ name: "p", pass: true }], scenarios: [], instructionFollowing: "good" },
    ]);
    const res = await buildOpsPack.handlers.run_endpoint_tests({ endpointId: "openai" }, "u1", {});
    expect(res.success).toBe(true);
    expect(res.message).toContain("**openai**");
    expect(endpointRunner.runEndpointTests).toHaveBeenCalledWith(
      expect.objectContaining({ endpointId: "openai", triggeredBy: "u1" }),
    );
  });

  it("promote_to_build_studio promotes a triaged item through the transaction", async () => {
    db.platformDevConfigFindUnique.mockResolvedValue({ governedBacklogEnabled: false });
    db.backlogItemFindFirst.mockResolvedValue({
      title: "Add invoice CSV export",
      body: "Customer feature",
      workType: "feature",
    });
    db.featureBuildCount.mockResolvedValue(0);
    db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb({}));
    teeUp.promoteBacklogItemToBuildDraft.mockResolvedValue({
      kind: "ok",
      build: { buildId: "FB-1" },
      autoApprovedDispatchEligible: false,
    });
    const res = await buildOpsPack.handlers.promote_to_build_studio({ itemId: "BI-1" }, "u1");
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("FB-1");
    expect(teeUp.promoteBacklogItemToBuildDraft).toHaveBeenCalled();
  });

  it("promote_to_build_studio refuses core-platform altitude without force (BI-4A30D8AC)", async () => {
    db.platformDevConfigFindUnique.mockResolvedValue({ governedBacklogEnabled: false });
    db.backlogItemFindFirst.mockResolvedValue({
      title: "BET-5 · Hybridize Neo4j + Qdrant onto Postgres",
      body: "Retire Neo4j; use pgvector.",
      workType: "refactor",
    });
    const res = await buildOpsPack.handlers.promote_to_build_studio({ itemId: "BI-BET5" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("unsuitable_for_build_studio");
    expect(String(res.message)).toMatch(/direct expert build/i);
    expect(teeUp.promoteBacklogItemToBuildDraft).not.toHaveBeenCalled();
  });

  it("promote_to_build_studio allows core-platform when force=true", async () => {
    db.platformDevConfigFindUnique.mockResolvedValue({ governedBacklogEnabled: false });
    db.backlogItemFindFirst.mockResolvedValue({
      title: "BET-5 · Hybridize Neo4j + Qdrant onto Postgres",
      body: "Retire Neo4j; use pgvector.",
      workType: "refactor",
    });
    db.featureBuildCount.mockResolvedValue(0);
    db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb({}));
    teeUp.promoteBacklogItemToBuildDraft.mockResolvedValue({
      kind: "ok",
      build: { buildId: "FB-FORCE" },
      autoApprovedDispatchEligible: false,
    });
    const res = await buildOpsPack.handlers.promote_to_build_studio(
      { itemId: "BI-BET5", force: true },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("FB-FORCE");
  });

  it("promote_to_build_studio refuses when the WIP cap is reached", async () => {
    db.platformDevConfigFindUnique.mockResolvedValue({ governedBacklogEnabled: false });
    db.backlogItemFindFirst.mockResolvedValue({
      title: "Add invoice CSV export",
      body: "Customer feature",
      workType: "feature",
    });
    db.featureBuildCount.mockResolvedValue(99);
    // BI-937128F6: the bs-sandbox pool is saturated across all surfaces.
    unifiedWipQuery.poolPressure.mockReturnValue(3);
    wipCap.decideUnifiedWip.mockReturnValue({
      pool: "bs-sandbox",
      pressure: 3,
      capacity: 3,
      admitted: false,
    });
    const res = await buildOpsPack.handlers.promote_to_build_studio({ itemId: "BI-1" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("wip_cap_reached");
    expect(teeUp.promoteBacklogItemToBuildDraft).not.toHaveBeenCalled();
  });

  it("abandon_stalled_build requires a buildId", async () => {
    const res = await buildOpsPack.handlers.abandon_stalled_build({ reason: "gone" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("missing_build_id");
    expect(selfAbandon.abandonOwnStalledBuild).not.toHaveBeenCalled();
  });

  it("abandon_stalled_build requires a reason", async () => {
    const res = await buildOpsPack.handlers.abandon_stalled_build({ buildId: "FB-1" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("missing_reason");
    expect(selfAbandon.abandonOwnStalledBuild).not.toHaveBeenCalled();
  });

  it("abandon_stalled_build reports build_not_found", async () => {
    selfAbandon.abandonOwnStalledBuild.mockResolvedValue({ kind: "not_found" });
    const res = await buildOpsPack.handlers.abandon_stalled_build(
      { buildId: "FB-nope", reason: "gone" },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("build_not_found");
  });

  it("abandon_stalled_build surfaces an ineligibility reason (e.g. not the owner)", async () => {
    selfAbandon.abandonOwnStalledBuild.mockResolvedValue({
      kind: "ineligible",
      reason: "not_owner",
      detail: "Only the build's own creator may self-abandon it.",
    });
    const res = await buildOpsPack.handlers.abandon_stalled_build(
      { buildId: "FB-1", reason: "gone" },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("self_abandon_not_owner");
    expect(res.message).toContain("own creator");
  });

  it("abandon_stalled_build abandons an eligible stalled build owned by the caller", async () => {
    selfAbandon.abandonOwnStalledBuild.mockResolvedValue({ kind: "abandoned", buildId: "FB-1" });
    const res = await buildOpsPack.handlers.abandon_stalled_build(
      { buildId: "FB-1", reason: "shipped elsewhere in PR #1981" },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("FB-1");
    expect(selfAbandon.abandonOwnStalledBuild).toHaveBeenCalledWith({
      buildId: "FB-1",
      callerId: "u1",
      reason: "shipped elsewhere in PR #1981",
    });
  });
});
