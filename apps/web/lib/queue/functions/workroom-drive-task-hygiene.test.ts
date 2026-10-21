// BI-1DDCE164 — a stage task runs only while the drive still wants it.
//
// Live, 2026-10-20/21: 553 build-specialist runs in 14 hours over 14 room-stages.
// Every room had either left the drive (Build Studio executor after #6391,
// archived) or advanced to an attention stage (spec-approval, merge). Their
// */15 tasks kept firing; each run re-verified a stage nobody would read again.

import { describe, expect, it, vi } from "vitest";

import { buildDispatchCheckpoint } from "@/lib/work-management/workroom-drive-checkpoint";
import { workroomDriveTaskId } from "@/lib/work-management/drive-resolution";
import { buildWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";
import { runWorkroomDriveJob, type WorkroomDriveEffects, type WorkroomDriveRoom } from "./workroom-drive";
import { deactivateUndrivenRoomTasks, taskLeftBehind, workItemKeyOf } from "./workroom-drive-data";

const SHAPE = "obligation-assurance-watch";

function room(over: Partial<WorkroomDriveRoom> = {}): WorkroomDriveRoom {
  return {
    id: "row-1", capsuleId: "WC-TEST",
    scopeClaims: [buildWorkShapeClaim({ key: SHAPE, version: "1.0.0" })],
    workspaceState: {}, leaseExpiresAt: null, leaseHolderPrincipalId: "prn-row-coord", ownerUserId: "user-1",
    participants: [{
      workroomId: "row-1", principalRef: "PRN-COORD", roles: ["coordinator"], assignmentSource: "explicit",
      enteredReason: null, currentWorkSummary: null, displayName: "Overseer", kind: "agent",
      sponsorPrincipalRef: null, sponsorDisplayName: null, authoritySummary: "Acts within process-coordination authority",
    }],
    currentStageKey: null, receipts: [], budgetUsage: [], stopConditionHits: [], reviewDue: false,
    substrateReachable: true, substrateEmpty: false,
    coordinatorEligibility: { jsi: "eligible", authorityBinding: "eligible" },
    ...over,
  };
}

function effects() {
  return {
    persist: vi.fn<WorkroomDriveEffects["persist"]>(async () => {}),
    acquireLease: vi.fn<WorkroomDriveEffects["acquireLease"]>(async () => "acquired"),
    upsertAgentTask: vi.fn<WorkroomDriveEffects["upsertAgentTask"]>(async () => true),
    deactivateAgentTask: vi.fn<WorkroomDriveEffects["deactivateAgentTask"]>(async () => {}),
  };
}

/** The room's record of the last enqueue: this room's task, at `stageKey`. */
function checkpointAt(stageKey: string, capsuleId = "WC-TEST") {
  return buildDispatchCheckpoint(null, {
    taskId: workroomDriveTaskId(capsuleId, SHAPE), roomId: "row-1", objective: null,
    stage: { shapeKey: SHAPE, shapeVersion: "1.0.0", stageKey, tools: [] },
    holderPrincipalId: null, leaseExpiresAt: "2026-09-01T00:30:00.000Z", now: "2026-09-01T00:00:00.000Z",
  });
}

// The registry shape's last stage is a governed human decision: a room whose
// earlier stages hold receipts concludes attention there.
const atHumanStage = (workspaceState: unknown) => room({
  currentStageKey: "raise",
  receipts: [{ stageKey: "sweep", kind: "assurance-run" }, { stageKey: "raise", kind: "assurance-finding" }],
  workspaceState,
});

describe("attention stops the task the drive dispatched for an earlier stage", () => {
  it("deactivates the room's task when its last enqueue was for a stage the room has left", async () => {
    const fx = effects();
    const result = await runWorkroomDriveJob(new Date(), {
      listRooms: async () => [atHumanStage({ workroomDispatchCheckpoint: checkpointAt("sweep") })], effects: fx,
    });
    expect(result.attention).toBe(1);
    expect(fx.deactivateAgentTask).toHaveBeenCalledWith(workroomDriveTaskId("WC-TEST", SHAPE));
  });

  it("leaves the task alone when attention is for the very stage it was enqueued for", async () => {
    // A same-stage dispatch later replays the recorded enqueue without touching
    // the task, so deactivating here could leave a wanted stage inactive.
    const probe = effects();
    await runWorkroomDriveJob(new Date(), { listRooms: async () => [atHumanStage({})], effects: probe });
    const attentionStage = String((probe.persist.mock.calls[0]?.[0]?.snapshot as { stageKey?: unknown }).stageKey);
    const fx = effects();
    const result = await runWorkroomDriveJob(new Date(), {
      listRooms: async () => [atHumanStage({ workroomDispatchCheckpoint: checkpointAt(attentionStage) })], effects: fx,
    });
    expect(result.attention).toBe(1);
    expect(fx.deactivateAgentTask).not.toHaveBeenCalled();
  });
});

describe("taskLeftBehind", () => {
  const planAt = (stageKey: string) => ({ shapeKey: SHAPE, stageKey });
  it("names the room's task only when its last enqueue was for another stage", () => {
    const state = { workroomDispatchCheckpoint: checkpointAt("sweep") };
    expect(taskLeftBehind({ capsuleId: "WC-TEST", workspaceState: state }, planAt("raise"))).toBe(workroomDriveTaskId("WC-TEST", SHAPE));
    expect(taskLeftBehind({ capsuleId: "WC-TEST", workspaceState: state }, planAt("sweep"))).toBeNull();
  });

  it("ignores another room's checkpoint, a missing checkpoint and a plan with no shape", () => {
    const foreign = { workroomDispatchCheckpoint: checkpointAt("sweep", "WC-OTHER") };
    expect(taskLeftBehind({ capsuleId: "WC-TEST", workspaceState: foreign }, planAt("raise"))).toBeNull();
    expect(taskLeftBehind({ capsuleId: "WC-TEST", workspaceState: {} }, planAt("raise"))).toBeNull();
    expect(taskLeftBehind({ capsuleId: "WC-TEST", workspaceState: { workroomDispatchCheckpoint: checkpointAt("sweep") } }, { shapeKey: null, stageKey: "raise" })).toBeNull();
  });
});

describe("deactivateUndrivenRoomTasks", () => {
  it("stops active workroom tasks of archived, terminal and Build Studio rooms in one statement", async () => {
    let query = "";
    let values: unknown[] = [];
    const count = await deactivateUndrivenRoomTasks({
      $executeRaw: async (parts: TemplateStringsArray, ...v: unknown[]) => { query = parts.join("?"); values = v; return 3; },
    });
    expect(count).toBe(3);
    expect(query).toMatch(/UPDATE "ScheduledAgentTask"/);
    expect(query).toMatch(/"isActive" = false/);
    expect(query).toMatch(/"isActive" = true/);
    expect(query).toMatch(/'workroom-' \|\| c\."capsuleId" \|\| '-%'/);
    expect(query).toMatch(/c\."archivedAt" IS NOT NULL/);
    expect(query).toMatch(/c\."executorKind" = 'build-studio'/);
    expect(values).toContainEqual(expect.arrayContaining(["abandoned", "archived", "complete"]));
  });

  it("reports zero rather than failing the tick when the write fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(deactivateUndrivenRoomTasks({ $executeRaw: async () => { throw new Error("db down"); } })).resolves.toBe(0);
    warn.mockRestore();
  });
});

describe("workItemKeyOf", () => {
  it("prefers a stored semantic key, then the workspace's recorded item, never a row id", () => {
    expect(workItemKeyOf({ backlogItemId: "BI-D30CD423", workspaceState: {} })).toBe("BI-D30CD423");
    expect(workItemKeyOf({ backlogItemId: "cmudmp3bl1ohd01ra1eeuvdse", workspaceState: { backlogItem: { itemId: "BI-725E605A" } } })).toBe("BI-725E605A");
    expect(workItemKeyOf({ backlogItemId: "cmudmp3bl1ohd01ra1eeuvdse", workspaceState: {} })).toBeNull();
    expect(workItemKeyOf({ backlogItemId: null, workspaceState: null })).toBeNull();
  });
});
