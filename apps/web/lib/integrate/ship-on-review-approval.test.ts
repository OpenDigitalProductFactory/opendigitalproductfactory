import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression coverage for the review→ship loop fix.
//
// Before the fix, `deploy_feature` extracted the sandbox diff but never flipped
// the phase, and `dispatchShipForVerifiedBuild` skipped whenever a diff already
// existed — so a review-stranded build was re-entered by the reconciler every
// tick, hit the "diff already extracted" skip, and looped at review forever
// (observed live on FB-FD850A2C). The fix advances review→ship (policy-gated)
// and attempts ship→complete instead of skipping.

type BuildRow = {
  phase: string;
  diffPatch: string | null;
  buildBranch: string | null;
  sandboxId: string | null;
  title: string;
  kind: string;
  createdById: string | null;
  brief: unknown;
  designDoc: unknown;
  designReview: unknown;
  plan: unknown;
  buildPlan: unknown;
  planReview: unknown;
  verificationOut: unknown;
  acceptanceMet: unknown;
  threadId: string | null;
};

const state = vi.hoisted(() => ({
  build: null as Record<string, unknown> | null,
  updateManyCalls: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
  updateManyResult: { count: 1 },
  activity: [] as Array<{ tool: string; summary: string }>,
  gateAllowed: true,
  gateReason: undefined as string | undefined,
  canTransition: true,
  reconcileResult: false,
  reconcileCalls: [] as string[],
  emits: [] as Array<{ threadId: string; evt: Record<string, unknown> }>,
  executeToolCalls: [] as Array<{ tool: string; params: Record<string, unknown> }>,
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    featureBuild: {
      findUnique: vi.fn(async () => state.build),
      updateMany: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        state.updateManyCalls.push(args);
        return state.updateManyResult;
      }),
    },
    buildActivity: {
      create: vi.fn(async (args: { data: { tool: string; summary: string } }) => {
        state.activity.push(args.data);
        return {};
      }),
    },
  },
}));

vi.mock("@/lib/feature-build-types", () => ({
  checkPhaseGate: vi.fn(() => ({ allowed: state.gateAllowed, reason: state.gateReason })),
  canTransitionPhase: vi.fn(() => state.canTransition),
  normalizeHappyPathState: vi.fn((x: unknown) => x),
}));

vi.mock("@/lib/build-flow-state", () => ({
  reconcileBuildCompletion: vi.fn(async (buildId: string) => {
    state.reconcileCalls.push(buildId);
    return state.reconcileResult;
  }),
}));

vi.mock("@/lib/mcp-tools", () => ({
  executeTool: vi.fn(async (tool: string, params: Record<string, unknown>) => {
    state.executeToolCalls.push({ tool, params });
    return { success: true };
  }),
}));

vi.mock("@/lib/agent-event-bus", () => ({
  agentEventBus: {
    emit: vi.fn((threadId: string, evt: Record<string, unknown>) => {
      state.emits.push({ threadId, evt });
    }),
  },
}));

import { dispatchShipForVerifiedBuild } from "./ship-on-review-approval";

function makeBuild(overrides: Partial<BuildRow> = {}): Record<string, unknown> {
  return {
    phase: "review",
    diffPatch: "diff --git a/x b/x\n+truncated",
    buildBranch: "build/FB-FD850A2C",
    sandboxId: "sb-1",
    title: "truncateMiddle helper",
    kind: "chore",
    createdById: "usr_creator",
    brief: null,
    designDoc: null,
    designReview: null,
    plan: null,
    buildPlan: { steps: [{ title: "add helper" }] },
    planReview: null,
    verificationOut: { typecheckPassed: true, testsFailed: 88 },
    acceptanceMet: true,
    threadId: "thread-1",
    ...overrides,
  };
}

beforeEach(() => {
  state.build = null;
  state.updateManyCalls.length = 0;
  state.updateManyResult = { count: 1 };
  state.activity.length = 0;
  state.gateAllowed = true;
  state.gateReason = undefined;
  state.canTransition = true;
  state.reconcileResult = false;
  state.reconcileCalls.length = 0;
  state.emits.length = 0;
  state.executeToolCalls.length = 0;
});

