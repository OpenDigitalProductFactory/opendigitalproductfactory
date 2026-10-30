// Server-resolved writes for a scheduled Workroom stage (BI-C1781121, BI-D95FD249).
// Legacy standing stages use their declared bindings. Delivery author stages
// additionally revalidate the immutable dispatch, current author authorization,
// funding, membership and the exact evidence effect. Nothing here grants tools.
import type { Prisma } from "@dpf/db";
import { coworkerAuthorityAgentId } from "@/lib/coworker-identity";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";
import { readWorkroomStageTaskConfig } from "@/lib/scheduling/workroom-stage-task-config";
import {
  parseQualificationExperimentState,
  qualificationToolEffectAllowed,
  qualificationBindingDigest,
  verifyQualificationExperimentAdmission,
} from "@/lib/backlog/initiative-readiness/qualification-research-admission";
import { isRecord } from "@/lib/shared/coerce";
import { boundStagePrincipal, parseAccountablePrincipalRef, workroomDriveTaskId, workroomDriveBranchTaskId } from "./drive-resolution";
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
import { loadHandedOverUserIds, ROOM_OWNER_USER_INCLUDE, roomOwnerUserId } from "./delivery-room-ownership";

type ReportCall = {
  toolName?: string;
  params?: Readonly<Record<string, unknown>>;
  allowBlockedReport?: boolean;
};

export const SCHEDULED_RUN_PREFIX = "TR-SCHED-";

export type MandateRoom = {
  capsuleId: string; status: string; archivedAt: Date | null; scopeClaims: unknown;
  id?: string; backlogItemId?: string | null; workspaceState?: unknown;
  repositoryFullName?: string | null; baseSha?: string | null; headSha?: string | null;
  leaseHolderPrincipalId?: string | null; leaseExpiresAt?: Date | null;
};

// BI-17238133: each select is checked against the generated Prisma types, so a
// field the model does not have fails typecheck instead of every scheduled run.
// Workroom has no owner column; its task owner is derived exactly as the drive
// derives it (requester/creator user, else the accountable person).
const RUN_SELECT = {
  a2aMetadata: true, status: true, currentAgentId: true, userId: true, startedAt: true, archivedAt: true,
} as const satisfies Prisma.TaskRunSelect;
const ROOM_SELECT = {
  id: true, capsuleId: true, status: true, archivedAt: true, scopeClaims: true, backlogItemId: true, workspaceState: true,
  repositoryFullName: true, baseSha: true, headSha: true, leaseHolderPrincipalId: true, leaseExpiresAt: true,
  requestedByPrincipal: ROOM_OWNER_USER_INCLUDE.requestedByPrincipal,
  createdByPrincipal: ROOM_OWNER_USER_INCLUDE.createdByPrincipal,
} as const satisfies Prisma.WorkroomSelect;
const TASK_SELECT = {
  taskId: true, taskConfig: true, agentId: true, taskRunId: true, ownerUserId: true, isActive: true,
} as const satisfies Prisma.ScheduledAgentTaskSelect;

type OwnerAliases = { aliases: Array<{ aliasValue: string }> } | null;
export type MandateRoomRow = MandateRoom & { requestedByPrincipal?: OwnerAliases; createdByPrincipal?: OwnerAliases };

