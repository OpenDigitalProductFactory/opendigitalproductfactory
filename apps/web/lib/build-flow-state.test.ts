import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    featureBuild:      { findUnique: vi.fn(), update: vi.fn() },
    featurePack:       { findFirst: vi.fn() },
    platformDevConfig: { findUnique: vi.fn() },
    buildActivity:     { findFirst: vi.fn() },
    productVersion:    { findMany: vi.fn() },
    changePromotion:   { updateMany: vi.fn() },
    workroom:       { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/agent-event-bus", () => ({
  agentEventBus: { emit: vi.fn() },
}));

vi.mock("@/lib/self-upgrade/completion", () => ({
  isFeatureBuildDeployed: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { isFeatureBuildDeployed } from "@/lib/self-upgrade/completion";
import { getBuildFlowState, reconcileBuildCompletion, completeLocalDeliveryBuild } from "./build-flow-state";
import { createBuildPrDeliveryState, writeBuildPrDeliveryState } from "./build/build-pr-delivery-state";

// ─── Fixture helpers ────────────────────────────────────────────────────────

interface BuildOverride {
  id?: string;
  buildId?: string;
  phase?: string;
  scoutFindings?: unknown;
  designDoc?: unknown;
  designReview?: unknown;
  buildPlan?: unknown;
  planReview?: unknown;
  verificationOut?: unknown;
  uxTestResults?: unknown;
  diffPatch?: string | null;
  productVersions?: Array<{
    id: string;
    promotions: Array<{
      promotionId: string;
      status: string;
      deployedAt: Date | null;
      rollbackReason: string | null;
      deploymentLog: string | null;
      createdAt: Date;
    }>;
  }>;
}

function mockBuild(overrides: BuildOverride = {}): void {
  vi.mocked(prisma.featureBuild.findUnique).mockResolvedValue({
    id: "row-1",
    buildId: "FB-TEST-001",
    phase: "ideate",
    scoutFindings: null,
    designDoc: null,
    designReview: null,
    buildPlan: null,
    planReview: null,
    verificationOut: null,
    uxTestResults: null,
    diffPatch: null,
    productVersions: [],
    ...overrides,
  } as never);
}

function mockDevConfig(mode: "fork_only" | "selective" | "contribute_all" = "selective"): void {
  vi.mocked(prisma.platformDevConfig.findUnique).mockResolvedValue({
    contributionMode: mode,
  } as never);
}

function mockPack(pack: { packId: string; prUrl: string | null; prNumber: number | null; manifest?: unknown } | null): void {
  vi.mocked(prisma.featurePack.findFirst).mockResolvedValue(pack as never);
  const manifest = pack?.manifest as { prUrl?: string; prNumber?: number } | undefined;
  const resolvedPrUrl = pack?.prUrl ?? manifest?.prUrl ?? null;
  const resolvedPrNumber = pack?.prNumber ?? manifest?.prNumber ?? null;
  vi.mocked(prisma.workroom.findFirst).mockResolvedValue(
    resolvedPrUrl
      ? ({
          workspaceState: writeBuildPrDeliveryState({}, {
            ...createBuildPrDeliveryState({
              repository: "org/repo",
              prNumber: resolvedPrNumber ?? 1,
              prUrl: resolvedPrUrl,
            }),
            status: "awaiting-release",
          }),
        } as never)
      : null,
  );
}

function mockActivity(summary: string | null): void {
  vi.mocked(prisma.buildActivity.findFirst).mockResolvedValue(
    summary ? ({ summary } as never) : null,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDevConfig("selective");
  mockPack(null);
  mockActivity(null);
  vi.mocked(isFeatureBuildDeployed).mockResolvedValue(true);
  vi.mocked(prisma.productVersion.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.changePromotion.updateMany).mockResolvedValue({ count: 0 } as never);
});

// ─── Main-track substep counts (A.3) ────────────────────────────────────────

describe("getBuildFlowState — main-track substep counts", () => {
  it("reports 0/3 on Ideate for a fresh build", async () => {
    mockBuild({ phase: "ideate" });
    const state = await getBuildFlowState("FB-TEST-001");
    const ideate = state!.mainTrack.find((n) => n.phase === "ideate")!;
    expect(ideate.stepsCompleted).toBe(0);
    expect(ideate.stepsTotal).toBe(3);
    expect(ideate.state).toBe("active");
  });

  it("reports 3/3 on Ideate when scoutFindings + designDoc + review passed", async () => {
    mockBuild({
      phase: "plan",
      scoutFindings: { notes: "x" },
      designDoc: { sections: [] },
      designReview: { decision: "pass" },
    });
    const state = await getBuildFlowState("FB-TEST-001");
    const ideate = state!.mainTrack.find((n) => n.phase === "ideate")!;
    expect(ideate.stepsCompleted).toBe(3);
    expect(ideate.state).toBe("done");
  });

  it("reports Build progress as tasks-done / tasks-total", async () => {
    mockBuild({
      phase: "build",
      buildPlan: {
        tasks: [
          { title: "a", status: "done" },
          { title: "b", status: "done" },
          { title: "c", status: "pending" },
          { title: "d", status: "pending" },
          { title: "e", status: "pending" },
        ],
      },
    });
    const state = await getBuildFlowState("FB-TEST-001");
    const build = state!.mainTrack.find((n) => n.phase === "build")!;
    expect(build.stepsCompleted).toBe(2);
    expect(build.stepsTotal).toBe(5);
    expect(build.state).toBe("active");
  });

  it("reports Review progress from verificationOut + uxTestResults", async () => {
    mockBuild({
      phase: "review",
      verificationOut: { typecheckPassed: true, testsPassed: false, lintPassed: true },
      uxTestResults: [{ status: "passed" }, { status: "passed" }, { status: "failed" }],
    });
    const state = await getBuildFlowState("FB-TEST-001");
    const review = state!.mainTrack.find((n) => n.phase === "review")!;
    expect(review.stepsCompleted).toBe(4); // typecheck + lint + 2 ux
    expect(review.stepsTotal).toBe(6);     // typecheck + tests + lint + 3 ux
  });

  it("marks ship node done when currentPhase is complete", async () => {
    mockBuild({ phase: "complete", diffPatch: "diff", productVersions: [{ id: "pv-1", promotions: [] }] });
    const state = await getBuildFlowState("FB-TEST-001");
    const ship = state!.mainTrack.find((n) => n.phase === "ship")!;
    expect(ship.state).toBe("done");
    expect(ship.stepsCompleted).toBe(ship.stepsTotal);
  });

  it("returns null for a missing build", async () => {
    vi.mocked(prisma.featureBuild.findUnique).mockResolvedValue(null);
    const state = await getBuildFlowState("FB-NOT-FOUND");
    expect(state).toBeNull();
  });
});

// ─── Upstream PR fork (A.2) ─────────────────────────────────────────────────

describe("getBuildFlowState — upstream PR fork", () => {
  it("is pending before the build reaches ship", async () => {
    mockBuild({ phase: "build" });
    const state = await getBuildFlowState("FB-TEST-001");
    expect(state!.upstream.state).toBe("pending");
  });

  it("is skipped when contributionMode is fork_only", async () => {
    mockBuild({ phase: "ship" });
    mockDevConfig("fork_only");
    const state = await getBuildFlowState("FB-TEST-001");
    expect(state!.upstream.state).toBe("skipped");
  });

  it("is shipped when FeaturePack.prUrl is populated", async () => {
    mockBuild({ phase: "ship" });
    mockPack({ packId: "FP-1", prUrl: "https://github.com/org/repo/pull/42", prNumber: 42 });
    const state = await getBuildFlowState("FB-TEST-001");
    expect(state!.upstream.state).toBe("shipped");
    expect(state!.upstream.prUrl).toBe("https://github.com/org/repo/pull/42");
    expect(state!.upstream.prNumber).toBe(42);
  });

  it("is still in progress when the PR exists but is only queued", async () => {
    mockBuild({ phase: "ship" });
    const prUrl = "https://github.com/org/repo/pull/42";
    mockPack({ packId: "FP-1", prUrl, prNumber: 42 });
    vi.mocked(prisma.workroom.findFirst).mockResolvedValue({
      workspaceState: writeBuildPrDeliveryState({}, {
        ...createBuildPrDeliveryState({ repository: "org/repo", prNumber: 42, prUrl }),
        status: "queued",
      }),
    } as never);
    const state = await getBuildFlowState("FB-TEST-001");
    expect(state!.upstream.state).toBe("in_progress");
    expect(state!.allApplicableForksTerminal).toBe(false);
  });

  it("reads prUrl from manifest when the top-level column is null (post-A2)", async () => {
    mockBuild({ phase: "ship" });
    mockPack({
      packId: "FP-1",
      prUrl: null,
      prNumber: null,
      manifest: { prUrl: "https://github.com/org/repo/pull/99", prNumber: 99 },
    });
    const state = await getBuildFlowState("FB-TEST-001");
    expect(state!.upstream.state).toBe("shipped");
    expect(state!.upstream.prUrl).toBe("https://github.com/org/repo/pull/99");
  });

  it("is errored when pack exists, no prUrl, and activity recorded a failure", async () => {
    mockBuild({ phase: "ship" });
    mockPack({ packId: "FP-1", prUrl: null, prNumber: null });
    mockActivity("FeaturePack FP-1 created but upstream PR FAILED: Token lacks Contents:Read.");
    const state = await getBuildFlowState("FB-TEST-001");
    expect(state!.upstream.state).toBe("errored");
    expect(state!.upstream.errorMessage).toMatch(/Token lacks/);
  });

  it("is in_progress when pack exists, no prUrl, and no failure recorded", async () => {
    mockBuild({ phase: "ship" });
    mockPack({ packId: "FP-1", prUrl: null, prNumber: null });
    mockActivity(null);
    const state = await getBuildFlowState("FB-TEST-001");
    expect(state!.upstream.state).toBe("in_progress");
  });

  it("is in_progress when ship reached but no pack yet (user not decided)", async () => {
    mockBuild({ phase: "ship" });
    mockPack(null);
    const state = await getBuildFlowState("FB-TEST-001");
    expect(state!.upstream.state).toBe("in_progress");
  });
});

// ─── Promote-to-Prod fork (A.2) ─────────────────────────────────────────────

describe("getBuildFlowState — promote-to-prod fork", () => {
  function buildWithPromotion(status: string, extras: Partial<{ deployedAt: Date; rollbackReason: string; deploymentLog: string }> = {}): void {
    mockBuild({
      phase: "ship",
      productVersions: [{
        id: "pv-1",
        promotions: [{
          promotionId: "CP-1",
          status,
          deployedAt: extras.deployedAt ?? null,
          rollbackReason: extras.rollbackReason ?? null,
          deploymentLog: extras.deploymentLog ?? null,
          createdAt: new Date(),
        }],
      }],
    });
  }

  it("is pending before the build reaches ship", async () => {
    mockBuild({ phase: "build" });
    const state = await getBuildFlowState("FB-TEST-001");
    expect(state!.promote.state).toBe("pending");
  });

  it("is in_progress when ship reached but no productVersion/promotion yet", async () => {
    mockBuild({ phase: "ship" });
    const state = await getBuildFlowState("FB-TEST-001");
    expect(state!.promote.state).toBe("in_progress");
  });

  it("is shipped when ChangePromotion.status is 'deployed'", async () => {
    buildWithPromotion("deployed", { deployedAt: new Date("2026-04-20T01:00:00Z") });
    const state = await getBuildFlowState("FB-TEST-001");
    expect(state!.promote.state).toBe("shipped");
    expect(state!.promote.promotionId).toBe("CP-1");
    expect(state!.promote.deployedAt).toEqual(new Date("2026-04-20T01:00:00Z"));
  });

  it("is scheduled when ChangePromotion.status is 'scheduled'", async () => {
    buildWithPromotion("scheduled", { deploymentLog: "window: Mon 18:00-20:00 UTC" });
    const state = await getBuildFlowState("FB-TEST-001");
    expect(state!.promote.state).toBe("scheduled");
    expect(state!.promote.scheduleDescription).toContain("Mon 18:00-20:00");
  });

  it("is awaiting_operator when status matches A1 handoff", async () => {
    buildWithPromotion("awaiting_operator");
    const state = await getBuildFlowState("FB-TEST-001");
    expect(state!.promote.state).toBe("awaiting_operator");
  });

  it("is rolled_back when status is 'rolled_back' and surfaces the reason", async () => {
    buildWithPromotion("rolled_back", { rollbackReason: "Health check failed after deploy" });
    const state = await getBuildFlowState("FB-TEST-001");
    expect(state!.promote.state).toBe("rolled_back");
    expect(state!.promote.rollbackReason).toBe("Health check failed after deploy");
  });

  it("is in_progress when status is 'pending' or 'approved'", async () => {
    buildWithPromotion("approved");
    let state = await getBuildFlowState("FB-TEST-001");
    expect(state!.promote.state).toBe("in_progress");

    buildWithPromotion("pending");
    state = await getBuildFlowState("FB-TEST-001");
    expect(state!.promote.state).toBe("in_progress");
  });
});

// ─── allApplicableForksTerminal (A.2) ───────────────────────────────────────

describe("getBuildFlowState — allApplicableForksTerminal", () => {
  it("is false before ship", async () => {
    mockBuild({ phase: "review" });
    const state = await getBuildFlowState("FB-TEST-001");
    expect(state!.allApplicableForksTerminal).toBe(false);
  });

  it("is false when upstream is in_progress even if promote is shipped", async () => {
    mockBuild({
      phase: "ship",
      productVersions: [{ id: "pv-1", promotions: [{ promotionId: "CP-1", status: "deployed", deployedAt: new Date(), rollbackReason: null, deploymentLog: null, createdAt: new Date() }] }],
    });
    mockPack({ packId: "FP-1", prUrl: null, prNumber: null });
    const state = await getBuildFlowState("FB-TEST-001");
    expect(state!.promote.state).toBe("shipped");
    expect(state!.upstream.state).toBe("in_progress");
    expect(state!.allApplicableForksTerminal).toBe(false);
  });

  it("is true when upstream is skipped and promote is shipped", async () => {
    mockBuild({
      phase: "ship",
      productVersions: [{ id: "pv-1", promotions: [{ promotionId: "CP-1", status: "deployed", deployedAt: new Date(), rollbackReason: null, deploymentLog: null, createdAt: new Date() }] }],
    });
    mockDevConfig("fork_only");
    const state = await getBuildFlowState("FB-TEST-001");
    expect(state!.allApplicableForksTerminal).toBe(true);
  });

  it("is true when both forks in disposition (shipped + awaiting_operator)", async () => {
    mockBuild({
      phase: "ship",
      productVersions: [{ id: "pv-1", promotions: [{ promotionId: "CP-1", status: "awaiting_operator", deployedAt: null, rollbackReason: null, deploymentLog: null, createdAt: new Date() }] }],
    });
    mockPack({ packId: "FP-1", prUrl: "https://github.com/org/repo/pull/42", prNumber: 42 });
    const state = await getBuildFlowState("FB-TEST-001");
    expect(state!.upstream.state).toBe("shipped");
    expect(state!.promote.state).toBe("awaiting_operator");
    expect(state!.allApplicableForksTerminal).toBe(true);
  });
});

// ─── reconcileBuildCompletion (D.3) ─────────────────────────────────────────

describe("reconcileBuildCompletion", () => {
  it("returns false and does not update when build is not in ship", async () => {
    mockBuild({ phase: "build" });
    const changed = await reconcileBuildCompletion("FB-TEST-001");
    expect(changed).toBe(false);
    expect(prisma.featureBuild.update).not.toHaveBeenCalled();
  });

  it("returns false and does not update when forks are not all terminal", async () => {
    mockBuild({ phase: "ship" }); // no promotion, no pack → both in_progress
    const changed = await reconcileBuildCompletion("FB-TEST-001");
    expect(changed).toBe(false);
    expect(prisma.featureBuild.update).not.toHaveBeenCalled();
  });

  it("advances ship → complete when forks are all terminal", async () => {
    mockBuild({
      phase: "ship",
      productVersions: [{ id: "pv-1", promotions: [{ promotionId: "CP-1", status: "deployed", deployedAt: new Date(), rollbackReason: null, deploymentLog: null, createdAt: new Date() }] }],
    });
    mockPack({ packId: "FP-1", prUrl: "https://github.com/org/repo/pull/42", prNumber: 42 });
    vi.mocked(prisma.featureBuild.update).mockResolvedValue({} as never);
    const changed = await reconcileBuildCompletion("FB-TEST-001");
    expect(changed).toBe(true);
    expect(prisma.featureBuild.update).toHaveBeenCalledWith({
      where: { buildId: "FB-TEST-001" },
      data: { phase: "complete" },
    });
  });

  it("is idempotent when called on an already-complete build", async () => {
    mockBuild({ phase: "complete" });
    const changed = await reconcileBuildCompletion("FB-TEST-001");
    expect(changed).toBe(false);
    expect(prisma.featureBuild.update).not.toHaveBeenCalled();
  });

  it("returns false and does not update when deployed SHA does not contain the merge SHA", async () => {
    mockBuild({
      phase: "ship",
      productVersions: [{ id: "pv-1", promotions: [{ promotionId: "CP-1", status: "deployed", deployedAt: new Date(), rollbackReason: null, deploymentLog: null, createdAt: new Date() }] }],
    });
    mockPack({ packId: "FP-1", prUrl: "https://github.com/org/repo/pull/42", prNumber: 42 });
    vi.mocked(isFeatureBuildDeployed).mockResolvedValue(false);
    const changed = await reconcileBuildCompletion("FB-TEST-001");
    expect(changed).toBe(false);
    expect(prisma.featureBuild.update).not.toHaveBeenCalled();
  });

  it("completes a fully-local (fork_only) build on forks-terminal even when NOT deployed", async () => {
    // Fully-local install: contributionMode fork_only → the upstream fork is
    // "skipped" (the change is never PR'd / merged / re-deployed), so
    // isFeatureBuildDeployed can never become true. Without this path the build
    // parks at ship forever and clogs the WIP cap. The promote fork (the
    // registered ProductVersion) is the delivery, so the build must complete.
    mockDevConfig("fork_only");
    mockBuild({
      phase: "ship",
      productVersions: [{ id: "pv-1", promotions: [{ promotionId: "CP-1", status: "deployed", deployedAt: new Date(), rollbackReason: null, deploymentLog: null, createdAt: new Date() }] }],
    });
    vi.mocked(isFeatureBuildDeployed).mockResolvedValue(false);
    const changed = await reconcileBuildCompletion("FB-TEST-001");
    expect(changed).toBe(true);
    expect(prisma.featureBuild.update).toHaveBeenCalledWith({
      where: { buildId: "FB-TEST-001" },
      data: { phase: "complete" },
    });
  });
});

describe("completeLocalDeliveryBuild", () => {
  it("marks the local promotion delivered and completes a fork_only build (no deploy needed)", async () => {
    mockDevConfig("fork_only"); // upstream fork resolves to "skipped"
    mockBuild({
      phase: "ship",
      productVersions: [{ id: "pv-1", promotions: [{ promotionId: "CP-1", status: "deployed", deployedAt: new Date(), rollbackReason: null, deploymentLog: null, createdAt: new Date() }] }],
    });
    vi.mocked(prisma.productVersion.findMany).mockResolvedValue([{ id: "pv-1" }] as never);
    vi.mocked(prisma.changePromotion.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(isFeatureBuildDeployed).mockResolvedValue(false);
    vi.mocked(prisma.featureBuild.update).mockResolvedValue({} as never);

    const changed = await completeLocalDeliveryBuild("FB-TEST-001");

    expect(changed).toBe(true);
    // The still-open promotion is marked delivered — the local registration IS the delivery.
    expect(prisma.changePromotion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "deployed" }) }),
    );
    expect(prisma.featureBuild.update).toHaveBeenCalledWith({
      where: { buildId: "FB-TEST-001" },
      data: { phase: "complete" },
    });
  });

  it("is a no-op for a build with a real upstream fork (not skipped)", async () => {
    mockDevConfig("selective");
    mockPack({ packId: "FP-1", prUrl: "https://github.com/org/repo/pull/9", prNumber: 9 }); // upstream "shipped"
    mockBuild({
      phase: "ship",
      productVersions: [{ id: "pv-1", promotions: [{ promotionId: "CP-1", status: "approved", deployedAt: null, rollbackReason: null, deploymentLog: null, createdAt: new Date() }] }],
    });
    const changed = await completeLocalDeliveryBuild("FB-TEST-001");
    expect(changed).toBe(false);
    expect(prisma.changePromotion.updateMany).not.toHaveBeenCalled();
    expect(prisma.featureBuild.update).not.toHaveBeenCalled();
  });
});
