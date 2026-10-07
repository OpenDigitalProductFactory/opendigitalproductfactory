import { beforeEach, describe, expect, it, vi } from "vitest";

import { PARALLEL_FIXTURE } from "@/lib/work-management/__fixtures__/graph-shape-fixtures";
import type { RecordedEvidence } from "@/lib/work-management/stage-evidence-receipts";
import { readStoredWorkroomDriveState } from "@/lib/work-management/workroom-drive-state";
import { mergeWorkroomDriveSnapshot } from "@/lib/work-management/workroom-drive-snapshot-merge";
import { workroomDriveBranchTaskId } from "@/lib/work-management/drive-resolution";

import { buildWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";
import { buildWorkroomPostureClaim } from "@/lib/work-management/workroom-posture-claim";
import { workroomDriveTaskId } from "@/lib/work-management/drive-resolution";
import {
  applyDrivePlan,
  createWorkroomDriveEffects,
  loadStandingRoomIds,
  runWorkroomDriveJob,
  type WorkroomDriveEffects,
  type WorkroomDriveRoom,
} from "./workroom-drive";
import { resolveDrivePlan } from "@/lib/work-management/drive-resolution";
import { readWorkShapeDefinitionContract, getWorkShape } from "@/lib/work-management/work-shapes";

// Parallel branches (GPP Phase 3c PR-3c-2): the graph fixture is not
// registered (plan constraint 7), so the shape-claim resolver is overridden
// for its key only; every registry shape resolves exactly as before. The
// executable-construct table is a mutable copy so a case can switch the
// parallel flag off (the kill switch); it starts as the real table.
const flags = vi.hoisted(() => ({ table: {} as Record<string, boolean>, original: {} as Record<string, boolean> }));
vi.mock("@/lib/gpp/shape-language/executable-constructs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gpp/shape-language/executable-constructs")>();
  flags.original = { ...actual.CONSTRUCT_EXECUTABLE };
  flags.table = { ...actual.CONSTRUCT_EXECUTABLE };
  return { ...actual, CONSTRUCT_EXECUTABLE: flags.table };
});
vi.mock("@/lib/work-management/workroom-shape-claim", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/work-management/workroom-shape-claim")>();
  const { PARALLEL_FIXTURE: fixture } = await import("@/lib/work-management/__fixtures__/graph-shape-fixtures");
  return {
    ...actual,
    resolveWorkShapeClaim: (scopeClaims: unknown) => {
      const ref = actual.readWorkShapeClaim(scopeClaims);
      return ref?.key === fixture.key && ref.version === fixture.version ? fixture : actual.resolveWorkShapeClaim(scopeClaims);
    },
  };
});

const driveDb = {
  workroom: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  workroomActivity: { create: vi.fn() },
  scheduledAgentTask: { upsert: vi.fn(), findUnique: vi.fn() },
  $transaction: vi.fn(),
};