/** The declared writes the room grants one of `agentIds` on its own drive task. Pure. */
export function roomStageMandatedTools(input: {
  scheduledTaskId: string;
  room: MandateRoom;
  agentIds: readonly string[];
  /** Server-read task assignment for a role stage the drive assigned dynamically. */
  assignedStageKey?: string | null;
} & ReportCall): string[] {
  const { room } = input;
  if (room.archivedAt !== null || TERMINAL_WORKROOM_STATUSES.has(room.status)) return [];
  const shape = resolveWorkShapeClaim(room.scopeClaims);
  if (!shape) return [];
  const bindings = readWorkShapeRoleBindings(room.scopeClaims);
  const tools = new Set<string>();
  for (const stage of shape.stages) {
    if (input.scheduledTaskId !== workroomDriveTaskId(room.capsuleId, shape.key)
      && input.scheduledTaskId !== workroomDriveBranchTaskId(room.capsuleId, shape.key, stage.key)) continue;
    if (stage.advance.kind === "governed-decision") continue;
    const principal = parseAccountablePrincipalRef(boundStagePrincipal(stage.accountablePrincipalRef, false, bindings));
    // Delivery completion also requires current funding and dispatch provenance below.
    if (!isDeliveryShapeKey(shape.key) && principal.kind === "agent" && input.agentIds.includes(principal.value)) {
      for (const tool of stage.mandatedTools ?? []) tools.add(tool);
    }
    // Reporting failure does not authorize success or the stage's business act.
    // The run, room, assignment and declared evidence kind constrain this call.
    const assigned = input.assignedStageKey === stage.key
      && (principal.kind === "role" || principal.kind === "agent" && input.agentIds.includes(principal.value));
    const p = input.params;
    if (assigned && input.allowBlockedReport !== false && input.toolName === "record_workroom_evidence"
      && p?.capsuleId === room.capsuleId && p.stageKey === stage.key && p.outcome === "blocked"
      && typeof p.summary === "string" && p.summary.trim().length > 0
      && typeof p.kind === "string" && stage.evidence.some((kind) => kind === p.kind)) {
      tools.add("record_workroom_evidence");
    }
  }
  return [...tools].sort();
}

