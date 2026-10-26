// Server-resolved writes for a scheduled Workroom stage (BI-C1781121, BI-D95FD249).
// Legacy standing stages use their declared bindings. Delivery author stages
// additionally revalidate the immutable dispatch, current author authorization,
// funding, membership and the exact evidence effect. Nothing here grants tools.
import { coworkerAuthorityAgentId } from "@/lib/coworker-identity";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";
import { readWorkroomStageTaskConfig } from "@/lib/scheduling/workroom-stage-task-config";
import { isRecord } from "@/lib/shared/coerce";
import { boundStagePrincipal, parseAccountablePrincipalRef, workroomDriveTaskId } from "./drive-resolution";
import { isDeliveryShapeKey, DELIVERY_XLARGE_SHAPE_KEY, DELIVERY_AUTHOR_ROLE, DELIVERY_AUTHOR_EVIDENCE_TOOL as EVIDENCE_WRITER } from "./delivery-shapes";
import type { AuthorStageAutonomyFor } from "./author-stage-autonomy-live";
import type { RoomTurnAuthority } from "./room-turn-authority";
import { roomAuthorizesTool } from "./room-turn-authority";
import { readWorkroomPostureClaim } from "./workroom-posture-claim";
import { readDispatchCheckpoint, type DispatchCheckpoint } from "./workroom-drive-checkpoint";
import { driveRunKeyOf, readStoredWorkroomDriveState } from "./workroom-drive-state";
import { TERMINAL_WORKROOM_STATUSES } from "./standing-room-nesting";
import { listWorkShapes } from "./work-shapes";
import { readWorkShapeRoleBindings, resolveWorkShapeClaim } from "./workroom-shape-claim";

export const SCHEDULED_RUN_PREFIX = "TR-SCHED-";

export type MandateRoom = {
  capsuleId: string; status: string; archivedAt: Date | null; scopeClaims: unknown;
  id?: string; backlogItemId?: string | null; workspaceState?: unknown;
};

/** Existing standing-stage declaration reader; delivery execution uses the live loader below. */
export function roomStageMandatedTools(input: {
  scheduledTaskId: string; room: MandateRoom; agentIds: readonly string[];
}): string[] {
  const { room } = input;
  if (room.archivedAt !== null || TERMINAL_WORKROOM_STATUSES.has(room.status)) return [];
  const shape = resolveWorkShapeClaim(room.scopeClaims);
  if (!shape || input.scheduledTaskId !== workroomDriveTaskId(room.capsuleId, shape.key)) return [];
  const bindings = readWorkShapeRoleBindings(room.scopeClaims);
  const tools = new Set<string>();
  for (const stage of shape.stages) {
    if (!stage.mandatedTools?.length || stage.advance.kind === "governed-decision") continue;
    const principal = parseAccountablePrincipalRef(boundStagePrincipal(stage.accountablePrincipalRef, false, bindings));
    if (principal.kind === "agent" && input.agentIds.includes(principal.value)) {
      for (const tool of stage.mandatedTools) tools.add(tool);
    }
  }
  return [...tools].sort();
}

type RunSnapshot = {
  a2aMetadata: unknown; status?: string; currentAgentId?: string | null;
  userId?: string; startedAt?: Date; archivedAt?: Date | null;
};
type TaskSnapshot = {
  taskId: string; taskConfig: unknown; agentId: string; ownerUserId: string; isActive: boolean;
};
export type RoomMandateDb = {
  taskRun: { findUnique(args: unknown): Promise<RunSnapshot | null> };
  workroom: { findMany(args: unknown): Promise<MandateRoom[]> };
  scheduledAgentTask?: { findUnique(args: unknown): Promise<TaskSnapshot | null> };
};
export type ScheduledRoomMandateInput = {
  taskRunId: string | null | undefined; agentIds: readonly string[]; a2aMetadata?: unknown;
  toolName?: string; params?: Record<string, unknown>;
};
export type ScheduledRoomAuthority = {
  mandatedTools: string[]; roomTurn: RoomTurnAuthority | null; withheldBecause: string | null;
  deliveryStage: { capsuleId: string; stageKey: string; evidenceKinds: readonly string[] } | null;
};
export type ScheduledRoomAuthorityDeps = {
  now?: () => Date;
  loadAuthorStageAutonomy?: (rooms: readonly MandateRoom[], now: Date) => Promise<AuthorStageAutonomyFor>;
  loadRoomTurnAuthority?: (input: { agentId: string; capsuleId: string }) => Promise<RoomTurnAuthority>;
  loadAgentGrants?: (agentId: string) => Promise<string[]>;
};
const EMPTY: ScheduledRoomAuthority = {
  mandatedTools: [], roomTurn: null, withheldBecause: null, deliveryStage: null,
};
const withheld = (because: string): ScheduledRoomAuthority => ({ ...EMPTY, withheldBecause: because });
const sameActor = (a: string, b: string) => coworkerAuthorityAgentId(a) === coworkerAuthorityAgentId(b);

