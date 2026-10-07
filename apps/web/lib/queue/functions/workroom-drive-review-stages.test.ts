import { describe, expect, it, vi } from "vitest";

import { buildWorkroomPostureClaim } from "@/lib/work-management/workroom-posture-claim";
import { buildWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";

import { runWorkroomDriveJob, type WorkroomDriveEffects, type WorkroomDriveRoom } from "./workroom-drive";
import { REVIEW_STAGE_RESOLUTIONS_PER_TICK, type ReviewStageContext, type ReviewStageDeps } from "./workroom-drive-review-stages";

// BI-2C8750FC: the drive tick rebinds a readiness review stage to its
// non-author reviewer and executes the dispatch as the reviewer packet.

const NOW = new Date("2026-10-06T00:00:00.000Z");
const PACKET = { targetAgent: "AGT-WS-REVIEW", requestKey: "rk-spec-approval", tier: 2 };

function room(capsuleId = "WC-LARGE"): WorkroomDriveRoom {
  return {
    id: `row-${capsuleId}`,
    capsuleId,
    scopeClaims: [buildWorkShapeClaim({ key: "delivery-large", version: "1.0.0" }), buildWorkroomPostureClaim({ proactivityLevel: "assertive" })],
    workspaceState: {},
    leaseExpiresAt: null,
    leaseHolderPrincipalId: "prn-coord",
    ownerUserId: "user-1",
    participants: [{
      workroomId: `row-${capsuleId}`, principalRef: "PRN-COORD", roles: ["coordinator"], assignmentSource: "explicit",
      enteredReason: null, currentWorkSummary: null, displayName: "Overseer", kind: "agent",
      sponsorPrincipalRef: null, sponsorDisplayName: null, authoritySummary: "",
    }],
    currentStageKey: "spec",
    receipts: [{ stageKey: "spec", kind: "design-doc" }],
    budgetUsage: [],
    stopConditionHits: [],
    reviewDue: false,
    substrateReachable: true,
    substrateEmpty: false,
    coordinatorEligibility: { jsi: "eligible", authorityBinding: "eligible" },
  };
}

function context(over: Partial<ReviewStageContext> = {}): ReviewStageContext {
  return {
    itemId: "BI-REVIEW",
    author: { kind: "person", userId: "user-1" },
    userId: "user-1",
    actionBoundary: "preauthorized",
    routes: [{ gate: "spec-approval", accountableRole: "design-checklist-reviewer", targetAgentId: "AGT-WS-REVIEW", independent: true, requestCoworker: PACKET }],
    ...over,
  };
}

function effects(dispatchOutcome: "dispatched" | "cooling-down" | "unavailable" = "dispatched") {
  return {
    persist: vi.fn<WorkroomDriveEffects["persist"]>(async () => {}),
    acquireLease: vi.fn<WorkroomDriveEffects["acquireLease"]>(async () => "acquired"),
    upsertAgentTask: vi.fn<WorkroomDriveEffects["upsertAgentTask"]>(async () => true),
    deactivateAgentTask: vi.fn<WorkroomDriveEffects["deactivateAgentTask"]>(async () => {}),
    dispatchReviewer: vi.fn<NonNullable<WorkroomDriveEffects["dispatchReviewer"]>>(async () => ({ outcome: dispatchOutcome, detail: "no connection" })),
  };
}

const deps = (ctx: ReviewStageContext | null): ReviewStageDeps & { loadContext: ReturnType<typeof vi.fn> } =>
  ({ loadContext: vi.fn(async () => ctx) });

const lastSnapshot = (fx: ReturnType<typeof effects>) => fx.persist.mock.calls.at(-1)?.[0].snapshot as Record<string, unknown>;

describe("workroom drive review stages (BI-2C8750FC)", () => {
  it("without review deps the review stage raises attention exactly as before", async () => {
    const fx = effects();
    const result = await runWorkroomDriveJob(NOW, { listRooms: async () => [room()], effects: fx });
    expect(result.plans[0]).toMatchObject({ action: "attention", reason: "governed_decision" });
    expect(fx.dispatchReviewer).not.toHaveBeenCalled();
  });

  it("person-authored at preauthorized: sends the exact reviewer packet, never a generic task", async () => {
    const fx = effects();
    const result = await runWorkroomDriveJob(NOW, { listRooms: async () => [room()], effects: fx, reviewStages: deps(context()) });
    expect(result.plans[0]).toMatchObject({ action: "dispatch_agent", reason: "agent_stage" });
    expect(result.dispatched).toBe(1);
    expect(fx.upsertAgentTask).not.toHaveBeenCalled();
    expect(fx.dispatchReviewer).toHaveBeenCalledWith(expect.objectContaining({
      capsuleId: "WC-LARGE", itemId: "BI-REVIEW", requestCoworker: PACKET, author: { kind: "person", userId: "user-1" },
    }));
    expect(lastSnapshot(fx)).toMatchObject({
      action: "dispatch_agent", stageKey: "spec-approval",
      review: { gate: "spec-approval", reviewer: "agent:AGT-WS-REVIEW", requestKey: "rk-spec-approval", outcome: "dispatched" },
    });
  });

  it("agent-authored: attention goes to the reviewer role, nothing is dispatched", async () => {
    const fx = effects();
    const result = await runWorkroomDriveJob(NOW, {
      listRooms: async () => [room()], effects: fx,
      reviewStages: deps(context({ author: { kind: "agent", agentId: "AGT-EXT-CLAUDE" } })),
    });
    expect(result.plans[0]).toMatchObject({ action: "attention" });
    expect(lastSnapshot(fx).pendingAttention).toMatchObject({ principalRef: "role:design-checklist-reviewer", stageKey: "spec-approval" });
    expect(fx.dispatchReviewer).not.toHaveBeenCalled();
    expect(fx.upsertAgentTask).not.toHaveBeenCalled();
  });

  it("below full proactivity the person-authored review is teed up for the reviewer role", async () => {
    const fx = effects();
    await runWorkroomDriveJob(NOW, { listRooms: async () => [room()], effects: fx, reviewStages: deps(context({ actionBoundary: "propose" })) });
    expect(lastSnapshot(fx)).toMatchObject({ action: "attention", pendingAttention: { principalRef: "role:design-checklist-reviewer" } });
    expect(fx.dispatchReviewer).not.toHaveBeenCalled();
  });

  it("a request that cannot be sent concludes as a named blockage, and no generic task replaces it", async () => {
    const fx = effects("unavailable");
    const result = await runWorkroomDriveJob(NOW, { listRooms: async () => [room()], effects: fx, reviewStages: deps(context()) });
    expect(result.dispatched).toBe(0);
    expect(fx.upsertAgentTask).not.toHaveBeenCalled();
    expect(lastSnapshot(fx)).toMatchObject({ action: "dispatch_agent", reason: "reviewer_dispatch_unavailable" });
  });

  it("an already-requested review counts as in motion", async () => {
    const fx = effects("cooling-down");
    const result = await runWorkroomDriveJob(NOW, { listRooms: async () => [room()], effects: fx, reviewStages: deps(context()) });
    expect(result.dispatched).toBe(1);
    expect(lastSnapshot(fx)).toMatchObject({ reason: "agent_stage", review: { outcome: "cooling-down" } });
  });

  it("no readable context or no owed route leaves the declared stage alone", async () => {
    for (const ctx of [null, context({ routes: [] })]) {
      const fx = effects();
      const result = await runWorkroomDriveJob(NOW, { listRooms: async () => [room()], effects: fx, reviewStages: deps(ctx) });
      expect(result.plans[0]).toMatchObject({ action: "attention", reason: "governed_decision" });
      expect(lastSnapshot(fx).pendingAttention).toMatchObject({ principalRef: "role:design-checklist-reviewer" });
    }
  });

  it("reads readiness for a bounded number of rooms per tick", async () => {
    const fx = effects();
    const reviewStages = deps(null);
    const rooms = Array.from({ length: REVIEW_STAGE_RESOLUTIONS_PER_TICK + 3 }, (_, index) => room(`WC-${index}`));
    await runWorkroomDriveJob(NOW, { listRooms: async () => rooms, effects: fx, reviewStages });
    expect(reviewStages.loadContext).toHaveBeenCalledTimes(REVIEW_STAGE_RESOLUTIONS_PER_TICK);
  });
});
