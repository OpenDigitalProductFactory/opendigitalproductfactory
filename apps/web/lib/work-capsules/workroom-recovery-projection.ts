import type { InitiativeReviewerRecovery } from "@/lib/tak/initiative-readiness-tool-grants";
import { isLiveStatus, isTerminalTaskStatus, TASK_STATES } from "@/lib/tak/task-states";

type WorkroomIdentity = {
  repositoryFullName: string | null;
  headBranch: string | null;
  worktreePath: string | null;
  baseSha: string | null;
  headSha: string | null;
};

type LinkedTaskRun = { taskRunId: string; status: string } | null;

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

export function projectWorkroomRecovery(room: WorkroomIdentity & { taskRun?: LinkedTaskRun }) {
  const identityRepair = projectWorkroomIdentityRepair(room);
  // These are recorded states, not proof of a current heartbeat. In particular,
  // waiting for input or recovery must never look like queued execution.
  const executionState = !room.taskRun ? null
    : isTerminalTaskStatus(room.taskRun.status) ? "terminal"
      : room.taskRun.status === "submitted" ? "queued"
        : isLiveStatus(room.taskRun.status) ? "working"
          : (TASK_STATES as readonly string[]).includes(room.taskRun.status) ? "waiting" : "unknown";
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
        nextAction: "Re-sync the Workroom with adopt_worktree using the exact packet; resolve only the listed missing immutable identity fields.",
        repair: { toolName: identityRepair.toolName, packet: identityRepair.packet },
      }
      : null,
    reviewerExecution,
  };
}