function candidateCapsuleIds(taskId: string): string[] {
  if (!taskId.startsWith("workroom-")) return [];
  const ids = new Set<string>();
  for (const shape of listWorkShapes()) {
    if (!isDeliveryShapeKey(shape.key) && !shape.stages.some((stage) => stage.mandatedTools?.length)) continue;
    const suffix = `-${shape.key}`;
    if (taskId.endsWith(suffix) && taskId.length > "workroom-".length + suffix.length) {
      ids.add(taskId.slice("workroom-".length, -suffix.length));
    }
  }
  return [...ids];
}

/** Compare the existing checkpoint's full admission identity without JSON object-key ordering. */
function checkpointKey(c: DispatchCheckpoint): string {
  return JSON.stringify([c.version, c.revision, c.roomId, c.objective,
    c.confirmedEffect.kind, c.confirmedEffect.taskId, c.confirmedEffect.recordedAt,
    c.stage.shapeKey, c.stage.shapeVersion, c.stage.stageKey, [...c.stage.tools].sort(),
    c.authority.holderPrincipalId, c.authority.leaseExpiresAt,
    c.dispatchScope?.runKey, c.dispatchScope?.cycleKey, c.dispatchScope?.iteration]);
}

/** One reconstruction for attachment, proposal interception and the reference monitor. */
export async function loadScheduledRoomAuthority(
  db: RoomMandateDb, input: ScheduledRoomMandateInput, deps: ScheduledRoomAuthorityDeps = {},
): Promise<ScheduledRoomAuthority> {
  if (!input.taskRunId?.startsWith(SCHEDULED_RUN_PREFIX) || input.agentIds.length === 0) return EMPTY;
  let run: RunSnapshot | null = null;
  const metadata = input.a2aMetadata !== undefined ? input.a2aMetadata
    : (run = await db.taskRun.findUnique({ where: { taskRunId: input.taskRunId },
        select: { a2aMetadata: true, status: true, currentAgentId: true, userId: true, startedAt: true, archivedAt: true } }))?.a2aMetadata;
  const source = isRecord(metadata) && isRecord(metadata.sourceRef) ? metadata.sourceRef : null;
  const taskId = source?.kind === "scheduled-task" && typeof source.id === "string" ? source.id : null;
  const capsuleIds = taskId ? candidateCapsuleIds(taskId) : [];
  if (!taskId || capsuleIds.length === 0) return EMPTY;
  const rooms = await db.workroom.findMany({ where: { capsuleId: { in: capsuleIds } },
    select: { id: true, capsuleId: true, status: true, archivedAt: true, scopeClaims: true, backlogItemId: true, workspaceState: true } });
  for (const room of rooms) {
    const shape = resolveWorkShapeClaim(room.scopeClaims);
    if (!shape || taskId !== workroomDriveTaskId(room.capsuleId, shape.key)) continue;
    if (!isDeliveryShapeKey(shape.key)) return { ...EMPTY,
      mandatedTools: roomStageMandatedTools({ scheduledTaskId: taskId, room, agentIds: input.agentIds }) };
    try {
      if (room.archivedAt !== null || TERMINAL_WORKROOM_STATUSES.has(room.status)
        || shape.key === DELIVERY_XLARGE_SHAPE_KEY) return withheld("The delivery room is not active for author execution.");
      run ??= await db.taskRun.findUnique({ where: { taskRunId: input.taskRunId },
        select: { a2aMetadata: true, status: true, currentAgentId: true, userId: true, startedAt: true, archivedAt: true } });
      const task = await db.scheduledAgentTask?.findUnique({ where: { taskId },
        select: { taskId: true, taskConfig: true, agentId: true, ownerUserId: true, isActive: true } });
      if (!run || run.status !== "working" || run.archivedAt != null || !run.currentAgentId
        || !task?.isActive || task.taskId !== taskId || run.userId !== task.ownerUserId
        || !sameActor(run.currentAgentId, task.agentId)
        || !input.agentIds.some((id) => sameActor(id, task.agentId))) return withheld("The scheduled run no longer owns this delivery dispatch.");
      const stageConfig = readWorkroomStageTaskConfig(task.taskConfig);
      const taskState = isRecord(task.taskConfig) ? task.taskConfig : {};
      const workspace = isRecord(room.workspaceState) ? room.workspaceState : {};
      const runState = isRecord(run.a2aMetadata) ? run.a2aMetadata : {};
      const recordedSource = isRecord(runState.sourceRef) ? runState.sourceRef : null;
      if (runState.trigger !== "scheduled" || recordedSource?.kind !== "scheduled-task" || recordedSource.id !== taskId) {
        return withheld("The run no longer names this scheduled dispatch.");
      }
      const checkpoint = readDispatchCheckpoint(runState.workroomDispatchCheckpoint);
      const taskCheckpoint = readDispatchCheckpoint(taskState.workroomDispatchCheckpoint);
      const roomCheckpoint = readDispatchCheckpoint(workspace.workroomDispatchCheckpoint);
      const now = (deps.now ?? (() => new Date()))();
      if (!stageConfig || !checkpoint || !taskCheckpoint || !roomCheckpoint
        || checkpointKey(checkpoint) !== checkpointKey(taskCheckpoint)
        || checkpointKey(checkpoint) !== checkpointKey(roomCheckpoint)
        || checkpoint.roomId !== room.id || checkpoint.confirmedEffect.taskId !== taskId
        || checkpoint.stage.shapeKey !== shape.key || checkpoint.stage.shapeVersion !== shape.version
        || stageConfig.shapeKey !== checkpoint.stage.shapeKey || stageConfig.shapeVersion !== checkpoint.stage.shapeVersion
        || stageConfig.stageKey !== checkpoint.stage.stageKey
        || JSON.stringify([...stageConfig.tools].sort()) !== JSON.stringify([...checkpoint.stage.tools].sort())
        || readStoredWorkroomDriveState(room.workspaceState).currentStageKey !== stageConfig.stageKey
        || (checkpoint.dispatchScope && checkpoint.dispatchScope.runKey !== driveRunKeyOf(workspace.workroomDrive))
        || !run.startedAt || run.startedAt.getTime() < Date.parse(checkpoint.confirmedEffect.recordedAt)
        || now.getTime() >= Date.parse(checkpoint.authority.leaseExpiresAt)
        || Date.parse(checkpoint.confirmedEffect.recordedAt) > Date.parse(checkpoint.authority.leaseExpiresAt)) {
        return withheld("The delivery dispatch checkpoint is missing, expired or superseded.");
      }
      const stage = shape.stages.find((candidate) => candidate.key === stageConfig.stageKey);
      if (!stage || stage.advance.kind === "governed-decision"
        || stage.accountablePrincipalRef !== `role:${DELIVERY_AUTHOR_ROLE}`
        || !stage.mandatedTools?.includes(EVIDENCE_WRITER)) return withheld("This is not an admitted non-governed author stage.");
      const agentId = coworkerAuthorityAgentId(task.agentId);
      const declaration = readWorkroomPostureClaim(room.scopeClaims);
      if (declaration?.actionBoundary === "advise" || declaration?.actionBoundary === "propose") {
        const turn = await (deps.loadRoomTurnAuthority ?? (await import("./room-turn-authority.server")).loadRoomTurnAuthority)({ agentId, capsuleId: room.capsuleId });
        // Explicit posture still admits read/advice and exact proposals, never an automatic stage write.
        return { ...EMPTY, roomTurn: { ...turn, actionBoundary: declaration.actionBoundary } };
      }
      const [autonomyFor, turn, grants] = await Promise.all([
        (deps.loadAuthorStageAutonomy ?? (await import("./author-stage-autonomy-live")).loadAuthorStageAutonomy)([room], now),
        (deps.loadRoomTurnAuthority ?? (await import("./room-turn-authority.server")).loadRoomTurnAuthority)({ agentId, capsuleId: room.capsuleId }),
        (deps.loadAgentGrants ?? (await import("@/lib/tak/agent-grants")).getAgentToolGrantsAsync)(agentId),
      ]);
      const autonomy = autonomyFor(room, shape.key);
      const bindings = { ...autonomy.roleBindings, ...readWorkShapeRoleBindings(room.scopeClaims) };
      const principal = parseAccountablePrincipalRef(boundStagePrincipal(stage.accountablePrincipalRef, false, bindings));
      if (autonomy.withheldBecause || principal.kind !== "agent" || !sameActor(principal.value, task.agentId)
        || turn.workroomId !== room.capsuleId || !turn.memberOfRoom || !turn.handsOn.enabled
        || !roomAuthorizesTool(EVIDENCE_WRITER, turn.authorizedGrants)
        || !isToolAllowedByGrants(EVIDENCE_WRITER, grants)) {
        return withheld(autonomy.withheldBecause ?? "Current author, membership or tool authority does not admit this evidence.");
      }
      const authority: ScheduledRoomAuthority = {
        mandatedTools: [EVIDENCE_WRITER],
        // A stage mandate is narrower than general preauthorized room steering.
        roomTurn: { ...turn, actionBoundary: "propose" },
        withheldBecause: null,
        deliveryStage: { capsuleId: room.capsuleId, stageKey: stage.key, evidenceKinds: stage.evidence },
      };
      if (!input.toolName) return authority; // Attachment only, never call authorization.
      if (input.toolName !== EVIDENCE_WRITER) return { ...authority, mandatedTools: [] };
      const args = input.params;
      if (!args || args.capsuleId !== room.capsuleId || args.stageKey !== stage.key
        || typeof args.kind !== "string" || !(stage.evidence.some((kind) => kind === args.kind)
          || (args.outcome === "blocked" && args.kind === "note"))
        || (args.outcome !== "completed" && args.outcome !== "blocked")) {
        return { ...authority, mandatedTools: [], withheldBecause: "The evidence effect is outside the admitted room or stage." };
      }
      return authority;
    } catch {
      return withheld("The current delivery authority could not be established.");
    }
  }
  return EMPTY;
}

