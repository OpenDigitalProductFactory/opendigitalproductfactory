import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    featureBuild:      { findUnique: vi.fn(), update: vi.fn() },
    featurePack:       { findFirst: vi.fn() },
    platformDevConfig: { findUnique: vi.fn() },
    buildActivity:     { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/agent-event-bus", () => ({
  agentEventBus: { emit: vi.fn() },
}));

import { prisma } from "@dpf/db";
import { getBuildFlowState, reconcileBuildCompletion } from "./build-flow-state";

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
});
