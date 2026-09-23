import { describe, expect, it, vi } from "vitest";
import { loadStageDispatchTimes } from "./workroom-drive-data";

describe("loadStageDispatchTimes", () => {
  it("loads real dispatch timestamps for the current room stage and cycle", async () => {
    const at = new Date("2026-09-08T10:00:00Z");
    const query = vi.fn().mockResolvedValue([{ capsuleId: "WC-TEST", dispatchedAt: at }]);
    const result = await loadStageDispatchTimes(["WC-TEST"], { $queryRaw: query } as never);
    expect(result.get("WC-TEST")).toEqual(at);
    const sql = query.mock.calls[0][0].join("?");
    expect(sql).toContain("'dispatch_agent'");
    expect(sql).toContain("'agent_stage'");
    expect(sql).toContain("{workroomDrive,stageKey}");
    expect(sql).toContain("{workroomDrive,lastCycleKey}");
  });
  it("does not query an empty room set", async () => {
    const query = vi.fn();
    expect(await loadStageDispatchTimes([], { $queryRaw: query } as never)).toEqual(new Map());
    expect(query).not.toHaveBeenCalled();
  });
});

// Phase G (proactivity & capacity allocation §6.1) — the dispatched stage's
// declared effort reaches the scheduled task; an undeclared stage writes nothing.
import { applyDrivePlan, createWorkroomDriveEffects, type WorkroomDriveEffects } from "./workroom-drive";
import { resolveDrivePlan, workroomDriveTaskId } from "@/lib/work-management/drive-resolution";
import { buildWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";
import { getWorkShape, readWorkShapeDefinitionContract, type WorkShapeDefinitionContract } from "@/lib/work-management/work-shapes";

describe("stage effort on dispatch (Phase G)", () => {
  const NOW = new Date("2026-09-01T00:00:00.000Z");
  const shape = getWorkShape("obligation-assurance-watch")!;

  function effects() {
    return {
      persist: vi.fn<WorkroomDriveEffects["persist"]>(async () => {}),
      acquireLease: vi.fn<WorkroomDriveEffects["acquireLease"]>(async () => "acquired"),
      upsertAgentTask: vi.fn<WorkroomDriveEffects["upsertAgentTask"]>(async () => true),
      deactivateAgentTask: vi.fn<WorkroomDriveEffects["deactivateAgentTask"]>(async () => {}),
    };
  }

  async function dispatchStage(definition: WorkShapeDefinitionContract, stageKey: string) {
    const fx = effects();
    const base = resolveDrivePlan({
      roomId: "WC-TEST", definition, collaborationShape: shape.collaborationShape,
      postureLevel: "balanced", participants: [], currentStageKey: null, receipts: [],
      budgetUsage: [], stopConditionHits: [], reviewDue: false, substrateReachable: true,
      substrateEmpty: false, coordinatorHasProcessCoordinationAuthority: true,
    });
    await applyDrivePlan({
      room: {
        id: "row-1", capsuleId: "WC-TEST", scopeClaims: [buildWorkShapeClaim({ key: shape.key, version: shape.version })],
        workspaceState: {}, leaseExpiresAt: null, leaseHolderPrincipalId: "prn", ownerUserId: "user-1",
        participants: [], currentStageKey: null, receipts: [], budgetUsage: [], stopConditionHits: [],
        reviewDue: false, substrateReachable: true, substrateEmpty: false,
        coordinatorEligibility: { jsi: "eligible", authorityBinding: "eligible" },
      },
      plan: {
        ...base, definition, action: "dispatch_agent", reason: "agent_stage", stageKey,
        taskId: workroomDriveTaskId("WC-TEST", shape.key), agentId: "compliance-officer",
      },
      now: NOW,
      effects: fx,
    });
    return fx.upsertAgentTask.mock.calls[0]?.[0];
  }

  it("carries the declared tier of the dispatched stage", async () => {
    const call = await dispatchStage(readWorkShapeDefinitionContract(shape), "sweep");
    expect(call?.workroomStage).toEqual({ shapeKey: shape.key, stageKey: "sweep", effort: "low" });
  });

  it("carries high for a governed-decision stage whatever it declares", async () => {
    const contract = readWorkShapeDefinitionContract(shape);
    const demoted = {
      ...contract,
      stages: contract.stages.map((s) => (s.key === "decide" ? { ...s, effort: "low" as const } : s)),
    };
    const call = await dispatchStage(demoted, "decide");
    expect(call?.workroomStage?.effort).toBe("high");
  });

  it("carries no stage record for an undeclared stage", async () => {
    const contract = readWorkShapeDefinitionContract(shape);
    const undeclared = { ...contract, stages: contract.stages.map(({ effort: _e, ...s }) => s) };
    const call = await dispatchStage(undeclared, "sweep");
    expect(call).toBeDefined();
    expect(call?.workroomStage ?? null).toBeNull();
  });
});

describe("upsertAgentTask taskConfig write (Phase G)", () => {
  function db(existingTaskConfig: unknown) {
    const tx = {
      workroom: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      scheduledAgentTask: {
        findUnique: vi.fn().mockResolvedValue(existingTaskConfig === undefined ? null : { taskConfig: existingTaskConfig }),
        upsert: vi.fn().mockResolvedValue({}),
      },
    };
    return { tx, client: { ...tx, $transaction: vi.fn(async (run: (t: typeof tx) => unknown) => run(tx)) } };
  }
  const input = (workroomStage: { shapeKey: string; stageKey: string; effort: "low" | "high" } | null) => ({
    taskId: "T-1", agentId: "a", ownerUserId: "u", title: "t", prompt: "p", now: new Date("2026-09-01T00:00:00Z"),
    lease: { roomId: "row-1", expiresAt: new Date("2026-09-01T00:05:00Z"), holderPrincipalId: null },
    workroomStage,
  });
  const upsertArgs = (tx: ReturnType<typeof db>["tx"]) => tx.scheduledAgentTask.upsert.mock.calls[0]![0];

  it("persists the stage effort under taskConfig.workroomStage on create and update", async () => {
    const { tx, client } = db(undefined);
    const fx = createWorkroomDriveEffects(async () => client as never, () => new Date("2026-09-01T00:00:00Z"));
    await fx.upsertAgentTask(input({ shapeKey: "s", stageKey: "sweep", effort: "low" }));
    const args = upsertArgs(tx);
    expect(args.create.taskConfig).toEqual({ workroomStage: { shapeKey: "s", stageKey: "sweep", effort: "low" } });
    expect(args.update.taskConfig).toEqual({ workroomStage: { shapeKey: "s", stageKey: "sweep", effort: "low" } });
  });

  it("merges into an existing taskConfig without disturbing a recorded trigger", async () => {
    const { tx, client } = db({ trigger: { kind: "time" } });
    const fx = createWorkroomDriveEffects(async () => client as never, () => new Date("2026-09-01T00:00:00Z"));
    await fx.upsertAgentTask(input({ shapeKey: "s", stageKey: "decide", effort: "high" }));
    expect(upsertArgs(tx).update.taskConfig).toEqual({
      trigger: { kind: "time" }, workroomStage: { shapeKey: "s", stageKey: "decide", effort: "high" },
    });
  });

  it("does not write taskConfig at all for an undeclared stage", async () => {
    const { tx, client } = db(null);
    const fx = createWorkroomDriveEffects(async () => client as never, () => new Date("2026-09-01T00:00:00Z"));
    await fx.upsertAgentTask(input(null));
    const args = upsertArgs(tx);
    expect(args.create).not.toHaveProperty("taskConfig");
    expect(args.update).not.toHaveProperty("taskConfig");
  });

  it("clears a stale stage record when the room moves to an undeclared stage", async () => {
    const { tx, client } = db({ trigger: { kind: "time" }, workroomStage: { shapeKey: "s", stageKey: "sweep", effort: "low" } });
    const fx = createWorkroomDriveEffects(async () => client as never, () => new Date("2026-09-01T00:00:00Z"));
    await fx.upsertAgentTask(input(null));
    expect(upsertArgs(tx).update.taskConfig).toEqual({ trigger: { kind: "time" } });
  });
});
