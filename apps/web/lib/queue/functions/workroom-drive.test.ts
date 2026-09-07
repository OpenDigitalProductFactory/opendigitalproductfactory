import { describe, expect, it, vi } from "vitest";

import { buildWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";
import { buildWorkroomPostureClaim } from "@/lib/work-management/workroom-posture-claim";
import { workroomDriveTaskId } from "@/lib/work-management/drive-resolution";
import {
  applyDrivePlan,
  createWorkroomDriveEffects,
  runWorkroomDriveJob,
  type WorkroomDriveEffects,
  type WorkroomDriveRoom,
} from "./workroom-drive";
import { resolveDrivePlan } from "@/lib/work-management/drive-resolution";
import { readWorkShapeDefinitionContract, getWorkShape } from "@/lib/work-management/work-shapes";

const driveDb = {
  workroom: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  workroomActivity: { create: vi.fn() },
  scheduledAgentTask: { upsert: vi.fn() },
  $transaction: vi.fn(),
};

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
  const upsertAgentTask = vi.fn<WorkroomDriveEffects["upsertAgentTask"]>(async () => true);
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

  it("contains delivery notification reconciliation failure after preserving the drive result", async () => {
    const fx = effects();
    const reconcileNotifications = vi.fn().mockRejectedValue(new Error("notification unavailable"));
    await expect(runWorkroomDriveJob(new Date(), {
      listRooms: async () => [room()],
      effects: fx,
      reconcileNotifications,
    })).resolves.toMatchObject({ scanned: 1, dispatched: 1 });
    expect(reconcileNotifications).toHaveBeenCalledTimes(1);
  });
});

describe("applyDrivePlan lease expiry", () => {
  function persistedLease(status = "ready") {
    const persisted = { expiresAt: null as Date | null, holder: "prn-row-coord", status };
    driveDb.scheduledAgentTask.upsert.mockReset().mockResolvedValue({});
    driveDb.$transaction.mockImplementation(async (run) => run(driveDb));
    driveDb.workroom.findUnique.mockResolvedValue({ workspaceState: {} });
    driveDb.workroomActivity.create.mockResolvedValue({ id: "activity-1" });
    driveDb.workroom.update.mockImplementation(async ({ data }) => {
      if (data.leaseExpiresAt) persisted.expiresAt = data.leaseExpiresAt;
      return {};
    });
    driveDb.workroom.updateMany.mockImplementation(async ({ where, data }) => {
      if (("leaseExpiresAt" in where && where.leaseExpiresAt !== persisted.expiresAt)
        || ("leaseHolderPrincipalId" in where && where.leaseHolderPrincipalId !== persisted.holder)
        || where.status?.notIn?.includes(persisted.status)) return { count: 0 };
      if (data.leaseExpiresAt) persisted.expiresAt = data.leaseExpiresAt;
      return { count: 1 };
    });
    return { ...createWorkroomDriveEffects(async () => driveDb as never, () => new Date("2026-09-01T00:00:00.000Z")), persist: vi.fn(async () => {}), state: persisted };
  }

  it("admits only one dispatch when scheduled and manual drivers read the same expired lease", async () => {
    const fx = persistedLease();
    const now = new Date("2026-09-01T00:00:00.000Z");
    const runs = await Promise.all([
      runWorkroomDriveJob(now, { listRooms: async () => [room()], effects: fx }),
      runWorkroomDriveJob(now, { listRooms: async () => [room()], effects: fx }),
    ]);
    expect(runs.reduce((count, run) => count + run.dispatched, 0)).toBe(1);
    expect(driveDb.scheduledAgentTask.upsert).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch a room that completed after the driver loaded it", async () => {
    const fx = persistedLease("complete");
    const result = await runWorkroomDriveJob(new Date("2026-09-01T00:00:00.000Z"), {
      listRooms: async () => [room()],
      effects: fx,
    });
    expect(result.dispatched).toBe(0);
    expect(driveDb.scheduledAgentTask.upsert).not.toHaveBeenCalled();
  });

  it("fences scheduling when ownership changes after acquisition", async () => {
    const fx = persistedLease();
    const acquire = fx.acquireLease;
    fx.acquireLease = async (input) => {
      const result = await acquire(input);
      fx.state.holder = "replacement-worker";
      return result;
    };
    const result = await runWorkroomDriveJob(new Date("2026-09-01T00:00:00.000Z"), {
      listRooms: async () => [room()], effects: fx,
    });
    expect(result.dispatched).toBe(0);
    expect(driveDb.scheduledAgentTask.upsert).not.toHaveBeenCalled();
  });

  it("does not overwrite a concurrent room update or publish an uncommitted snapshot", async () => {
    persistedLease();
    let workspace: Record<string, unknown> = { existing: true };
    driveDb.workroom.findUnique.mockImplementation(async () => {
      const read = workspace;
      workspace = { ...workspace, concurrent: true };
      return { workspaceState: read, updatedAt: new Date("2026-09-01T00:00:00.000Z") };
    });
    driveDb.workroom.update.mockImplementation(async ({ data }) => { workspace = data.workspaceState; return {}; });
    driveDb.workroom.updateMany.mockResolvedValue({ count: 0 });
    driveDb.workroomActivity.create.mockClear();
    await createWorkroomDriveEffects(async () => driveDb as never).persist({
      roomId: "row-1", snapshot: { stageKey: "sweep" }, activityKind: "verification",
      summary: "Stage observed", payload: {},
    });
    expect(workspace.concurrent).toBe(true);
    expect(driveDb.workroomActivity.create).not.toHaveBeenCalled();
  });

  it("does not publish a dispatch snapshot after the lease holder changes", async () => {
    const fx = persistedLease();
    const expiry = new Date("2026-09-01T00:05:00.000Z");
    fx.state.expiresAt = expiry;
    fx.state.holder = "replacement-worker";
    driveDb.workroomActivity.create.mockClear();
    await createWorkroomDriveEffects(async () => driveDb as never).persist({
      roomId: "row-1", snapshot: { stageKey: "sweep" }, activityKind: "verification",
      summary: "Stage observed", payload: {}, lease: { expiresAt: expiry, holderPrincipalId: "prn-row-coord" },
    });
    expect(driveDb.workroomActivity.create).not.toHaveBeenCalled();
  });

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
