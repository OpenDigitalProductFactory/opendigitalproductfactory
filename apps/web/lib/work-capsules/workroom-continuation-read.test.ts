import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ $transaction: vi.fn(), $executeRaw: vi.fn(), workroom: { findUnique: vi.fn() },
  scheduledAgentTask: { findUnique: vi.fn() }, workroomActivity: { findMany: vi.fn() }, backlogItem: { findFirst: vi.fn() } }));
const access = vi.hoisted(() => ({ agent: vi.fn(), human: vi.fn() }));
const resolveShape = vi.hoisted(() => vi.fn());
vi.mock("@dpf/db", () => ({ prisma: db }));
vi.mock("@/lib/work-management/workroom-agent-access.server", () => ({
  resolveAgentWorkroomAccess: access.agent, resolveHumanWorkroomAccess: access.human,
}));
vi.mock("@/lib/work-management/workroom-shape-claim", () => ({ resolveWorkShapeClaim: resolveShape }));

import { readWorkroomContinuation } from "./workroom-continuation-read.server";
import { readWorkroomDetail } from "./workroom-detail-read.server";
import { buildDispatchCheckpoint } from "@/lib/work-management/workroom-drive-checkpoint";
import { buildContinuationBrief, stageBriefInputFromDefinition } from "@/lib/work-management/stage-briefing";
import { getWorkShape, readWorkShapeDefinitionContract } from "@/lib/work-management/work-shapes";
import { clampToolResultForModel } from "@/lib/tak/tool-result-budget";

const now = new Date("2026-10-31T18:00:00Z");
const expires = new Date("2026-10-31T18:30:00Z");
const shape = getWorkShape("dependency-advisory-watch")!;
const context = { agentId: "AGT-1", apiTokenId: "token-1", tokenScope: "read" as const, tokenGrantScopes: ["work_capsule_read"] };
const parameters = { capsuleId: "WC-1", continuationMode: "bounded" };
const grant = () => ({ decision: { level: "content", reason: "authorized" }, agentPrincipalId: "agent-principal" });
const fixture = () => ({ id: "room-row", capsuleId: "WC-1", objective: "Read advisory sources", status: "working",
  backlogItemId: "BI-1", repositoryFullName: "org/repo" as string | null, headSha: "a".repeat(40) as string | null, leaseHolderPrincipalId: "principal-1",
  leaseExpiresAt: expires, scopeClaims: [{ workShape: `${shape.key}@${shape.version}` }],
  workspaceState: { executorCheckpoint: undefined as unknown,
    workroomDrive: { stageKey: "sweep", taskId: "task-1", runKey: "run-1", lastCycleKey: "cycle-1", stopConditionHits: [] } } });
type Room = ReturnType<typeof fixture>;
let room: Room;
const checkpoint = (stageKey = "sweep", taskId = "task-1", iteration = 0) => buildDispatchCheckpoint(null, {
  taskId, roomId: "room-row", objective: room.objective, stage: { shapeKey: shape.key, shapeVersion: shape.version, stageKey,
    tools: [...(shape.stages.find(stage => stage.key === "sweep")?.tools ?? [])] },
  source: { repositoryFullName: room.repositoryFullName, headSha: room.headSha },
  dispatchScope: { runKey: "run-1", cycleKey: "cycle-1", iteration }, holderPrincipalId: "principal-1",
  leaseExpiresAt: expires.toISOString(), now: now.toISOString(),
});
const task = (receipt = checkpoint()) => ({ taskId: receipt.confirmedEffect.taskId, agentId: "AGT-OWNER", ownerUserId: "owner",
  isActive: true, lastStatus: "ok", taskRunId: "TR-1", taskConfig: { workroomDispatchCheckpoint: receipt, workroomStage: { ...receipt.stage } } });
