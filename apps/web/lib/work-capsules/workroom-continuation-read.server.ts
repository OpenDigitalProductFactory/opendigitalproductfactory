import { createHash } from "node:crypto";
import { prisma } from "@dpf/db";
import { iterationOf, markedStageKeys, readStoredDriveMarking, stageToken } from "@dpf/validators/workroom/marking";
import type { ToolExecutionContext, ToolResult } from "@/lib/mcp-tool-types";
import { isRecord } from "@/lib/shared/coerce";
import { readWorkroomStageTaskConfig } from "@/lib/scheduling/workroom-stage-task-config";
import { countTokens } from "@/lib/tak/context-arbitrator";
import { buildContinuationBrief, CONTINUATION_BRIEF_MAX_TOKENS, stageBriefInputFromDefinition, type ContinuationBriefInput,
  type ContinuationBriefResult, type ContinuationAdvisoryCheckpoint } from "@/lib/work-management/stage-briefing";
import { resolveAgentWorkroomAccess, resolveHumanWorkroomAccess } from "@/lib/work-management/workroom-agent-access.server";
import { readDispatchCheckpoint } from "@/lib/work-management/workroom-drive-checkpoint";
import { driveRunKeyOf, projectStoredWorkroomDriveObservation, readStoredWorkroomDriveState } from "@/lib/work-management/workroom-drive-state";
import { resolveWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";
import { readWorkShapeDefinitionContract } from "@/lib/work-management/work-shapes";
import { TERMINAL_WORKROOM_STATUSES } from "@/lib/work-management/standing-room-nesting";
import { storedExecutorCheckpoint } from "./batch-executor-handover";
import { parseExecutorCheckpoint } from "./executor-checkpoint";

const refused = (error: string, message: string): ToolResult => ({ success: false, error, message });
const denied = () => refused("workroom_content_access_required", "Current authenticated Workroom content admission is required.");
const staleBinding = () => refused("continuation_binding_stale", "The exact task no longer matches the current room, branch, source or lease. Reconcile its recorded effect before continuing; no replay is authorized.");
const staleVersion = () => refused("continuation_stale", "Continuation facts or authority changed. Read again without continuationVersion and revalidate before any effect.");
const budgetRefusal = () => refused("continuation_budget_exceeded", "Required continuation facts exceed the response budget. No partial assignment or execution permission is returned.");
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const toolSet = (tools: readonly string[]) => JSON.stringify([...new Set(tools)].sort());
const selectorFields = ["continuationTaskId", "continuationStageKey", "continuationVersion"] as const;
const incompatibleFields = ["activityMode", "activityId", "activityField", "payloadPath", "activityLimit",
  "afterSequence", "throughSequence", "reviewTaskRunId", "cursor"];
const roomSelect = { id: true, capsuleId: true, objective: true, status: true, backlogItemId: true,
  repositoryFullName: true, headSha: true, leaseHolderPrincipalId: true, leaseExpiresAt: true,
  scopeClaims: true, workspaceState: true } as const;

/** Read an existing executor note, without making it a task or graph-branch receipt. */
function manualCheckpoint(room: { capsuleId: string; workspaceState: unknown;
  repositoryFullName: string | null; headSha: string | null }): ContinuationAdvisoryCheckpoint | undefined {
  const raw = isRecord(room.workspaceState) ? room.workspaceState.executorCheckpoint : undefined;
  if (raw == null) return undefined;
  const record = storedExecutorCheckpoint(room.workspaceState);
  const parsed = parseExecutorCheckpoint(record);
  const repositoryBound = room.repositoryFullName !== null || room.headSha !== null;
  const sourceMatches = parsed.ok && (repositoryBound
    ? Boolean(parsed.data.headSha && parsed.data.headSha === room.headSha) : parsed.data.headSha === undefined);
  return {
    scope: "room", stageBinding: "unbound",
    sourceStatus: sourceMatches ? repositoryBound ? "head-matches" : "not-applicable" : "reconciliation-required",
    reason: !parsed.ok ? "checkpoint-invalid" : !sourceMatches ? "source-missing-or-changed" : null,
    recordedAt: typeof record?.recordedAt === "string" && Number.isFinite(Date.parse(record.recordedAt)) ? record.recordedAt : null,
    recordedByPrincipalId: typeof record?.recordedByPrincipalId === "string" ? record.recordedByPrincipalId : null,
    reference: { kind: "executor-checkpoint", id: room.capsuleId, version: digest(raw) },
    resultPath: ["data", "capsule", "workspaceState", "executorCheckpoint"],
    checkpoint: sourceMatches && parsed.ok ? parsed.data : null,
  };
}

/** This view shares assignment facts with native dispatch. It creates no session,
 * writes no checkpoint and never promotes task status into an outcome receipt. */
export async function readWorkroomContinuation(
  params: Record<string, unknown>, userId?: string, context?: ToolExecutionContext,
): Promise<ToolResult> {
  if (params.continuationMode !== "bounded" || incompatibleFields.some(key => params[key] !== undefined)
    || (params.continuationTaskId !== undefined && params.continuationStageKey !== undefined)
    || selectorFields.some(key => params[key] !== undefined && (typeof params[key] !== "string" || !params[key].trim() || params[key].length > 512))
    || (params.continuationVersion !== undefined && !/^[a-f0-9]{64}$/.test(params.continuationVersion as string))) {
    return refused("invalid_continuation_read", "Use continuationMode:bounded with one exact task or current stage selector, separately from activity, review and cursor reads.");
  }
  const capsuleId = typeof params.capsuleId === "string" ? params.capsuleId.trim() : "";
  if (!capsuleId) return refused("missing_capsuleId", "capsuleId is required.");
  if (!userId) return denied();
  const taskId = typeof params.continuationTaskId === "string" ? params.continuationTaskId.trim() : null;
  const requestedStage = typeof params.continuationStageKey === "string" ? params.continuationStageKey.trim() : null;
  try {
    return await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '4s'`;
      // Identity only until the existing admission resolver approves this reader.
      const identity = await tx.workroom.findUnique({ where: { capsuleId }, select: { id: true, capsuleId: true } });
      if (!identity) return refused("not_found", "Workroom not found.");
      const admission = () => {
        const input = { userId, workroomId: identity.id, requested: "content" as const };
        return context?.agentId ? resolveAgentWorkroomAccess({ ...input, agentId: context.agentId }, tx)
          : resolveHumanWorkroomAccess(input, tx);
      };
      const initialAccess = await admission();
      if (initialAccess.decision.level !== "content") return denied();
      const room = await tx.workroom.findUnique({ where: { id: identity.id }, select: roomSelect });
      if (!room) return refused("not_found", "Workroom not found.");
      const shape = resolveWorkShapeClaim(room.scopeClaims);
      if (!shape) return refused("continuation_stage_unavailable", "The current declared work shape could not be resolved; no stage is invented.");
      const definition = readWorkShapeDefinitionContract(shape);
      const observation = projectStoredWorkroomDriveObservation(room.workspaceState);
      const stored = readStoredWorkroomDriveState(room.workspaceState);
      const drive = isRecord(room.workspaceState) && isRecord(room.workspaceState.workroomDrive) ? room.workspaceState.workroomDrive : null;
      const runKey = driveRunKeyOf(drive);
      // Null cycle preserves a stored run. Never derive a first stage or start a run.
      const markingRead = drive?.marking !== undefined ? readStoredDriveMarking(room.workspaceState, definition, null) : null;
      if (markingRead && !markingRead.ok) return refused("continuation_stage_unavailable", "The current branch marking is unreadable. Reconcile the room before continuing.");
      const marking = markingRead?.ok ? markingRead.data.marking : null;
      const currentStages = marking ? markedStageKeys(definition, marking) : observation.currentStageKey ? [observation.currentStageKey] : [];
      const task = taskId ? await tx.scheduledAgentTask.findUnique({ where: { taskId },
        select: { taskId: true, agentId: true, taskConfig: true } }) : null;
      const checkpoint = task && isRecord(task.taskConfig) ? readDispatchCheckpoint(task.taskConfig.workroomDispatchCheckpoint) : null;
      if (taskId && (!task || task.taskId !== taskId || !checkpoint)) return staleBinding();
      const taskStage = task ? readWorkroomStageTaskConfig(task.taskConfig) : null;
      if (checkpoint && (!taskStage || taskStage.shapeKey !== checkpoint.stage.shapeKey
        || taskStage.shapeVersion !== checkpoint.stage.shapeVersion || taskStage.stageKey !== checkpoint.stage.stageKey
        || toolSet(taskStage.tools) !== toolSet(checkpoint.stage.tools))) return staleBinding();
      const stageKey = checkpoint?.stage.stageKey ?? requestedStage ?? (currentStages.length === 1 ? currentStages[0] : null);
      if (!stageKey) return refused(currentStages.length > 1 ? "continuation_stage_required" : "continuation_stage_unavailable",
        "Select one current branch with continuationStageKey or its exact continuationTaskId. No first-stage fallback is used.");
      if (!currentStages.includes(stageKey) || !definition.stages.some(stage => stage.key === stageKey)) {
        return checkpoint ? staleBinding() : refused("continuation_stage_unavailable", "The selected stage is not a current branch of the declared shape.");
      }
      const iteration = marking ? iterationOf(marking, stageKey) : null;
      const leaseExpiresAt = room.leaseExpiresAt?.toISOString() ?? null;
      const currentSource = { repositoryFullName: room.repositoryFullName, headSha: room.headSha };
      if (checkpoint && (checkpoint.roomId !== room.id || checkpoint.confirmedEffect.taskId !== taskId
        || checkpoint.stage.shapeKey !== shape.key || checkpoint.stage.shapeVersion !== shape.version
        || checkpoint.objective !== room.objective || !checkpoint.dispatchScope
        || checkpoint.dispatchScope.runKey !== runKey
        || (marking ? checkpoint.dispatchScope.iteration !== iteration || stageToken(marking, stageKey)?.taskId !== taskId : drive?.taskId !== taskId)
        || checkpoint.authority.holderPrincipalId !== room.leaseHolderPrincipalId
        || !leaseExpiresAt || Date.parse(checkpoint.authority.leaseExpiresAt) !== Date.parse(leaseExpiresAt)
        || Date.parse(leaseExpiresAt) <= Date.now()
        || (checkpoint.source && (checkpoint.source.repositoryFullName !== currentSource.repositoryFullName
          || checkpoint.source.headSha !== currentSource.headSha)))) return staleBinding();
      const backlog = room.backlogItemId ? await tx.backlogItem.findFirst({
        where: { OR: [{ id: room.backlogItemId }, { itemId: room.backlogItemId }] }, select: { itemId: true },
      }) : null;
      const briefInput = stageBriefInputFromDefinition({ capsuleId: room.capsuleId, roomObjective: room.objective,
        backlogItemKey: backlog?.itemId ?? null, shapeKey: shape.key, shapeVersion: shape.version, definition, stageKey });
      // Tools come from the same pinned definition; a changed task contract is stale.
      if (checkpoint && toolSet(checkpoint.stage.tools) !== toolSet(briefInput.stageTools ?? [])) return staleBinding();
      const terminal = TERMINAL_WORKROOM_STATUSES.has(room.status);
      const stopped = terminal || ["blocked", "paused"].includes(room.status);
      // A scheduled task uses only its own receipt; global executor notes belong to manual recovery.
      const advisoryCheckpoint = taskId === null ? manualCheckpoint(room) : undefined;
      const reconcileCheckpoint = advisoryCheckpoint?.sourceStatus === "reconciliation-required";
      const stopReasons = [...observation.stopConditionHits, ...(stopped ? [`room-status:${room.status}`] : [])];
      if (reconcileCheckpoint) stopReasons.push("executor-checkpoint-reconciliation-required");
      const input: ContinuationBriefInput = {
        brief: briefInput,
        ...(advisoryCheckpoint ? { advisoryCheckpoint } : {}),
        identity: { taskId, runKey: checkpoint?.dispatchScope?.runKey ?? runKey,
          cycleKey: checkpoint?.dispatchScope?.cycleKey ?? stored.lastCycleKey, iteration: checkpoint?.dispatchScope?.iteration ?? iteration },
        source: checkpoint ? checkpoint.source ?? { repositoryFullName: null, headSha: null } : currentSource,
        owner: { principalId: room.leaseHolderPrincipalId, agentId: task?.agentId ?? null },
        state: { status: checkpoint ? "scheduled" : room.status, roomStatus: room.status, leaseExpiresAt, stopReasons,
          budgetUsage: stored.budgetUsage,
          nextAction: checkpoint ? checkpoint.nextAction : terminal ? "observe-terminal-room"
            : stopped || observation.stopConditionHits.length ? "resolve-room-stop-before-stage-work"
            : reconcileCheckpoint ? "reconcile-executor-checkpoint"
            : advisoryCheckpoint ? "review-room-checkpoint-before-stage-work" : "revalidate-authority-and-record-stage-work" },
      };
      const projection = buildContinuationBrief(input);
      if (!projection.success) return projection;
      const activities = await tx.workroomActivity.findMany({ where: { workCapsuleId: room.id },
        orderBy: [{ recordedAt: "desc" }, { id: "desc" }], take: 8,
        select: { id: true, kind: true, sequence: true, recordedAt: true } });
      // A grant removal while reading suppresses all fetched content.
      const finalAccess = await admission();
      if (finalAccess.decision.level !== "content") return denied();
      if (digest(initialAccess) !== digest(finalAccess)) return staleVersion();
      const continuationVersion = digest({ input, checkpointRevision: checkpoint?.revision ?? null, activities,
        currentSource, currentStages, scopeClaims: room.scopeClaims, authority: finalAccess,
        caller: { userId, agentId: context?.agentId ?? null, apiTokenId: context?.apiTokenId ?? null,
          authSource: context?.authSource ?? null, tokenScope: context?.tokenScope ?? null,
          tokenGrantScopes: [...(context?.tokenGrantScopes ?? [])].sort() } });
      if (params.continuationVersion !== undefined && params.continuationVersion !== continuationVersion) return staleVersion();
      const rows = activities.map(activity => ({ ...activity, recordedAt: activity.recordedAt.toISOString(), payloadDeferred: true,
        detail: { toolName: "get_workroom", arguments: { capsuleId, activityMode: "bounded", activityId: activity.id } } }));
      let rendered: Extract<ContinuationBriefResult, { success: true }> = projection;
      const result = (): ToolResult => ({ success: true, entityId: capsuleId,
        message: "Recorded facts only: revalidate authority and source before effects; reconcile unknown outcomes before repeats. Capture actual outcomes through record_workroom_evidence and existing scoped effort-context routes when authorized.",
        data: { continuation: rendered.brief, continuationVersion, sourceState: checkpoint ? checkpoint.source ? "recorded" : "unknown" : "current",
          reconciliationRequired: Boolean(checkpoint) || reconcileCheckpoint, deferred: rendered.deferred, activities: rows,
          activityCoverage: { complete: false, windowLimit: 8, returned: rows.length,
            lookup: { toolName: "get_workroom", arguments: { capsuleId, activityMode: "bounded" } } } } });
      // Budget the complete response independently of a consumer's model window.
      // A smaller actual consumer cap must refuse the assignment as a whole.
      const fits = () => countTokens(JSON.stringify(result())) <= CONTINUATION_BRIEF_MAX_TOKENS;
      // Whole optional metadata records are deferred to the existing bounded reader.
      while (rows.length && !fits()) rows.pop();
      if (!fits() && rendered.brief.shapeDescription) {
        // Ask the shared renderer to defer its sole optional prose field.
        const compact = buildContinuationBrief({ ...input, maxTokens: projection.estimatedTokens - 1 });
        if (compact.success) rendered = compact;
      }
      return fits() ? result() : budgetRefusal();
    }, { timeout: 5_000, maxWait: 1_000 });
  } catch {
    return refused("continuation_read_unavailable", "The bounded continuation read did not complete. No execution permission or complete outcome is reported.");
  }
}
