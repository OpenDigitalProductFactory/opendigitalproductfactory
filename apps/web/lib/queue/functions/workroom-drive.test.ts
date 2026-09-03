import { describe, expect, it, vi } from "vitest";

import { buildWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";
import { buildWorkroomPostureClaim } from "@/lib/work-management/workroom-posture-claim";
import { workroomDriveTaskId } from "@/lib/work-management/drive-resolution";
import {
  applyDrivePlan,
  runWorkroomDriveJob,
  type WorkroomDriveEffects,
  type WorkroomDriveRoom,
} from "./workroom-drive";
import { resolveDrivePlan } from "@/lib/work-management/drive-resolution";
import { readWorkShapeDefinitionContract, getWorkShape } from "@/lib/work-management/work-shapes";

function coordinatorAssignment(workroomId: string) {
  return {
    workroomId,
    principalRef: "PRN-COORD",
    roles: ["coordinator" as const],
    assignmentSource: "explicit" as const,
    enteredReason: null,
    currentWorkSummary: null,
    displayName: "Overseer",
    kind: "agent" as const,
    sponsorPrincipalRef: null,
    sponsorDisplayName: null,
    authoritySummary: "Acts within process-coordination authority",
  };
}

function room(over: Partial<WorkroomDriveRoom> = {}): WorkroomDriveRoom {
  return {
    id: "row-1",
    capsuleId: "WC-TEST",
    scopeClaims: [buildWorkShapeClaim({ key: "obligation-assurance-watch", version: "1.0.0" })],
    workspaceState: {},
    leaseExpiresAt: null,
    leaseHolderPrincipalId: "prn-row-coord",
    ownerUserId: "user-1",
    participants: [coordinatorAssignment("row-1")],
    currentStageKey: null,
    receipts: [],
    budgetUsage: [],
    stopConditionHits: [],
    reviewDue: false,
    substrateReachable: true,
    substrateEmpty: false,
    coordinatorEligibility: { jsi: "eligible", authorityBinding: "eligible" },
    ...over,
  };
}

function effects() {
  const persist = vi.fn<WorkroomDriveEffects["persist"]>(async () => {});
  const acquireLease = vi.fn<WorkroomDriveEffects["acquireLease"]>(async () => "acquired");
  const upsertAgentTask = vi.fn<WorkroomDriveEffects["upsertAgentTask"]>(async () => {});
  const deactivateAgentTask = vi.fn<WorkroomDriveEffects["deactivateAgentTask"]>(async () => {});
  return { persist, acquireLease, upsertAgentTask, deactivateAgentTask };
}

describe("runWorkroomDriveJob (BI-FCD639D9)", () => {
  it("does not wake a quiet room and deactivates its deterministic task", async () => {
    const fx = effects();
    const quiet = room({
      scopeClaims: [
        buildWorkShapeClaim({ key: "obligation-assurance-watch", version: "1.0.0" }),
        buildWorkroomPostureClaim({ proactivityLevel: "quiet" }),
      ],
    });
    const result = await runWorkroomDriveJob(new Date("2026-09-01T00:00:00.000Z"), {
      listRooms: async () => [quiet],
      effects: fx,
    });
    expect(result.dispatched).toBe(0);
    expect(result.skipped).toBe(1);
    expect(fx.upsertAgentTask).not.toHaveBeenCalled();
    expect(fx.deactivateAgentTask).toHaveBeenCalledWith(
      workroomDriveTaskId("WC-TEST", "obligation-assurance-watch"),
    );
  });

  it("acquires a lease then upserts the same task id on retry", async () => {
    const fx = effects();
    const now = new Date("2026-09-01T00:00:00.000Z");
    const first = await runWorkroomDriveJob(now, { listRooms: async () => [room()], effects: fx });
    const second = await runWorkroomDriveJob(now, { listRooms: async () => [room()], effects: fx });
    expect(first.dispatched).toBe(1);
    expect(second.dispatched).toBe(1);
    expect(fx.acquireLease).toHaveBeenCalledTimes(2);
    expect(fx.upsertAgentTask.mock.calls.map((call) => call[0]?.taskId)).toEqual([
      workroomDriveTaskId("WC-TEST", "obligation-assurance-watch"),
      workroomDriveTaskId("WC-TEST", "obligation-assurance-watch"),
    ]);
    expect(fx.persist.mock.calls[0]?.[0]?.snapshot).toMatchObject({
      conformance: {
        disposition: "continue",
        reconciliationKey: expect.stringMatching(/^work-room-conformance:/),
      },
    });
  });

  it("leaves the stage eligible when a live lease is still held", async () => {
    const fx = effects();
    fx.acquireLease.mockResolvedValue("held");
    const result = await runWorkroomDriveJob(new Date(), {
      listRooms: async () => [room({ leaseExpiresAt: new Date("2099-01-01T00:00:00.000Z") })],
      effects: fx,
    });
    expect(result.dispatched).toBe(0);
    expect(result.skipped).toBe(1);
    expect(fx.upsertAgentTask).not.toHaveBeenCalled();
    expect(fx.persist.mock.calls[0]?.[0]?.summary).toMatch(/lease held/i);
  });

  it("records attention for a human stage and never schedules an agent task", async () => {
    const fx = effects();
    const human = room({
      currentStageKey: "raise",
      receipts: [
        { stageKey: "sweep", kind: "assurance-run" },
        { stageKey: "raise", kind: "assurance-finding" },
      ],
    });
    // The registry shape's last stage is role:compliance-owner / governed-decision.
    const result = await runWorkroomDriveJob(new Date(), {
      listRooms: async () => [human],
      effects: fx,
    });
    expect(result.attention).toBe(1);
    expect(result.dispatched).toBe(0);
    expect(fx.upsertAgentTask).not.toHaveBeenCalled();
    expect(fx.persist.mock.calls[0]?.[0]?.activityKind).toBe("workroom-drive-attention");
  });
});

describe("applyDrivePlan lease expiry", () => {
  it("treats an expired lease as acquirable", async () => {
    const shape = getWorkShape("obligation-assurance-watch");
    expect(shape).not.toBeNull();
    const plan = resolveDrivePlan({
      roomId: "WC-TEST",
      definition: readWorkShapeDefinitionContract(shape!),
      collaborationShape: shape!.collaborationShape,
      postureLevel: "balanced",
      participants: [],
      currentStageKey: null,
      receipts: [],
      budgetUsage: [],
      stopConditionHits: [],
      reviewDue: false,
      substrateReachable: true,
      substrateEmpty: false,
      coordinatorHasProcessCoordinationAuthority: true,
    });
    // Without an explicit coordinator the plan will not dispatch — this test
    // only asserts the expired-lease branch of applyDrivePlan, so force a
    // dispatch-shaped plan through the lease effect.
    const fx = effects();
    const expired = room({ leaseExpiresAt: new Date("2020-01-01T00:00:00.000Z") });
    const outcome = await applyDrivePlan({
      room: expired,
      plan: {
        ...plan,
        action: "dispatch_agent",
        reason: "agent_stage",
        taskId: workroomDriveTaskId("WC-TEST", "obligation-assurance-watch"),
        agentId: "compliance-officer",
        stageKey: "sweep",
      },
      now: new Date("2026-09-01T00:00:00.000Z"),
      effects: fx,
    });
    expect(outcome).toBe("dispatched");
    expect(fx.acquireLease).toHaveBeenCalled();
  });
});