const executorCheckpoint = () => ({ nextAction: "Observe existing integration gate session 61789 before starting another gate.",
  addressing: ["BI-1", "AC-REHYDRATION"], uncommittedPaths: ["apps/web/example.ts"], headSha: "a".repeat(40),
  pushed: false, openRisks: ["Gate outcome is unknown; do not repeat it."],
  recordedAt: now.toISOString(), recordedByPrincipalId: "previous-executor" });

describe("bounded Workroom continuation", () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers(); vi.setSystemTime(now);
    room = fixture();
    resolveShape.mockReturnValue(shape);
    db.$transaction.mockImplementation(async work => work(db));
    db.workroom.findUnique.mockImplementation(async args => args.select.workspaceState ? room : { id: room.id, capsuleId: room.capsuleId });
    db.scheduledAgentTask.findUnique.mockResolvedValue(task());
    db.workroomActivity.findMany.mockResolvedValue([]);
    db.backlogItem.findFirst.mockResolvedValue({ itemId: "BI-1" });
    access.agent.mockResolvedValue(grant()); access.human.mockResolvedValue(grant());
  });

  it("checks current admission before fetching private workspace, task or activity data", async () => {
    access.agent.mockResolvedValue({ decision: { level: "none", reason: "not-admitted" } });
    const result = await readWorkroomContinuation({ ...parameters, continuationTaskId: "task-1" }, "reader", context);
    expect(result).toMatchObject({ success: false, error: "workroom_content_access_required" });
    expect(db.workroom.findUnique.mock.calls).toHaveLength(1);
    expect(db.workroom.findUnique.mock.calls[0]![0].select).toEqual({ id: true, capsuleId: true });
    expect(db.scheduledAgentTask.findUnique).not.toHaveBeenCalled();
    expect(db.workroomActivity.findMany).not.toHaveBeenCalled();
  });

  it("requires authenticated user context and does not invent manual task identity", async () => {
    expect(await readWorkroomContinuation(parameters)).toMatchObject({ success: false, error: "workroom_content_access_required" });
    expect(db.$transaction).not.toHaveBeenCalled();
    const result = await readWorkroomContinuation(parameters, "reader", context);
    expect(result).toMatchObject({ success: true, data: { continuation: {
      stageKey: "sweep", identity: { taskId: null, runKey: "run-1", cycleKey: "cycle-1", iteration: null },
      outcome: "unknown", replay: "not-authorized-by-brief",
    } } });
    expect(db.scheduledAgentTask.findUnique).not.toHaveBeenCalled();
  });

  it("recovers the recorded manual next action and remaining risks without inferring execution authority", async () => {
    room.workspaceState.executorCheckpoint = executorCheckpoint();
    const result = await readWorkroomContinuation(parameters, "reader", context);
    expect(result).toMatchObject({ success: true, data: { continuation: {
      identity: { taskId: null }, outcome: "unknown", replay: "not-authorized-by-brief",
      state: { nextAction: "review-room-checkpoint-before-stage-work" },
      advisoryCheckpoint: { scope: "room", stageBinding: "unbound", sourceStatus: "head-matches",
        recordedAt: now.toISOString(), recordedByPrincipalId: "previous-executor",
        checkpoint: { nextAction: executorCheckpoint().nextAction, addressing: ["BI-1", "AC-REHYDRATION"],
          uncommittedPaths: ["apps/web/example.ts"], pushed: false, openRisks: executorCheckpoint().openRisks },
        reference: { kind: "executor-checkpoint", id: "WC-1", version: expect.stringMatching(/^[a-f0-9]{64}$/) },
        resultPath: ["data", "capsule", "workspaceState", "executorCheckpoint"],
      },
    } } });
    expect(clampToolResultForModel(result).truncated).toBe(false);
    expect(db.scheduledAgentTask.findUnique).not.toHaveBeenCalled();
  });

  it("invalidates a manual continuation after a checkpoint-only change with no new activity", async () => {
    room.workspaceState.executorCheckpoint = executorCheckpoint();
    const first = await readWorkroomContinuation(parameters, "reader", context);
    room.workspaceState.executorCheckpoint = { ...executorCheckpoint(), nextAction: "Read the completed gate result; do not restart it." };
    expect(await readWorkroomContinuation({ ...parameters, continuationVersion: first.data!.continuationVersion }, "reader", context))
      .toMatchObject({ success: false, error: "continuation_stale" });
  });

  it.each(["missing-head", "different-head", "malformed", "repository-removed"])("requires manual checkpoint reconciliation for %s", async change => {
    const saved = executorCheckpoint();
    room.workspaceState.executorCheckpoint = change === "missing-head" ? { ...saved, headSha: undefined }
      : change === "different-head" ? { ...saved, headSha: "b".repeat(40) }
      : change === "malformed" ? { ...saved, nextAction: 123 } : saved;
    if (change === "repository-removed") { room.repositoryFullName = null; room.headSha = null; }
    const result = await readWorkroomContinuation(parameters, "reader", context);
    expect(result).toMatchObject({ success: true, data: { reconciliationRequired: true, continuation: {
      state: { nextAction: "reconcile-executor-checkpoint" },
      advisoryCheckpoint: { sourceStatus: "reconciliation-required", checkpoint: null },
    } } });
    expect(JSON.stringify(result)).not.toContain(saved.nextAction);
  });

  it("preserves legitimate non-repository manual checkpoint guidance without inventing Git identity", async () => {
    room.repositoryFullName = null; room.headSha = null;
    const { headSha: _headSha, ...saved } = executorCheckpoint();
    room.workspaceState.executorCheckpoint = saved;
    expect(await readWorkroomContinuation(parameters, "reader", context)).toMatchObject({ success: true, data: { continuation: {
      source: { repositoryFullName: null, headSha: null }, advisoryCheckpoint: {
        sourceStatus: "not-applicable", checkpoint: { nextAction: saved.nextAction },
      },
    } } });
  });

  it("excludes a global manual checkpoint and its changes from an exact scheduled-task continuation", async () => {
    room.workspaceState.executorCheckpoint = executorCheckpoint();
    const request = { ...parameters, continuationTaskId: "task-1" };
    const first = await readWorkroomContinuation(request, "reader", context);
    expect(first.success).toBe(true);
    expect(first).not.toHaveProperty("data.continuation.advisoryCheckpoint");
    expect(JSON.stringify(first)).not.toContain(executorCheckpoint().nextAction);
    room.workspaceState.executorCheckpoint = { ...executorCheckpoint(), nextAction: "Room-level unrelated wait" };
    expect(await readWorkroomContinuation({ ...request, continuationVersion: first.data!.continuationVersion }, "reader", context))
      .toMatchObject({ success: true, data: { continuationVersion: first.data!.continuationVersion } });
  });

  it("never truncates recorded next actions and risks to squeeze a manual checkpoint into the response", async () => {
    room.workspaceState.executorCheckpoint = { ...executorCheckpoint(), openRisks: ["Required unresolved risk ".repeat(100)] };
    expect(await readWorkroomContinuation(parameters, "reader", context))
      .toMatchObject({ success: false, error: "continuation_budget_exceeded" });
  });

  it("withholds the manual checkpoint when admission is revoked during recovery", async () => {
    room.workspaceState.executorCheckpoint = executorCheckpoint();
    access.agent.mockResolvedValueOnce(grant()).mockResolvedValueOnce({ decision: { level: "none" } });
    const result = await readWorkroomContinuation(parameters, "reader", context);
    expect(result).toMatchObject({ success: false, error: "workroom_content_access_required" });
    expect(JSON.stringify(result)).not.toContain(executorCheckpoint().nextAction);
  });

  it("withholds the projection when access is revoked during the read", async () => {
    access.agent.mockResolvedValueOnce(grant()).mockResolvedValueOnce({ decision: { level: "none" } });
    const result = await readWorkroomContinuation(parameters, "reader", context);
    expect(result).toMatchObject({ success: false, error: "workroom_content_access_required" });
    expect(result).not.toHaveProperty("data.continuation");
  });

  it("renders the same exact checkpoint facts as the native helper without treating task success as completion", async () => {
    const receipt = checkpoint();
    const result = await readWorkroomContinuation({ ...parameters, continuationTaskId: "task-1" }, "reader", context);
    const shared = buildContinuationBrief({
      brief: stageBriefInputFromDefinition({ capsuleId: room.capsuleId, roomObjective: room.objective, backlogItemKey: "BI-1",
        shapeKey: shape.key, shapeVersion: shape.version, definition: readWorkShapeDefinitionContract(shape), stageKey: "sweep" }),
      identity: { taskId: "task-1", ...receipt.dispatchScope! }, source: receipt.source!,
      owner: { principalId: receipt.authority.holderPrincipalId, agentId: "AGT-OWNER" },
      state: { status: "scheduled", roomStatus: room.status, leaseExpiresAt: receipt.authority.leaseExpiresAt, stopReasons: [], nextAction: "reconcile-scheduled-task" },
    });
    if (!shared.success) throw new Error(shared.message);
    expect(result).toMatchObject({ success: true, data: { continuation: shared.brief } });
    expect(clampToolResultForModel(result).truncated).toBe(false);
  });

  it("requires an explicit current branch in a parallel room and uses its task checkpoint, not the room's latest", async () => {
    const other = { ...shape.stages[0]!, key: "other" };
    resolveShape.mockReturnValue({ ...shape, stages: [...shape.stages, other] });
    room.workspaceState = { ...room.workspaceState, workroomDrive: { ...room.workspaceState.workroomDrive,
      marking: { format: "drive-marking/1", cycleKey: "run-1",
        tokens: [{ node: "stage:sweep", enteredAt: now.toISOString(), taskId: "task-1" },
          { node: "stage:other", enteredAt: now.toISOString(), taskId: "task-other" }],
        iterations: { sweep: 1, other: 2 }, reworkTaken: {}, deadlines: {}, children: {} },
    }, workroomDispatchCheckpoint: checkpoint("other", "task-other", 2) } as Room["workspaceState"];
    room.workspaceState.executorCheckpoint = executorCheckpoint();
    expect(await readWorkroomContinuation(parameters, "reader", context))
      .toMatchObject({ success: false, error: "continuation_stage_required" });
    db.scheduledAgentTask.findUnique.mockResolvedValue(task(checkpoint("sweep", "task-1", 1)));
    expect(await readWorkroomContinuation({ ...parameters, continuationTaskId: "task-1" }, "reader", context))
      .toMatchObject({ success: true, data: { continuation: { stageKey: "sweep", identity: { taskId: "task-1", iteration: 1 } } } });
    expect(await readWorkroomContinuation({ ...parameters, continuationStageKey: "other" }, "reader", context))
      .toMatchObject({ success: true, data: { continuation: { stageKey: "other", identity: { taskId: null, iteration: 2 },
        advisoryCheckpoint: { scope: "room", stageBinding: "unbound", checkpoint: { nextAction: executorCheckpoint().nextAction } },
      } } });
  });

  it.each(["foreign-room", "foreign-task", "old-run", "old-stage", "old-source", "old-holder", "expired-lease"])("refuses %s checkpoint binding", async change => {
    const receipt = checkpoint();
    if (change === "foreign-room") receipt.roomId = "foreign";
    if (change === "foreign-task") receipt.confirmedEffect.taskId = "foreign";
    if (change === "old-run") receipt.dispatchScope!.runKey = "old-run";
    if (change === "old-stage") receipt.stage.stageKey = "not-current";
    if (change === "old-source") receipt.source!.headSha = "b".repeat(40);
    if (change === "old-holder") receipt.authority.holderPrincipalId = "old-holder";
    if (change === "expired-lease") { receipt.authority.leaseExpiresAt = "2026-10-30T00:00:00Z"; room.leaseExpiresAt = new Date(receipt.authority.leaseExpiresAt); }
    db.scheduledAgentTask.findUnique.mockResolvedValue(task(receipt));
    expect(await readWorkroomContinuation({ ...parameters, continuationTaskId: "task-1" }, "reader", context))
      .toMatchObject({ success: false, error: "continuation_binding_stale" });
  });

  it.each(["rebound-task", "missing-task", "negative-iteration"])("refuses a graph branch with %s", async change => {
    room.workspaceState = { ...room.workspaceState, workroomDrive: { ...room.workspaceState.workroomDrive, marking: {
      format: "drive-marking/1", cycleKey: "run-1",
      tokens: [{ node: "stage:sweep", enteredAt: now.toISOString(),
        ...(change === "missing-task" ? {} : { taskId: change === "rebound-task" ? "replacement-task" : "task-1" }) }],
      iterations: { sweep: change === "negative-iteration" ? -1 : 0 }, reworkTaken: {}, deadlines: {}, children: {},
    } } } as Room["workspaceState"];
    expect(await readWorkroomContinuation({ ...parameters, continuationTaskId: "task-1" }, "reader", context))
      .toMatchObject({ success: false, error: change === "negative-iteration" ? "continuation_stage_unavailable" : "continuation_binding_stale" });
  });

  it("keeps legacy missing source unknown and asks for reconciliation without granting replay", async () => {
    const receipt = checkpoint(); delete receipt.source;
    db.scheduledAgentTask.findUnique.mockResolvedValue(task(receipt));
    expect(await readWorkroomContinuation({ ...parameters, continuationTaskId: "task-1" }, "reader", context))
      .toMatchObject({ success: true, data: { sourceState: "unknown", continuation: {
        source: { repositoryFullName: null, headSha: null }, outcome: "unknown", replay: "not-authorized-by-brief",
        state: { nextAction: "reconcile-scheduled-task" },
      } } });
  });

  it("invalidates a prior version after source or authenticated grant context changes", async () => {
    const first = await readWorkroomContinuation(parameters, "reader", context);
    const version = (first.data as { continuationVersion: string }).continuationVersion;
    expect(version).toMatch(/^[a-f0-9]{64}$/);
    expect(await readWorkroomContinuation({ ...parameters, continuationVersion: version }, "reader", context)).toMatchObject({ success: true });
    room.headSha = "b".repeat(40);
    expect(await readWorkroomContinuation({ ...parameters, continuationVersion: version }, "reader", context))
      .toMatchObject({ success: false, error: "continuation_stale" });
    room.headSha = "a".repeat(40);
    expect(await readWorkroomContinuation({ ...parameters, continuationVersion: version }, "reader", { ...context, tokenGrantScopes: [] }))
      .toMatchObject({ success: false, error: "continuation_stale" });
  });

  it("invalidates a prior version when new durable evidence appears", async () => {
    const first = await readWorkroomContinuation(parameters, "reader", context);
    db.workroomActivity.findMany.mockResolvedValue([{ id: "activity-new", kind: "evidence-recorded", sequence: 13, recordedAt: now }]);
    expect(await readWorkroomContinuation({ ...parameters, continuationVersion: first.data!.continuationVersion }, "reader", context))
      .toMatchObject({ success: false, error: "continuation_stale" });
  });

  it.each(["archived", "complete", "abandoned", "blocked", "paused"])("does not suggest manual stage work while the room is %s", async status => {
    room.status = status;
    expect(await readWorkroomContinuation(parameters, "reader", context)).toMatchObject({ success: true, data: { continuation: {
      state: { roomStatus: status, stopReasons: [`room-status:${status}`],
        nextAction: ["archived", "complete", "abandoned"].includes(status) ? "observe-terminal-room" : "resolve-room-stop-before-stage-work" },
    } } });
  });

  it("refuses a task whose actual assignment was changed after checkpoint capture", async () => {
    const changed = task(); changed.taskConfig.workroomStage.tools = ["unexpected_tool"];
    db.scheduledAgentTask.findUnique.mockResolvedValue(changed);
    expect(await readWorkroomContinuation({ ...parameters, continuationTaskId: "task-1" }, "reader", context))
      .toMatchObject({ success: false, error: "continuation_binding_stale" });
  });

  it("does not invent a first stage when current stage is missing or the selector is not current", async () => {
    expect(await readWorkroomContinuation({ ...parameters, continuationStageKey: "not-current" }, "reader", context))
      .toMatchObject({ success: false, error: "continuation_stage_unavailable" });
    room.workspaceState = {} as Room["workspaceState"];
    expect(await readWorkroomContinuation(parameters, "reader", context))
      .toMatchObject({ success: false, error: "continuation_stage_unavailable" });
  });

  it("reads only bounded activity metadata with existing payload lookup handles", async () => {
    db.workroomActivity.findMany.mockResolvedValue([{ id: "activity-1", kind: "evidence-recorded", sequence: 12, recordedAt: now }]);
    const result = await readWorkroomContinuation(parameters, "reader", context);
    expect(db.workroomActivity.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { workCapsuleId: "room-row" }, take: 8,
      select: { id: true, kind: true, sequence: true, recordedAt: true },
    }));
    expect(result).toMatchObject({ success: true, data: { activities: [{ id: "activity-1", payloadDeferred: true,
      detail: { toolName: "get_workroom", arguments: { capsuleId: "WC-1", activityMode: "bounded", activityId: "activity-1" } } }] } });
  });

  it("keeps the full response bounded by deferring whole metadata records, never obligations", async () => {
    db.workroomActivity.findMany.mockResolvedValue(Array.from({ length: 8 }, (_, index) => ({
      id: `activity-${index}`, kind: "recorded-kind-".repeat(30), sequence: index, recordedAt: now,
    })));
    const result = await readWorkroomContinuation(parameters, "reader", context);
    expect(result.success).toBe(true);
    expect(clampToolResultForModel(result).truncated).toBe(false);
    const data = result.data as { continuation: { doneWhen: string; budgets: unknown; stageTools: unknown };
      activities: unknown[]; activityCoverage: unknown };
    expect(data.activities.length).toBeLessThan(8);
    expect(data.continuation).toMatchObject({ doneWhen: shape.stages.find(stage => stage.key === "sweep")!.advance.condition,
      budgets: shape.budgets, stageTools: shape.stages.find(stage => stage.key === "sweep")!.tools });
    expect(data.activityCoverage).toMatchObject({ complete: false,
      lookup: { toolName: "get_workroom", arguments: { capsuleId: "WC-1", activityMode: "bounded" } } });
  });

  it("uses current human admission when no agent identity is supplied", async () => {
    expect(await readWorkroomContinuation(parameters, "reader")).toMatchObject({ success: true });
    expect(access.human).toHaveBeenCalledTimes(2);
    expect(access.agent).not.toHaveBeenCalled();
  });

  it("refuses oversized essential content without returning a clamped assignment", async () => {
    room.objective = "Mandatory objective ".repeat(2000);
    expect(await readWorkroomContinuation(parameters, "reader", context))
      .toMatchObject({ success: false, error: "continuation_budget_exceeded" });
  });

  it.each([{ activityMode: "bounded" }, { reviewTaskRunId: "TR-1" }, { afterSequence: 0 }, { throughSequence: 1 },
    { activityId: "activity-1" }, { continuationTaskId: "task-1", continuationStageKey: "sweep" }])("rejects mixed selectors %j before reading", async mixed => {
    expect(await readWorkroomDetail({ ...parameters, ...mixed }, "reader", context))
      .toMatchObject({ success: false, error: "invalid_continuation_read" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("routes the explicit view through the existing Workroom reader", async () => {
    expect(await readWorkroomDetail(parameters, "reader", context)).toMatchObject({ success: true, data: { continuation: { stageKey: "sweep" } } });
  });
});
