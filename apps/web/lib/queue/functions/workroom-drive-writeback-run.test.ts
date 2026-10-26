// The drive releases the writeback latch from what the room's task shows, and
// one room's failure no longer ends the tick for every room after it
// (BI-7C0B2BD6).
//
// Live on 2026-10-14: 279 rooms held on executor_writeback_unavailable, and 68
// rooms were never re-evaluated after midnight because six watch rooms threw
// "Recorded dispatch requires task identity reconciliation before replay" from
// scheduleWorkroomAgentTask and the throw ended the whole tick.

import { describe, expect, it, vi } from "vitest";

import { buildWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";
import type { StageRunObservation, WritebackRetry } from "@/lib/work-management/writeback-latch";
import { WRITEBACK_RETRY_BASE_MS, WRITEBACK_RETRY_LIMIT } from "@/lib/work-management/writeback-latch";

import { runWorkroomDriveJob, type WorkroomDriveEffects, type WorkroomDriveRoom } from "./workroom-drive";
import { stageRunFromTask } from "./workroom-drive-stage-run";

const NOW = new Date("2026-09-01T06:00:00.000Z");
const CYCLE = "obligation-assurance-watch@1.0.0:2026-09-01";
const TASK = (capsuleId: string) => `workroom-${capsuleId}-obligation-assurance-watch`;

function latchedSnapshot(over: Record<string, unknown> = {}) {
  return {
    kind: "workroom-drive", version: 1, action: "pause", reason: "executor_writeback_unavailable",
    stageKey: "sweep", taskId: null, lastRunAt: "2026-09-01T05:45:00.000Z", lastCycleKey: CYCLE, runKey: CYCLE,
    receipts: [{ stageKey: "sweep", kind: "blocked", runKey: CYCLE }], budgetUsage: [], stopConditionHits: [], reviewDue: false,
    ...over,
  };
}

function room(over: Partial<WorkroomDriveRoom> = {}): WorkroomDriveRoom {
  const id = over.id ?? "row-1";
  return {
    id,
    capsuleId: "WC-TEST",
    scopeClaims: [buildWorkShapeClaim({ key: "obligation-assurance-watch", version: "1.0.0" })],
    workspaceState: { workroomDrive: latchedSnapshot() },
    leaseExpiresAt: null,
    leaseHolderPrincipalId: "prn-row-coord",
    ownerUserId: "user-1",
    participants: [{
      workroomId: id, principalRef: "PRN-COORD", roles: ["coordinator"], assignmentSource: "explicit", enteredReason: null,
      currentWorkSummary: null, displayName: "Overseer", kind: "agent", sponsorPrincipalRef: null, sponsorDisplayName: null,
      authoritySummary: "Acts within process-coordination authority",
    }],
    currentStageKey: "sweep",
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
  return {
    persist: vi.fn<WorkroomDriveEffects["persist"]>(async () => {}),
    acquireLease: vi.fn<WorkroomDriveEffects["acquireLease"]>(async () => "acquired"),
    upsertAgentTask: vi.fn<WorkroomDriveEffects["upsertAgentTask"]>(async () => true),
    deactivateAgentTask: vi.fn<WorkroomDriveEffects["deactivateAgentTask"]>(async () => {}),
  };
}

const lastSnapshot = (fx: ReturnType<typeof effects>) => fx.persist.mock.calls.at(-1)?.[0]?.snapshot as Record<string, unknown>;
const run = (over: Partial<StageRunObservation> = {}): StageRunObservation => ({
  stageKey: "sweep", dispatchedAt: "2026-09-01T05:30:00.000Z", lastRunAt: null, lastStatus: null, lastError: null, ...over,
});

describe("writeback latch on the drive tick (BI-7C0B2BD6)", () => {
  it("a latched room with no task for its stage dispatches again", async () => {
    const fx = effects();
    const result = await runWorkroomDriveJob(NOW, { listRooms: async () => [room({ stageRun: null })], effects: fx });
    expect(result.dispatched).toBe(1);
    expect(fx.upsertAgentTask).toHaveBeenCalledTimes(1);
  });

  it("holds while the dispatched run is outstanding and leaves the task active", async () => {
    const fx = effects();
    const result = await runWorkroomDriveJob(NOW, { listRooms: async () => [room({ stageRun: run() })], effects: fx });
    expect(result.dispatched).toBe(0);
    expect(lastSnapshot(fx)).toMatchObject({ action: "pause", reason: "executor_writeback_unavailable" });
    expect(fx.deactivateAgentTask).not.toHaveBeenCalled();
  });

  it("a run that ended in error is retried after backoff as a new dispatch in the cycle", async () => {
    const fx = effects();
    const failed = run({ lastRunAt: "2026-09-01T05:40:00.000Z", lastStatus: "error", lastError: "No AI provider could take this turn" });
    const early = await runWorkroomDriveJob(new Date("2026-09-01T05:45:00.000Z"), { listRooms: async () => [room({ stageRun: failed })], effects: fx });
    expect(early.dispatched).toBe(0);
    expect(fx.deactivateAgentTask).toHaveBeenCalled();
    const held = lastSnapshot(fx);
    expect(held.writebackRetry).toMatchObject({ stageKey: "sweep", failures: 1, lastError: "No AI provider could take this turn" });

    const later = await runWorkroomDriveJob(new Date(Date.parse("2026-09-01T05:40:00.000Z") + WRITEBACK_RETRY_BASE_MS), {
      listRooms: async () => [room({ stageRun: failed, workspaceState: { workroomDrive: { ...latchedSnapshot(), writebackRetry: held.writebackRetry } } })],
      effects: fx,
    });
    expect(later.dispatched).toBe(1);
    // A new dispatch scope, so the scheduler re-queues and reactivates the task instead of replaying the old dispatch.
    expect(fx.upsertAgentTask.mock.calls.at(-1)?.[0]?.dispatchScope).toMatchObject({ cycleKey: CYCLE, iteration: 1 });
  });

  it(`after ${WRITEBACK_RETRY_LIMIT} failures the room stays paused and its ledger names the last error`, async () => {
    const fx = effects();
    const retry: WritebackRetry = { stageKey: "sweep", cycleKey: CYCLE, failures: WRITEBACK_RETRY_LIMIT - 1, lastError: "x",
      lastFailedAt: "2026-09-01T03:00:00.000Z", countedRunAt: "2026-09-01T03:00:00.000Z" };
    const failed = run({ lastRunAt: "2026-09-01T05:40:00.000Z", lastStatus: "error", lastError: "produced no governed work" });
    const result = await runWorkroomDriveJob(NOW, {
      listRooms: async () => [room({ stageRun: failed, workspaceState: { workroomDrive: { ...latchedSnapshot(), writebackRetry: retry } } })],
      effects: fx,
    });
    expect(result.dispatched).toBe(0);
    const snapshot = lastSnapshot(fx);
    expect(snapshot).toMatchObject({ action: "pause", reason: "executor_writeback_unavailable" });
    expect(String((snapshot.ledger as string[])[0])).toMatch(/produced no governed work/);
    expect(snapshot.writebackRetry).toMatchObject({ failures: WRITEBACK_RETRY_LIMIT });
    expect(fx.persist.mock.calls.at(-1)?.[0]?.summary).toMatch(/produced no governed work/);
  });
});

describe("one room cannot end the tick for the rest (BI-7C0B2BD6)", () => {
  it("a throw while driving one room is recorded and later rooms are still driven", async () => {
    const fx = effects();
    fx.upsertAgentTask.mockImplementation(async (input) => {
      if (input.taskId === TASK("WC-BAD")) throw new Error("Recorded dispatch requires task identity reconciliation before replay");
      return true;
    });
    const fresh = { workspaceState: {}, currentStageKey: null };
    const result = await runWorkroomDriveJob(NOW, {
      listRooms: async () => [room({ id: "row-bad", capsuleId: "WC-BAD", ...fresh }), room({ id: "row-good", capsuleId: "WC-GOOD", ...fresh })],
      effects: fx,
    });
    expect(result.scanned).toBe(2);
    expect(result.dispatched).toBe(1);
    expect(result.plans).toEqual(expect.arrayContaining([
      expect.objectContaining({ roomId: "WC-BAD", action: "error", reason: expect.stringMatching(/task identity reconciliation/) }),
      expect.objectContaining({ roomId: "WC-GOOD", action: "dispatch_agent" }),
    ]));
  });
});

describe("per-tick dispatch cap (BI-7C0B2BD6, DI-7109D22D4812)", () => {
  it("dispatches up to the capacity and records the rest as waiting for agent capacity, oldest-waiting first", async () => {
    const fx = effects();
    const waiting = (since: string) => ({ workroomDrive: { ...latchedSnapshot(), hold: { key: "k", since, ticks: 1, stuckSince: null, stuckTicks: 0, notifiedAt: null } } });
    const result = await runWorkroomDriveJob(NOW, {
      listRooms: async () => [
        room({ id: "row-late", capsuleId: "WC-LATE", stageRun: null, workspaceState: waiting("2026-09-01T05:00:00.000Z") }),
        room({ id: "row-early", capsuleId: "WC-EARLY", stageRun: null, workspaceState: waiting("2026-09-01T01:00:00.000Z") }),
      ],
      effects: fx,
      dispatchCapacity: async () => ({ cap: 1, reason: "agent pools healthy" }),
    });
    expect(result.dispatched).toBe(1);
    expect(fx.upsertAgentTask.mock.calls[0]?.[0]?.taskId).toBe(TASK("WC-EARLY"));
    const capped = fx.persist.mock.calls.find((call) => call[0].roomId === "row-late")?.[0]?.snapshot as Record<string, unknown>;
    expect(capped).toMatchObject({ action: "do_not_wake", reason: "awaiting_agent_capacity" });
    expect(capped.conclusion).toMatchObject({ kind: "in-motion" });
    expect(String((capped.ledger as string[])[0])).toMatch(/waiting for agent capacity/i);
  });
});

describe("stageRunFromTask (BI-7C0B2BD6)", () => {
  const checkpoint = (taskId: string) => ({
    version: 1, revision: 1, roomId: "row-1", objective: null, remainingAcceptance: null, artifacts: null, dirtyOutputs: null,
    pendingIntent: null, confirmedEffect: { kind: "scheduled-task-enqueued", taskId, recordedAt: "2026-09-01T05:30:00.000Z" },
    stage: { shapeKey: "obligation-assurance-watch", shapeVersion: "1.0.0", stageKey: "sweep", tools: [] },
    authority: { holderPrincipalId: null, leaseExpiresAt: "2026-09-01T05:40:00.000Z" }, nextAction: "reconcile-scheduled-task",
  });
  const task = { taskId: TASK("WC-TEST"), lastRunAt: new Date("2026-09-01T05:41:00.000Z"), lastStatus: "error", lastError: "boom", taskConfig: {} };

  it("is null when the task does not exist", () => {
    expect(stageRunFromTask({ taskId: TASK("WC-TEST"), task: null, roomWorkspaceState: {} })).toBeNull();
  });

  it("reads the queue time and stage from the room's checkpoint for this task", () => {
    expect(stageRunFromTask({ taskId: TASK("WC-TEST"), task, roomWorkspaceState: { workroomDispatchCheckpoint: checkpoint(TASK("WC-TEST")) } }))
      .toEqual({ stageKey: "sweep", dispatchedAt: "2026-09-01T05:30:00.000Z", lastRunAt: "2026-09-01T05:41:00.000Z", lastStatus: "error", lastError: "boom" });
  });

  it("ignores a checkpoint for another task, so the queue time reads unknown", () => {
    expect(stageRunFromTask({ taskId: TASK("WC-TEST"), task, roomWorkspaceState: { workroomDispatchCheckpoint: checkpoint("other") } })?.dispatchedAt).toBeNull();
  });
});

describe("provider-held rooms preserve dispatch capacity (BI-9CD95438)", () => {
  const hold = { since: "2026-08-31T00:00:00.000Z", kind: "rate-limit", taskId: "held-task", error: "provider unavailable" };
  const freshRoom = (id: string, workspaceState: Record<string, unknown> = {}) =>
    room({ id: `row-${id}`, capsuleId: `WC-${id}`, currentStageKey: null, workspaceState });
  const snapshotFor = (fx: ReturnType<typeof effects>, id: string) =>
    fx.persist.mock.calls.find((call) => call[0].roomId === `row-${id}`)?.[0]?.snapshot;

  it("leaves four held rooms paused while eligible rooms use only the available slots", async () => {
    const fx = effects();
    const heldRooms = ["A1", "A2", "A3", "A4"].map((id) => freshRoom(id, { queueHold: { ...hold } }));
    const before = structuredClone(heldRooms.map((held) => held.workspaceState));
    const result = await runWorkroomDriveJob(NOW, {
      listRooms: async () => [freshRoom("D"), ...heldRooms, freshRoom("C"), freshRoom("B")],
      effects: fx,
      dispatchCapacity: async () => ({ cap: 2, reason: "two available slots" }),
    });

    expect(result.dispatched).toBe(2);
    expect(fx.upsertAgentTask.mock.calls.map(([task]) => task.taskId)).toEqual([TASK("WC-B"), TASK("WC-C")]);
    expect(fx.acquireLease.mock.calls.map(([lease]) => lease.roomId)).toEqual(["row-B", "row-C"]);
    for (const id of ["A1", "A2", "A3", "A4"]) {
      expect(snapshotFor(fx, id)).toMatchObject({ reason: "provider_held" });
    }
    expect(snapshotFor(fx, "D")).toMatchObject({ action: "do_not_wake", reason: "awaiting_agent_capacity" });
    expect(heldRooms.map((held) => held.workspaceState)).toEqual(before);
  });

  it("keeps the provider hold visible even when earlier eligible work used the cap", async () => {
    const fx = effects();
    await runWorkroomDriveJob(NOW, {
      listRooms: async () => [freshRoom("Z-HELD", { queueHold: { ...hold } }), freshRoom("A-ELIGIBLE")],
      effects: fx,
      dispatchCapacity: async () => ({ cap: 1, reason: "one available slot" }),
    });

    expect(snapshotFor(fx, "Z-HELD")).toMatchObject({ reason: "provider_held" });
    expect(fx.upsertAgentTask.mock.calls.map(([task]) => task.taskId)).toEqual([TASK("WC-A-ELIGIBLE")]);
    expect(fx.acquireLease).toHaveBeenCalledTimes(1);
  });

  it("uses the canonical hold reader so malformed data does not bypass the cap", async () => {
    const fx = effects();
    await runWorkroomDriveJob(NOW, {
      listRooms: async () => [freshRoom("A", { queueHold: { since: hold.since } }), freshRoom("B")],
      effects: fx,
      dispatchCapacity: async () => ({ cap: 1, reason: "one available slot" }),
    });

    expect(fx.upsertAgentTask.mock.calls.map(([task]) => task.taskId)).toEqual([TASK("WC-A")]);
    expect(snapshotFor(fx, "B")).toMatchObject({ action: "do_not_wake", reason: "awaiting_agent_capacity" });
  });

  it("counts a formerly held room normally on a later tick after its hold is removed", async () => {
    const fx = effects();
    const candidate = freshRoom("A", { queueHold: { ...hold } });
    const listRooms = async () => [candidate, freshRoom("B")];
    const dispatchCapacity = async () => ({ cap: 1, reason: "one available slot" });
    await runWorkroomDriveJob(NOW, { listRooms, effects: fx, dispatchCapacity });
    expect(fx.upsertAgentTask.mock.calls.map(([task]) => task.taskId)).toEqual([TASK("WC-B")]);

    candidate.workspaceState = {};
    fx.upsertAgentTask.mockClear();
    fx.acquireLease.mockClear();
    fx.persist.mockClear();
    await runWorkroomDriveJob(new Date(NOW.getTime() + 60_000), { listRooms, effects: fx, dispatchCapacity });

    expect(fx.upsertAgentTask.mock.calls.map(([task]) => task.taskId)).toEqual([TASK("WC-A")]);
    expect(snapshotFor(fx, "B")).toMatchObject({ action: "do_not_wake", reason: "awaiting_agent_capacity" });
  });
});
