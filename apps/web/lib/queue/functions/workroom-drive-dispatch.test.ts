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
  it("also starts a governed-decision stage at the drive's attention ask (never-dispatched stage)", async () => {
    const askedAt = new Date("2026-09-26T01:30:00.806Z");
    const query = vi.fn().mockResolvedValue([{ capsuleId: "WC-DECIDE", dispatchedAt: askedAt }]);
    const result = await loadStageDispatchTimes(["WC-DECIDE"], { $queryRaw: query } as never);
    expect(result.get("WC-DECIDE")).toEqual(askedAt);
    expect(result.get("WC-OTHER")).toBeUndefined();
    const sql = query.mock.calls[0][0].join("?");
    // The attention row: the drive's own ask for THIS stage's governed decision.
    expect(sql).toContain("'workroom-drive-attention'");
    expect(sql).toContain("'attention'");
    expect(sql).toContain("'governed_decision'");
    // Scoped to the room still waiting on that decision. role_stage/person_stage
    // attention is not a start time: only governed_decision is accepted.
    expect(sql).toContain("{workroomDrive,pendingAttention,reason}");
    expect(sql).toContain("{workroomDrive,pendingAttention,stageKey}");
    expect(sql).not.toContain("'role_stage'");
    // The dispatch branch keeps its cycle scope; latest row wins.
    expect(sql).toMatch(/ORDER BY w\."capsuleId", a\."recordedAt" DESC/);
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
    expect(call?.stage).toMatchObject({ shapeKey: shape.key, stageKey: "sweep", effort: "low" });
  });

  it("carries high for a governed-decision stage whatever it declares", async () => {
    const contract = readWorkShapeDefinitionContract(shape);
    const demoted = {
      ...contract,
      stages: contract.stages.map((s) => (s.key === "decide" ? { ...s, effort: "low" as const } : s)),
    };
    const call = await dispatchStage(demoted, "decide");
    expect(call?.stage.effort).toBe("high");
  });

  it("carries no effort for an undeclared stage", async () => {
    const contract = readWorkShapeDefinitionContract(shape);
    const undeclared = { ...contract, stages: contract.stages.map(({ effort: _e, ...s }) => s) };
    const call = await dispatchStage(undeclared, "sweep");
    expect(call).toBeDefined();
    expect(call?.stage).not.toHaveProperty("effort");
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
  const stage = (effort?: "low" | "high") => ({ shapeKey: "s", shapeVersion: "1.0.0", stageKey: "sweep", tools: [], ...(effort ? { effort } : {}) });
  const input = (s: ReturnType<typeof stage>) => ({
    taskId: "T-1", agentId: "a", ownerUserId: "u", title: "t", prompt: "p", now: new Date("2026-09-01T00:00:00Z"),
    lease: { roomId: "row-1", expiresAt: new Date("2026-09-01T00:05:00Z"), holderPrincipalId: null },
    stage: s,
  });
  const upsertArgs = (tx: ReturnType<typeof db>["tx"]) => tx.scheduledAgentTask.upsert.mock.calls[0]![0];
  const fxFor = (client: unknown) => createWorkroomDriveEffects(async () => client as never, () => new Date("2026-09-01T00:00:00Z"));

  it("persists the stage effort beside its tools under taskConfig.workroomStage", async () => {
    const { tx, client } = db(undefined);
    await fxFor(client).upsertAgentTask(input(stage("low")));
    expect(upsertArgs(tx).update.taskConfig).toEqual({ workroomStage: stage("low") });
  });

  it("merges into an existing taskConfig without disturbing a recorded trigger", async () => {
    const { tx, client } = db({ trigger: { kind: "time" } });
    await fxFor(client).upsertAgentTask(input(stage("high")));
    expect(upsertArgs(tx).update.taskConfig).toEqual({ trigger: { kind: "time" }, workroomStage: stage("high") });
  });

  it("drops a stale effort when the room moves to an undeclared stage", async () => {
    const { tx, client } = db({ trigger: { kind: "time" }, workroomStage: stage("low") });
    await fxFor(client).upsertAgentTask(input(stage()));
    expect(upsertArgs(tx).update.taskConfig).toEqual({ trigger: { kind: "time" }, workroomStage: stage() });
  });
});
