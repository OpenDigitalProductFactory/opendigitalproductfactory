import { vi } from "vitest";
import { AUTHOR_STAGE_AGENT_REF } from "../author-stage-autonomy";
import { DELIVERY_ACTIVITY_GRANTS } from "../delivery-shapes";
import { deriveRoomTurnAuthority, type RoomTurnAuthority } from "../room-turn-authority";
import type { AuthorStageAutonomyFor } from "../author-stage-autonomy-live";
import { buildDispatchCheckpoint } from "../workroom-drive-checkpoint";
import { buildWorkShapeClaim } from "../workroom-shape-claim";
import type { MandateRoomRow } from "../room-stage-mandate";
const NOW = new Date("2026-10-26T00:00:00Z");
const CAPSULE = "WC-DELIVERY-TEST";
const TASK = `workroom-${CAPSULE}-delivery-small`;
const AGENT = AUTHOR_STAGE_AGENT_REF.slice("agent:".length);
const STAGE = { shapeKey: "delivery-small", shapeVersion: "1.0.0", stageKey: "repair", tools: [] };

// In-memory test records only; this factory never writes TaskRun lifecycle state.
export function scheduledDeliveryFixture(runStatus = "working") {
  const stage = { ...STAGE, tools: [] as string[] };
  const checkpoint = buildDispatchCheckpoint(null, {
    taskId: TASK, roomId: "room-row", objective: "Repair the admitted defect",
    stage, holderPrincipalId: "driver",
    leaseExpiresAt: new Date(NOW.getTime() + 600_000).toISOString(),
    now: new Date(NOW.getTime() - 1000).toISOString(),
    dispatchScope: { runKey: "cycle-1", cycleKey: "cycle-1", iteration: 0 },
  });
  const room = {
    id: "room-row", capsuleId: CAPSULE, status: "working", archivedAt: null as Date | null,
    backlogItemId: "BI-TEST", scopeClaims: [buildWorkShapeClaim("delivery-small@1.0.0")] as unknown,
    workspaceState: { workroomDispatchCheckpoint: checkpoint, workroomDrive: { stageKey: "repair", runKey: "cycle-1" } },
    requestedByPrincipal: { aliases: [{ aliasValue: "owner" }] } as { aliases: Array<{ aliasValue: string }> } | null,
    createdByPrincipal: null as { aliases: Array<{ aliasValue: string }> } | null,
  };
  const task = { taskId: TASK, taskRunId: "TR-SCHED-DELIVERY", agentId: AGENT, ownerUserId: "owner", isActive: true,
    taskConfig: { workroomStage: stage, workroomDispatchCheckpoint: checkpoint } };
  const run = { taskRunId: "TR-SCHED-DELIVERY", currentAgentId: AGENT, userId: "owner",
    status: runStatus, archivedAt: null as Date | null, startedAt: new Date(NOW.getTime() - 500),
    a2aMetadata: { trigger: "scheduled", sourceRef: { kind: "scheduled-task", id: TASK },
      workroomDispatchCheckpoint: checkpoint } };
  const roomTurn = deriveRoomTurnAuthority({
    room: { workroomId: CAPSULE, collaborationShape: null, workShapeKey: "delivery-small@1.0.0",
      workShapeGrants: DELIVERY_ACTIVITY_GRANTS, declaredActionBoundary: null, declaredPriority: null,
      shapeActionBoundary: null, participants: [{ principalId: "agent", roles: ["author"] }], agentPrincipalId: "agent" },
    agentGrants: ["workroom_evidence_write"], platformDefaultActionBoundary: "preauthorized",
  });
  const agent = { id: "agent-row", agentId: "AGT-BUILD-SPECIALIST", slugId: AGENT, governanceProfile: null as { hitlPolicy: string } | null };
  const db = { agent: { findFirst: vi.fn(async () => agent) }, taskRun: { findUnique: vi.fn(async () => run) },
    scheduledAgentTask: { findUnique: vi.fn(async () => task) },
    workroom: { findMany: vi.fn(async () => [room]) },
    user: { findMany: vi.fn(async (): Promise<Array<{ id: string }>> => []) } };
  room.workspaceState.workroomDispatchCheckpoint = structuredClone(checkpoint);
  task.taskConfig.workroomDispatchCheckpoint = structuredClone(checkpoint);
  run.a2aMetadata.workroomDispatchCheckpoint = structuredClone(checkpoint);
  const deps = {
    now: () => NOW,
    loadAgentGrants: vi.fn(async (): Promise<string[]> => ["workroom_evidence_write"]),
    loadAuthorStageAutonomy: vi.fn(async (): Promise<AuthorStageAutonomyFor> => () => ({ roleBindings: { author: AUTHOR_STAGE_AGENT_REF }, withheldBecause: null })),
    loadRoomTurnAuthority: vi.fn(async (): Promise<RoomTurnAuthority> => roomTurn),
    // The drive's owner rule: the recorded requester/creator user (BI-17238133).
    resolveRoomTaskOwnerUserId: vi.fn(async (r: MandateRoomRow): Promise<string | null> => r.requestedByPrincipal?.aliases[0]?.aliasValue
      ?? r.createdByPrincipal?.aliases[0]?.aliasValue ?? null),
  };
  const input = { taskRunId: run.taskRunId, agentIds: [AGENT],
    toolName: "record_workroom_evidence",
    params: { capsuleId: CAPSULE, stageKey: "repair", kind: "passing-test", outcome: "completed", summary: "The repair passes its focused acceptance test" } };
  return { db, deps, input, room, run, task, checkpoint, roomTurn, agent };
}

export { NOW as SCHEDULED_DELIVERY_NOW };