it("normalizes legacy object and malformed scope carriers before expanding SQL candidates", async () => {
  let query = "";
  await loadStandingRoomIds({
    $queryRaw: async (parts) => { query = parts.join("?"); return []; },
  });
  // PostgreSQL throws on jsonb_array_elements(object/scalar). A WHERE filter
  // outside the function cannot protect against planner evaluation order.
  expect(query).toMatch(/jsonb_array_elements\(\s*CASE\s+jsonb_typeof\("scopeClaims"\)/i);
  expect(query).toMatch(/WHEN 'array' THEN "scopeClaims"/);
  expect(query).toMatch(/WHEN 'object' THEN jsonb_build_array\("scopeClaims"\)/);
  expect(query).toMatch(/ELSE '\[\]'::jsonb/);
});

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

  it("does not re-dispatch the same agent stage when the prior tick produced no completing receipt", async () => {
    const fx = effects();
    const now = new Date("2026-09-01T00:00:00.000Z");
    const first = await runWorkroomDriveJob(now, { listRooms: async () => [room()], effects: fx });
    expect(first.dispatched).toBe(1);
    expect(String(fx.upsertAgentTask.mock.calls[0]?.[0]?.prompt)).toMatch(/record_workroom_evidence/);
    const snapshot = fx.persist.mock.calls[0]?.[0]?.snapshot as Record<string, unknown>;
    expect(snapshot.action).toBe("dispatch_agent");
    const second = await runWorkroomDriveJob(now, {
      listRooms: async () => [room({
        workspaceState: { workroomDrive: snapshot },
        currentStageKey: typeof snapshot.stageKey === "string" ? snapshot.stageKey : "sweep",
      })],
      effects: fx,
    });
    expect(second.dispatched).toBe(0);
    expect(second.skipped).toBe(1);
    expect(fx.upsertAgentTask).toHaveBeenCalledTimes(1);
    const secondSnapshot = fx.persist.mock.calls.at(-1)?.[0]?.snapshot as Record<string, unknown>;
    expect(secondSnapshot).toMatchObject({
      action: "pause",
      reason: "executor_writeback_unavailable",
    });
    expect(secondSnapshot.receipts).toEqual(
      expect.arrayContaining([{ stageKey: snapshot.stageKey, kind: "blocked" }]),
    );
  });

  it("persists earned evidence so the following tick retains prerequisite receipts", async () => {
    const fx = effects();
    const current = room({ currentStageKey: "sweep", receipts: [{ stageKey: "sweep", kind: "blocked" }],
      stageDispatchedAt: new Date("2026-09-01T00:00:00Z"),
      recordedEvidence: [{ stageKey: "sweep", kind: "assurance-run", outcome: "completed", recordedAt: new Date("2026-09-01T00:01:00Z") }],
    });
    await runWorkroomDriveJob(new Date("2026-09-01T00:02:00Z"), { listRooms: async () => [current], effects: fx });
    const snapshot = fx.persist.mock.calls.at(-1)?.[0]?.snapshot as Record<string, unknown>;
    expect(snapshot.receipts).toEqual([{ stageKey: "sweep", kind: "stage-evidence-recorded" }]);
    expect(snapshot.stageKey).toBe("raise");
    await runWorkroomDriveJob(new Date("2026-09-01T00:03:00Z"), { listRooms: async () => [room({ workspaceState: { workroomDrive: snapshot } })], effects: fx });
    expect(fx.persist.mock.calls.at(-1)?.[0]?.snapshot.receipts).toEqual(expect.arrayContaining([{ stageKey: "sweep", kind: "stage-evidence-recorded" }]));
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
    driveDb.scheduledAgentTask.findUnique.mockReset().mockResolvedValue(null);
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

  it("preserves a completing receipt written after planning but before persistence", async () => {
    persistedLease();
    driveDb.workroom.findUnique.mockResolvedValue({
      workspaceState: { workroomDrive: { lastCycleKey: "cycle-1", receipts: [{ stageKey: "sweep", kind: "findings" }] } },
      updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    driveDb.workroom.updateMany.mockResolvedValue({ count: 1 });
    await createWorkroomDriveEffects(async () => driveDb as never).persist({
      roomId: "row-1", snapshot: { lastCycleKey: "cycle-1", stageKey: "sweep", receipts: [{ stageKey: "sweep", kind: "blocked" }] },
      activityKind: "verification", summary: "Stage observed", payload: {},
    });
    expect(driveDb.workroom.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: { workspaceState: { workroomDrive: expect.objectContaining({ receipts: [{ stageKey: "sweep", kind: "findings" }] }) } },
    }));
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

// BI-E8C78E80 — a tick that changed nothing updates the snapshot but adds no
// trail row, and a room stuck for an hour tells its owner once.
describe("applyDrivePlan hold", () => {
  const plan = (over: Record<string, unknown> = {}) => ({
    action: "pause", reason: "conformance_pause", roomId: "row-1", shapeKey: null, shapeVersion: null,
    definition: null, stageKey: "spec", accountablePrincipalRef: null, agentId: null, attentionPrincipalRef: null,
    taskId: null, conformance: { deviations: [{ code: "missing_explicit_coordinator" }] }, cycle: null,
    deviations: [], ledger: [], ...over,
  }) as unknown as Parameters<typeof applyDrivePlan>[0]["plan"];

  it("records the first tick of a hold and keeps the repeats quiet", async () => {
    const fx = effects();
    await applyDrivePlan({ room: room(), plan: plan(), now: new Date("2026-09-24T00:00:00Z"), effects: fx });
    const stored = fx.persist.mock.calls[0][0].snapshot;
    expect(fx.persist.mock.calls[0][0].quiet).toBe(false);
    await applyDrivePlan({ room: room({ workspaceState: { workroomDrive: stored } }), plan: plan(),
      now: new Date("2026-09-24T00:15:00Z"), effects: fx });
    expect(fx.persist.mock.calls[1][0]).toMatchObject({ quiet: true, snapshot: { hold: { ticks: 2 } } });
  });

  it("tells the owner once after an hour stuck, and not again in the same spell", async () => {
    const notifyStall = vi.fn(async () => {});
    const fx = { ...effects(), notifyStall };
    let state: unknown = {};
    for (let i = 0; i < 6; i++) {
      await applyDrivePlan({ room: room({ workspaceState: state }), plan: plan(),
        now: new Date(Date.UTC(2026, 8, 24, 0, 15 * i)), effects: fx });
      state = { workroomDrive: fx.persist.mock.calls.at(-1)?.[0].snapshot };
    }
    expect(notifyStall).toHaveBeenCalledTimes(1);
    expect(notifyStall).toHaveBeenCalledWith(expect.objectContaining({ hold: expect.objectContaining({ stuckTicks: 4 }) }));
  });
});

// BI-43C3E914 — a stage names the tools it needs (GPP element 2 "Attachment",
// element 5 "Capability set"), and the drive carries them to the run.
describe("stage-declared tools reach the dispatched task", () => {
  const declaredRoom = () => room({
    scopeClaims: [buildWorkShapeClaim({ key: "dependency-advisory-watch", version: "1.0.0" })],
  });

  it("passes a declared stage's tools to the task and names them in the brief", async () => {
    const fx = effects();
    const result = await runWorkroomDriveJob(new Date("2026-09-01T00:00:00.000Z"), {
      listRooms: async () => [declaredRoom()],
      effects: fx,
    });
    expect(result.dispatched).toBe(1);
    const call = fx.upsertAgentTask.mock.calls[0]?.[0];
    expect(call?.stage).toEqual({
      shapeKey: "dependency-advisory-watch",
      shapeVersion: "1.0.0",
      stageKey: "sweep",
      tools: ["read_codebase_manifest", "list_patch_posture"],
    });
    expect(call?.prompt).toContain("Tools for this stage: read_codebase_manifest, list_patch_posture.");
  });

  it("leaves an undeclared stage exactly as before: no tools, no tools line", async () => {
    const fx = effects();
    // obligation-assurance-watch/sweep is on KNOWN_STAGE_TOOL_GAPS.
    await runWorkroomDriveJob(new Date("2026-09-01T00:00:00.000Z"), {
      listRooms: async () => [room()],
      effects: fx,
    });
    const call = fx.upsertAgentTask.mock.calls[0]?.[0];
    expect(call?.stage.tools).toEqual([]);
    expect(call?.stage.stageKey).toBe("sweep");
    expect(call?.prompt).not.toContain("Tools for this stage");
  });

  it("writes the stage record to taskConfig.workroomStage, preserving other taskConfig keys", async () => {
    driveDb.$transaction.mockImplementation(async (run) => run(driveDb));
    driveDb.workroom.updateMany.mockResolvedValue({ count: 1 });
    driveDb.scheduledAgentTask.upsert.mockReset().mockResolvedValue({});
    driveDb.scheduledAgentTask.findUnique.mockReset().mockResolvedValue({
      taskConfig: { trigger: { kind: "time", recordedAt: "2026-08-01T00:00:00.000Z" } },
    });
    const fx = createWorkroomDriveEffects(async () => driveDb as never, () => new Date("2026-09-01T00:00:00.000Z"));
    const stage = { shapeKey: "dependency-advisory-watch", shapeVersion: "1.0.0", stageKey: "sweep", tools: ["read_codebase_manifest"] };
    await expect(fx.upsertAgentTask({
      taskId: "task-1",
      agentId: "security-engineer",
      ownerUserId: "user-1",
      title: "t",
      prompt: "p",
      stage,
      now: new Date("2026-09-01T00:00:00.000Z"),
      lease: { roomId: "row-1", expiresAt: new Date("2026-09-01T00:10:00.000Z"), holderPrincipalId: null },
    })).resolves.toBe(true);
    const args = driveDb.scheduledAgentTask.upsert.mock.calls[0]?.[0];
    const expected = {
      trigger: { kind: "time", recordedAt: "2026-08-01T00:00:00.000Z" },
      workroomStage: stage,
    };
    expect(args?.create?.taskConfig).toEqual(expected);
    expect(args?.update?.taskConfig).toEqual(expected);
  });
});

// AC-3C-BRANCH-LATCH and per-branch tasks (GPP Phase 3c PR-3c-2, BI-8875C9DF).
// Design: docs/superpowers/specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md
// §6 ("Dispatch every tick"), §6.1 ("Own risk"); plan PR-3c-2 (workroom-drive.test.ts).
// Through the real runner with the production merge. PARALLEL_FIXTURE is
// a → split → (b, c) → join → d → success, every stage an agent stage.
describe("parallel branches: one task per branch under one lease (PR-3c-2)", () => {
  const DAY = "2026-03-02";
  const T0 = new Date(`${DAY}T09:00:00.000Z`);
  const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
  const CYCLE = `${PARALLEL_FIXTURE.key}@${PARALLEL_FIXTURE.version}:${DAY}`;
  const PRIMARY = workroomDriveTaskId("WC-FORK", PARALLEL_FIXTURE.key);
  const branch = (stageKey: string) => workroomDriveBranchTaskId("WC-FORK", PARALLEL_FIXTURE.key, stageKey);

  type Harness = {
    workspaceState: Record<string, unknown>;
    evidence: RecordedEvidence[];
    dispatchedAt: Map<string, Date>;
    stopConditionHits: string[];
    upserts: string[];
    deactivated: string[];
    leases: number;
    /** Stage keys whose upsert fails to schedule. */
    failing: Set<string>;
  };
  const harness = (workspaceState: Record<string, unknown> = {}): Harness =>
    ({ workspaceState, evidence: [], dispatchedAt: new Map(), stopConditionHits: [], upserts: [], deactivated: [], leases: 0, failing: new Set() });

  async function tick(h: Harness, now: Date) {
    const before = { upserts: h.upserts.length, deactivated: h.deactivated.length, leases: h.leases };
    const stored = readStoredWorkroomDriveState(h.workspaceState);
    const forkRoom: WorkroomDriveRoom = {
      ...room({ id: "row-fork", capsuleId: "WC-FORK", participants: [coordinatorAssignment("row-fork")] }),
      scopeClaims: [
        buildWorkShapeClaim({ key: PARALLEL_FIXTURE.key, version: PARALLEL_FIXTURE.version }),
        buildWorkroomPostureClaim({ proactivityLevel: "balanced" }, new Date("2026-03-01T00:00:00.000Z")),
      ],
      workspaceState: h.workspaceState,
      ...stored,
      stopConditionHits: h.stopConditionHits,
      recordedEvidence: [...h.evidence].reverse(),
      stageDispatchedAt: null,
      stageDispatchedAtByStage: new Map(h.dispatchedAt),
    };
    const fx: WorkroomDriveEffects = {
      persist: async (input) => {
        if (input.observationOnly) return;
        const written = mergeWorkroomDriveSnapshot(h.workspaceState, input.snapshot, { graphShape: input.graphShape });
        h.workspaceState = JSON.parse(JSON.stringify({ ...h.workspaceState, workroomDrive: written })) as Record<string, unknown>;
        // What loadStageDispatchTimesByStage reads off the activity row.
        for (const key of (input.snapshot.dispatchedStageKeys as string[] | undefined) ?? []) h.dispatchedAt.set(key, now);
      },
      acquireLease: async () => { h.leases += 1; return "acquired"; },
      upsertAgentTask: async (input) => {
        if (h.failing.has(input.stage.stageKey)) return false;
        h.upserts.push(`${input.taskId}@${input.stage.stageKey}`);
        return true;
      },
      deactivateAgentTask: async (taskId) => { h.deactivated.push(taskId); },
    };
    const result = await runWorkroomDriveJob(now, { listRooms: async () => [forkRoom], effects: fx, reconcileNesting: async () => 0, reconcileNotifications: async () => {} });
    return {
      plan: result.plans[0]!,
      upserts: h.upserts.slice(before.upserts),
      deactivated: h.deactivated.slice(before.deactivated),
      leases: h.leases - before.leases,
    };
  }
  const drive = (h: Harness) => h.workspaceState.workroomDrive as Record<string, unknown>;
  const tokens = (h: Harness) => (drive(h).marking as { tokens: Array<Record<string, unknown>> }).tokens;
  const done = (h: Harness, stageKey: string, minutes: number) =>
    h.evidence.push({ stageKey, kind: "assurance-run", outcome: "completed", recordedAt: at(minutes) });

  beforeEach(() => {
    // The real table: parallel split/join is executable since PR-3c-2.
    Object.assign(flags.table, flags.original);
    expect(flags.table["parallel-split-join"]).toBe(true);
  });

  it("two concurrent agent branches get two upserts with distinct ids fixed on their tokens, under one lease", async () => {
    const h = harness();
    expect((await tick(h, at(0))).upserts).toEqual([`${PRIMARY}@a`]);
    done(h, "a", 5);
    const split = await tick(h, at(15));
    expect(split.plan).toMatchObject({ action: "dispatch_agent", reason: "agent_stage" });
    expect(split.leases).toBe(1);
    expect(split.upserts).toEqual([`${PRIMARY}@b`, `${branch("c")}@c`]);
    // a left its stage, but b took the primary id in the same tick, so nothing is deactivated.
    expect(split.deactivated).toEqual([]);
    expect(tokens(h)).toEqual([
      expect.objectContaining({ node: "stage:b", taskId: PRIMARY, lastAction: "dispatch_agent", lastCycleKey: CYCLE }),
      expect.objectContaining({ node: "stage:c", taskId: branch("c"), lastAction: "dispatch_agent", lastCycleKey: CYCLE }),
    ]);
    expect(drive(h).dispatchedStageKeys).toEqual(["b", "c"]);
    expect(drive(h).stageKey).toBe("b");
  });

  it("AC-3C-BRANCH-LATCH: two branches that never write back each latch after exactly one dispatch per cycle", async () => {
    const h = harness();
    await tick(h, at(0));
    done(h, "a", 5);
    await tick(h, at(15));
    for (const minutes of [30, 45, 60, 75]) {
      const later = await tick(h, at(minutes));
      expect(later.plan, `t+${minutes}`).toMatchObject({ action: "pause", reason: "executor_writeback_unavailable" });
      expect(later.upserts, `t+${minutes}`).toEqual([]);
    }
    expect(h.upserts.filter((entry) => entry.endsWith("@b"))).toHaveLength(1);
    expect(h.upserts.filter((entry) => entry.endsWith("@c"))).toHaveLength(1);
    // Each latched branch's task is deactivated, and each records its own blocked receipt.
    expect(new Set(h.deactivated)).toEqual(new Set([PRIMARY, branch("c")]));
    expect(drive(h).receipts).toEqual(expect.arrayContaining([{ stageKey: "b", kind: "blocked" }, { stageKey: "c", kind: "blocked" }]));
  });

  it("a branch latched by writeback does not block the other, which still dispatches", async () => {
    const latched = { node: "stage:b", enteredAt: at(-30).toISOString(), taskId: PRIMARY, lastAction: "dispatch_agent", lastReason: "agent_stage", lastCycleKey: CYCLE };
    const fresh = { node: "stage:c", enteredAt: at(-30).toISOString(), taskId: branch("c") };
    const h = harness({ workroomDrive: { kind: "workroom-drive", version: 1, action: "dispatch_agent", reason: "agent_stage", stageKey: "b", lastCycleKey: CYCLE,
      receipts: [{ stageKey: "a", kind: "stage-evidence-recorded" }], marking: { format: "drive-marking/1", cycleKey: CYCLE, tokens: [latched, fresh], iterations: {}, reworkTaken: {}, deadlines: {}, children: {} } } });
    const result = await tick(h, at(0));
    // The aggregate is the latched branch's pause (pause outranks dispatch), yet c is dispatched.
    expect(result.plan).toMatchObject({ action: "pause", reason: "executor_writeback_unavailable" });
    expect(result.upserts).toEqual([`${branch("c")}@c`]);
    expect(result.deactivated).toEqual([PRIMARY]);
    expect(drive(h).dispatchedStageKeys).toEqual(["c"]);
  });

  it("a branch that fires and waits at the join, then the join completing, each deactivate the leaving task that tick", async () => {
    const h = harness();
    await tick(h, at(0));
    done(h, "a", 5);
    await tick(h, at(15));
    done(h, "b", 20);
    const waits = await tick(h, at(30));
    expect(waits.deactivated).toContain(PRIMARY);
    expect(tokens(h).map((token) => [token.node, token.from])).toEqual([["node:j", "stage:b"], ["stage:c", undefined]]);
    done(h, "c", 35);
    const joined = await tick(h, at(45));
    // c's branch task is deactivated as its token leaves; d enters and takes the primary id, which the upsert reactivates.
    expect(joined.deactivated).toEqual([branch("c")]);
    expect(joined.upserts).toEqual([`${PRIMARY}@d`]);
    expect(tokens(h)).toEqual([expect.objectContaining({ node: "stage:d", taskId: PRIMARY })]);
  });

  it("a branch whose dispatch fails to schedule is not latched: it records no dispatch and is dispatched next tick", async () => {
    const h = harness();
    await tick(h, at(0));
    done(h, "a", 5);
    h.failing.add("c");
    const partial = await tick(h, at(15));
    expect(partial.upserts).toEqual([`${PRIMARY}@b`]);
    expect(drive(h).dispatchedStageKeys).toEqual(["b"]);
    const c = tokens(h).find((token) => token.node === "stage:c");
    expect(c).toEqual({ node: "stage:c", enteredAt: at(15).toISOString(), taskId: branch("c") });
    h.failing.clear();
    const retried = await tick(h, at(30));
    expect(retried.upserts).toEqual([`${branch("c")}@c`]);
  });

  it("a stop deactivates every branch task the marking names", async () => {
    const h = harness();
    await tick(h, at(0));
    done(h, "a", 5);
    await tick(h, at(15));
    h.stopConditionHits = ["The substrate cannot be read."];
    const stopped = await tick(h, at(30));
    expect(stopped.plan).toMatchObject({ action: "stop", reason: "conformance_stop" });
    expect(new Set(stopped.deactivated)).toEqual(new Set([PRIMARY, branch("c")]));
    expect(stopped.upserts).toEqual([]);
  });

  it("success deactivates every task, and a sequential twin of the room keeps the primary id throughout", async () => {
    const h = harness();
    await tick(h, at(0));
    done(h, "a", 5);
    await tick(h, at(15));
    done(h, "b", 20);
    done(h, "c", 20);
    await tick(h, at(30));
    await tick(h, at(45));
    done(h, "d", 50);
    const success = await tick(h, at(60));
    expect(success.plan).toMatchObject({ action: "stop", reason: "success" });
    expect(success.deactivated).toContain(PRIMARY);
    expect(tokens(h)).toEqual([]);
  });

  it("with the parallel flag off the room pauses construct_not_executable and dispatches nothing", async () => {
    flags.table["parallel-split-join"] = false;
    const h = harness();
    const paused = await tick(h, at(0));
    expect(paused.plan).toMatchObject({ action: "pause", reason: "construct_not_executable" });
    expect(paused.upserts).toEqual([]);
  });
});
