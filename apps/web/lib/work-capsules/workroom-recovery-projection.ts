import type { InitiativeReviewerRecovery } from "@/lib/tak/initiative-readiness-tool-grants";
import { projectRecordedTaskState } from "@/lib/tak/task-states";

type WorkroomIdentity = {
  repositoryFullName: string | null;
  headBranch: string | null;
  worktreePath: string | null;
  baseSha: string | null;
  headSha: string | null;
};

type LinkedTaskRun = { taskRunId: string; status: string } | null;

/** Room fields adopt_worktree requires besides the identity itself. */
type WorkroomRepairContext = {
  title?: string | null;
  objective?: string | null;
  backlogItemId?: string | null;
  baseBranch?: string | null;
};

/**
 * adopt_worktree refuses a call without title and objective, so a repair packet
 * that leaves them out cannot be replayed as given (observed 2026-09-23). Carry
 * every field the room already knows.
 */
function repairContextFields(room: WorkroomRepairContext): Record<string, unknown> {
  return {
    ...(room.title ? { title: room.title } : {}),
    ...(room.objective ? { objective: room.objective } : {}),
    ...(room.backlogItemId ? { backlogItemId: room.backlogItemId } : {}),
    ...(room.baseBranch ? { baseBranch: room.baseBranch } : {}),
  };
}

export function projectWorkroomIdentityRepair(
  room: WorkroomIdentity,
  packetFields: Record<string, unknown> = {},
): NonNullable<InitiativeReviewerRecovery["identityRepair"]> | null {
  const missingFields = [
    ...(!room.baseSha ? ["baseSha" as const] : []),
    ...(!room.headSha ? ["headSha" as const] : []),
  ];
  if (missingFields.length === 0) return null;
  const retainedFields = {
    repositoryFullName: room.repositoryFullName ?? "",
    headBranch: room.headBranch ?? "",
    worktreePath: room.worktreePath ?? "",
    ...(room.baseSha ? { baseSha: room.baseSha } : {}),
    ...(room.headSha ? { headSha: room.headSha } : {}),
  };
  return {
    toolName: "adopt_worktree",
    missingFields,
    retainedFields,
    packet: {
      ...packetFields,
      repositoryFullName: retainedFields.repositoryFullName,
      headBranch: retainedFields.headBranch,
      worktreePath: retainedFields.worktreePath,
      ...(room.baseSha ? { baseSha: room.baseSha } : {}),
      ...(room.headSha ? { headSha: room.headSha } : {}),
    },
  };
}

export function projectWorkroomRecovery(
  room: WorkroomIdentity & WorkroomRepairContext & { taskRun?: LinkedTaskRun },
) {
  const identityRepair = projectWorkroomIdentityRepair(room, repairContextFields(room));
  // These are recorded states, not proof of a current heartbeat. In particular,
  // waiting for input or recovery must never look like queued execution.
  const executionState = room.taskRun ? projectRecordedTaskState(room.taskRun.status) : null;
  const reviewerExecution = room.taskRun
    ? {
      taskRunId: room.taskRun.taskRunId,
      status: room.taskRun.status,
      pending: executionState === "unknown" ? null : executionState !== "terminal",
    }
    : null;
  return {
    state: identityRepair
      ? "blocked" as const
      : executionState ?? "actionable" as const,
    prerequisite: identityRepair
      ? {
        accountableRole: "artifact-resolver" as const,
        missingFields: identityRepair.missingFields,
        retainedFields: identityRepair.retainedFields,
        nextAction:
          `Call adopt_worktree with this packet, adding the full 40-character commit SHA for ${identityRepair.missingFields.join(" and ")}. `
          + "Without them no reviewer can be routed to this room's source.",
        repair: { toolName: identityRepair.toolName, packet: identityRepair.packet },
      }
      : null,
    reviewerExecution,
  };
}