describe("dispatchShipForVerifiedBuild — review→ship loop fix", () => {
  it("advances review→ship when the diff is already extracted, instead of skipping forever", async () => {
    state.build = makeBuild();

    const out = await dispatchShipForVerifiedBuild({
      buildId: "FB-FD850A2C",
      userId: "usr_caller",
      verificationStatus: "skipped",
    });

    // The bug was a permanent "skipped — diff already extracted"; now it advances.
    expect(out.kind).toBe("dispatched-success");
    expect(state.updateManyCalls).toHaveLength(1);
    expect(state.updateManyCalls[0]?.where).toMatchObject({ buildId: "FB-FD850A2C", phase: "review" });
    expect(state.updateManyCalls[0]?.data).toMatchObject({ phase: "ship" });
    // deploy_feature must NOT be re-run — the diff already exists.
    expect(state.executeToolCalls).toHaveLength(0);
    // Phase-change event emitted for the live UI.
    expect(state.emits.some((e) => (e.evt as { phase?: string }).phase === "ship")).toBe(true);
  });

  it("respects the policy review→ship gate — does not advance when the gate blocks", async () => {
    state.build = makeBuild({ acceptanceMet: null });
    state.gateAllowed = false;
    state.gateReason = "Acceptance criteria not evaluated.";

    const out = await dispatchShipForVerifiedBuild({
      buildId: "FB-GATED",
      userId: "usr_caller",
      verificationStatus: "complete",
    });

    expect(out.kind).toBe("skipped");
    expect(state.updateManyCalls).toHaveLength(0); // no forced advance
    expect(state.activity.some((a) => /gate/i.test(a.summary))).toBe(true);
  });

  it("finishes the build (ship→complete) when the ship forks are terminal + deployed", async () => {
    state.build = makeBuild();
    state.reconcileResult = true;

    const out = await dispatchShipForVerifiedBuild({
      buildId: "FB-DONE",
      userId: "usr_caller",
      verificationStatus: "skipped",
    });

    expect(out.kind).toBe("dispatched-success");
    expect(state.reconcileCalls).toContain("FB-DONE");
    expect(state.activity.some((a) => /complete/i.test(a.summary))).toBe(true);
  });

  it("is idempotent — skips a build already in the ship phase", async () => {
    state.build = makeBuild({ phase: "ship" });

    const out = await dispatchShipForVerifiedBuild({
      buildId: "FB-SHIP",
      userId: "usr_caller",
      verificationStatus: "complete",
    });

    expect(out.kind).toBe("skipped");
    if (out.kind !== "skipped") throw new Error(`expected skipped, got ${out.kind}`);
    expect(out.reason).toBe("already in ship phase");
    expect(state.updateManyCalls).toHaveLength(0);
  });

  it("extracts the diff via deploy_feature, then advances, on the first (no-diff) pass", async () => {
    state.build = makeBuild({ diffPatch: null });

    const out = await dispatchShipForVerifiedBuild({
      buildId: "FB-FRESH",
      userId: "usr_caller",
      verificationStatus: "complete",
    });

    expect(state.executeToolCalls.map((c) => c.tool)).toContain("deploy_feature");
    expect(state.updateManyCalls).toHaveLength(1);
    expect(state.updateManyCalls[0]?.data).toMatchObject({ phase: "ship" });
    expect(out.kind).toBe("dispatched-success");
  });

  it("does not double-advance when a concurrent advance already moved the build (updateMany count 0)", async () => {
    state.build = makeBuild();
    state.updateManyResult = { count: 0 };

    const out = await dispatchShipForVerifiedBuild({
      buildId: "FB-RACE",
      userId: "usr_caller",
      verificationStatus: "skipped",
    });

    expect(out.kind).toBe("skipped");
    expect(state.reconcileCalls).toHaveLength(0); // no completion attempt on a lost race
  });
});
