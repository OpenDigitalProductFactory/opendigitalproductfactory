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
    // Scoped to the room still waiting on that decision.
    expect(sql).toContain("{workroomDrive,pendingAttention,reason}");
    expect(sql).toContain("{workroomDrive,pendingAttention,stageKey}");
    // A stage accountable to another person is never started by its ask.
    expect(sql).not.toContain("'person_stage'");
    // The dispatch branch keeps its cycle scope; latest row wins.
    expect(sql).toMatch(/ORDER BY w\."capsuleId", a\."recordedAt" DESC/);
  });
  // BI-C9912C22 AC-3: WC-BFDF763B's delivery-small "reproduce" stage is
  // accountable to role:author, so the drive raised attention (role_stage) and
  // never dispatched it. Its author recorded failing-test evidence with outcome
  // completed after that ask, yet the stage had no start time, so the evidence
  // never earned a receipt (88 hold ticks). The author's stage starts at the
  // drive's ask, exactly like a governed decision.
  it("starts an author stage at the drive's role_stage attention ask, and no other role's", async () => {
    const askedAt = new Date("2026-10-01T17:45:00.115Z");
    const query = vi.fn().mockResolvedValue([{ capsuleId: "WC-BFDF763B", dispatchedAt: askedAt }]);
    const result = await loadStageDispatchTimes(["WC-BFDF763B"], { $queryRaw: query } as never);
    expect(result.get("WC-BFDF763B")).toEqual(askedAt);
    const sql = query.mock.calls[0][0].join("?");
    expect(sql).toContain("'role_stage'");
    // Only the author's own stage: an approver or reviewer stage must not be
    // satisfiable by evidence the author writes (separation of duties).
    expect(sql).toContain("{workroomDrive,pendingAttention,principalRef}");
    expect(sql).toContain("'role:author'");
  });
  it("does not query an empty room set", async () => {
    const query = vi.fn();
    expect(await loadStageDispatchTimes([], { $queryRaw: query } as never)).toEqual(new Map());
    expect(query).not.toHaveBeenCalled();
  });
});

// Phase G (proactivity & capacity allocation §6.1) — the dispatched stage's
// declared effort reaches the scheduled task; an undeclared stage writes nothing.
import { applyDrivePlan, type WorkroomDriveEffects } from "./workroom-drive";
import { readWorkroomStageTaskConfig, withWorkroomStageTaskConfig } from "@/lib/scheduling/workroom-stage-task-config";
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

// The scheduled task's taskConfig is written through withWorkroomStageTaskConfig
// (workroom-drive-scheduling.ts); these pin what it keeps and drops.
describe("stage taskConfig write (Phase G)", () => {
  const stage = (effort?: "low" | "high") => ({ shapeKey: "s", shapeVersion: "1.0.0", stageKey: "sweep", tools: [], ...(effort ? { effort } : {}) });

  it("persists the stage effort beside its tools under taskConfig.workroomStage", () => {
    expect(withWorkroomStageTaskConfig(null, stage("low"))).toEqual({ workroomStage: stage("low") });
    expect(readWorkroomStageTaskConfig(withWorkroomStageTaskConfig(null, stage("low")))?.effort).toBe("low");
  });

  it("merges into an existing taskConfig without disturbing a recorded trigger", () => {
    expect(withWorkroomStageTaskConfig({ trigger: { kind: "time" } }, stage("high"))).toEqual({ trigger: { kind: "time" }, workroomStage: stage("high") });
  });

  it("drops a stale effort when the room moves to an undeclared stage", () => {
    expect(withWorkroomStageTaskConfig({ trigger: { kind: "time" }, workroomStage: stage("low") }, stage())).toEqual({ trigger: { kind: "time" }, workroomStage: stage() });
  });

  it("reads an unknown tier as no tier", () => {
    expect(readWorkroomStageTaskConfig({ workroomStage: { ...stage(), effort: "extreme" } })?.effort).toBeUndefined();
  });
});