type RunSnapshot = {
  a2aMetadata: unknown; status?: string; currentAgentId?: string | null;
  userId?: string; startedAt?: Date; archivedAt?: Date | null;
};
type TaskSnapshot = {
  taskId?: string; taskConfig: unknown; agentId: string; taskRunId?: string | null; ownerUserId?: string; isActive?: boolean;
};
export type RoomMandateDb = {
  taskRun: { findUnique(args: { where: { taskRunId: string }; select: typeof RUN_SELECT }): Promise<RunSnapshot | null> };
  workroom: { findMany(args: { where: { capsuleId: { in: string[] } }; select: typeof ROOM_SELECT }): Promise<MandateRoomRow[]> };
  scheduledAgentTask?: { findUnique(args: { where: { taskId: string }; select: typeof TASK_SELECT }): Promise<TaskSnapshot | null> };
};
export type ScheduledRoomMandateInput = {
  taskRunId: string | null | undefined; agentIds: readonly string[]; a2aMetadata?: unknown;
} & ReportCall;
export type ScheduledRoomAuthority = {
  mandatedTools: string[]; roomTurn: RoomTurnAuthority | null; withheldBecause: string | null;
  deliveryStage: { capsuleId: string; stageKey: string; evidenceKinds: readonly string[] } | null;
};
export type ScheduledRoomAuthorityDeps = {
  now?: () => Date;
  loadAuthorStageAutonomy?: (rooms: readonly MandateRoom[], now: Date) => Promise<AuthorStageAutonomyFor>;
  loadRoomTurnAuthority?: (input: { agentId: string; capsuleId: string }) => Promise<RoomTurnAuthority>;
  loadAgentGrants?: (agentId: string) => Promise<string[]>;
  /** The user the room's drive task runs for (recorded owner, else accountable person). */
  resolveRoomTaskOwnerUserId?: (room: MandateRoomRow) => Promise<string | null>;
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
    if (!shape.stages.some((stage) => stage.mandatedTools?.length || stage.advance.kind !== "governed-decision")) continue;
    for (const suffix of [`-${shape.key}`, ...shape.stages.map((stage) => `-${shape.key}--${stage.key}`)]) {
      if (taskId.endsWith(suffix) && taskId.length > "workroom-".length + suffix.length) {
        ids.add(taskId.slice("workroom-".length, -suffix.length));
      }
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
        select: RUN_SELECT }))?.a2aMetadata;
  const source = isRecord(metadata) && isRecord(metadata.sourceRef) ? metadata.sourceRef : null;
  const taskId = source?.kind === "scheduled-task" && typeof source.id === "string" ? source.id : null;
  const capsuleIds = taskId ? candidateCapsuleIds(taskId) : [];
  if (!taskId || capsuleIds.length === 0) return EMPTY;
  const rooms = await db.workroom.findMany({ where: { capsuleId: { in: capsuleIds } },
    select: ROOM_SELECT });
  for (const room of rooms) {
    const shape = resolveWorkShapeClaim(room.scopeClaims);
    if (!shape || (taskId !== workroomDriveTaskId(room.capsuleId, shape.key)
      && !shape.stages.some(stage => taskId === workroomDriveBranchTaskId(room.capsuleId, shape.key, stage.key)))) continue;
    const task = await db.scheduledAgentTask?.findUnique({ where: { taskId },
      select: TASK_SELECT });
    const assignment = task?.taskRunId === input.taskRunId && input.agentIds.some(id => sameActor(id, task.agentId))
      ? readWorkroomStageTaskConfig(task.taskConfig) : null;
    const assignedStageKey = assignment?.shapeKey === shape.key && assignment?.shapeVersion === shape.version ? assignment.stageKey : null;
    const declared = roomStageMandatedTools({ ...input, scheduledTaskId: taskId, room, assignedStageKey });
    const declaration = readWorkroomPostureClaim(room.scopeClaims);
    if (assignment?.qualificationExperiment) {
      if (room.archivedAt !== null || room.status !== "working" || TERMINAL_WORKROOM_STATUSES.has(room.status)) {
        return withheld("The qualification Workroom is no longer active.");
      }
      run ??= await db.taskRun.findUnique({ where: { taskRunId: input.taskRunId }, select: RUN_SELECT });
      const workspace = isRecord(room.workspaceState) ? room.workspaceState : {};
      const state = parseQualificationExperimentState(workspace.qualificationExperimentAdmission);
      const runState = isRecord(run?.a2aMetadata) ? run.a2aMetadata : {};
      const runBinding = isRecord(runState.qualificationExperiment) ? runState.qualificationExperiment : null;
      const qualificationNow = (deps.now ?? (() => new Date()))();
      const verified = state ? verifyQualificationExperimentAdmission(state.token, { now: qualificationNow }) : null;
      const binding = assignment.qualificationExperiment;
      const digest = qualificationBindingDigest(binding);
      const exactRoom = room.backlogItemId === binding.itemId && room.capsuleId === binding.workroomId
        && room.repositoryFullName === binding.repositoryFullName
        && room.baseSha?.toLowerCase() === binding.baseSha.toLowerCase()
        && room.headSha?.toLowerCase() === binding.headSha.toLowerCase()
        && room.leaseHolderPrincipalId === binding.accountablePrincipalRef
        && room.leaseExpiresAt != null && room.leaseExpiresAt.getTime() > qualificationNow.getTime();
      if (!run || run.status !== "working" || run.archivedAt != null || !run.currentAgentId
        || !sameActor(run.currentAgentId, task?.agentId ?? "") || !task?.isActive
        || !state || state.status !== "started" || state.startCount !== 1 || state.taskId !== taskId
        || !verified?.ok || verified.data.bindingDigest !== digest || state.bindingDigest !== digest
        || qualificationBindingDigest(runBinding as typeof binding) !== digest || !exactRoom) {
        return withheld("The qualification admission is missing, expired, superseded, or not bound to this run.");
      }
      // Qualification tools are a signed, one-shot exception to the standing
      // shape's ordinary read/write list. The current shape+stage identity is
      // revalidated above; the token and task assignment must both name each
      // exceptional tool, so neither source can widen the other.
      const grants = await (deps.loadAgentGrants
        ?? (await import("@/lib/tak/agent-grants")).getAgentToolGrantsAsync)(coworkerAuthorityAgentId(task.agentId));
      const tools = assignment.tools.filter((tool) => binding.permittedTools.includes(tool)
        && isToolAllowedByGrants(tool, grants));
      if (tools.length === 0) return withheld("The qualification task no longer declares an admitted tool.");
      if (!input.toolName) return { ...EMPTY, mandatedTools: tools };
      if (!tools.includes(input.toolName)) return withheld("The tool is outside the qualification admission.");
      if (!qualificationToolEffectAllowed({ binding: assignment.qualificationExperiment, state,
        toolName: input.toolName, params: input.params, now: qualificationNow })) {
        return withheld("The qualification tool effect is outside the exact path, duration, or terminal-evidence binding.");
      }
      return { ...EMPTY, mandatedTools: [input.toolName] };
    }
    // BI-E458A9CB: an exact blocked report survives lost completion authority.
    if (!isDeliveryShapeKey(shape.key) || (input.params?.outcome === "blocked" && declared.includes(EVIDENCE_WRITER)
      && declaration?.actionBoundary !== "advise" && declaration?.actionBoundary !== "propose")) {
      return { ...EMPTY, mandatedTools: declared };
    }
    // This server-derived legacy flag also preserves always-review for the new completion mandate.
    if (input.allowBlockedReport === false) return EMPTY;
    try {
      if (room.archivedAt !== null || TERMINAL_WORKROOM_STATUSES.has(room.status)
        || shape.key === DELIVERY_XLARGE_SHAPE_KEY) return withheld("The delivery room is not active for author execution.");
      run ??= await db.taskRun.findUnique({ where: { taskRunId: input.taskRunId },
        select: RUN_SELECT });
      if (!run || run.status !== "working" || run.archivedAt != null || !run.currentAgentId
        || !task?.isActive || task.taskId !== taskId || task.taskRunId !== input.taskRunId
        || run.userId !== task.ownerUserId
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
      const roomOwner = await (deps.resolveRoomTaskOwnerUserId ?? liveRoomTaskOwnerUserId)(room);
      if (!roomOwner || roomOwner !== task.ownerUserId) return withheld("The scheduled run no longer owns this delivery dispatch.");
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
        || typeof args.summary !== "string" || args.summary.trim().length === 0
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

/** The drive's own owner rule (BI-D13FA12A), re-read live; never an invented room field. */
async function liveRoomTaskOwnerUserId(room: MandateRoomRow): Promise<string | null> {
  if (!room.id) return null;
  const [{ prisma }, owner] = await Promise.all([
    import("@dpf/db"), import("@/lib/queue/functions/workroom-drive-task-owner"),
  ]);
  const recordedOwnerUserId = roomOwnerUserId(room, await loadHandedOverUserIds(prisma));
  return owner.resolveRoomDriveTaskOwnerUserId({ id: room.id, recordedOwnerUserId },
    owner.liveDriveTaskOwnerEffects(async () => prisma));
}

/** Call authorization requires effect parameters for delivery; old callers cannot widen it. */
export async function loadScheduledRoomMandate(
  db: RoomMandateDb, input: ScheduledRoomMandateInput, deps: ScheduledRoomAuthorityDeps = {},
): Promise<string[]> {
  const authority = await loadScheduledRoomAuthority(db, input, deps);
  return authority.deliveryStage && (!input.toolName || !input.params) ? [] : authority.mandatedTools;
}

export async function loadScheduledRoomAuthorityLive(input: {
  taskRunId: string | null; agentId: string;
} & ReportCall): Promise<ScheduledRoomAuthority> {
  if (!input.taskRunId?.startsWith(SCHEDULED_RUN_PREFIX)) return EMPTY;
  const { prisma } = await import("@dpf/db");
  const agent = await prisma.agent.findFirst({ where: { OR: [{ id: input.agentId }, { agentId: input.agentId }, { slugId: input.agentId }], status: "active", archived: false },
    select: { id: true, agentId: true, slugId: true, governanceProfile: { select: { hitlPolicy: true } } } });
  if (!agent) return EMPTY;
  return loadScheduledRoomAuthority(prisma as unknown as RoomMandateDb, { ...input,
    agentIds: [agent.id, agent.agentId, agent.slugId].filter((id): id is string => Boolean(id)),
    allowBlockedReport: input.allowBlockedReport !== false && agent.governanceProfile?.hitlPolicy.trim().toLowerCase() !== "always" });
}

export async function loadScheduledRoomMandateLive(input: {
  taskRunId: string | null; agentId: string;
} & ReportCall): Promise<string[]> {
  const authority = await loadScheduledRoomAuthorityLive(input);
  return authority.deliveryStage && (!input.toolName || !input.params) ? [] : authority.mandatedTools;
}