/** Call authorization requires effect parameters for delivery; old callers cannot widen it. */
export async function loadScheduledRoomMandate(
  db: RoomMandateDb, input: ScheduledRoomMandateInput, deps: ScheduledRoomAuthorityDeps = {},
): Promise<string[]> {
  const authority = await loadScheduledRoomAuthority(db, input, deps);
  return authority.deliveryStage && (!input.toolName || !input.params) ? [] : authority.mandatedTools;
}

export async function loadScheduledRoomAuthorityLive(input: {
  taskRunId: string | null; agentId: string; toolName?: string; params?: Record<string, unknown>;
}): Promise<ScheduledRoomAuthority> {
  if (!input.taskRunId?.startsWith(SCHEDULED_RUN_PREFIX)) return EMPTY;
  const { prisma } = await import("@dpf/db");
  return loadScheduledRoomAuthority(prisma as unknown as RoomMandateDb, { ...input, agentIds: [input.agentId] });
}

export async function loadScheduledRoomMandateLive(input: {
  taskRunId: string | null; agentId: string; toolName?: string; params?: Record<string, unknown>;
}): Promise<string[]> {
  const authority = await loadScheduledRoomAuthorityLive(input);
  return authority.deliveryStage && (!input.toolName || !input.params) ? [] : authority.mandatedTools;
}
