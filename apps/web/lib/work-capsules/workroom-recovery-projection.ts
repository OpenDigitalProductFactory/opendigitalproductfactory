import type { InitiativeReviewerRecovery } from "@/lib/tak/initiative-readiness-tool-grants";
import { isTerminalTaskStatus } from "@/lib/mcp/tasks-lifecycle";

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
  const reviewerExecution = room.taskRun
    ? {
      taskRunId: room.taskRun.taskRunId,
      status: room.taskRun.status,
      pending: !isTerminalTaskStatus(room.taskRun.status),
    }
    : null;
  return {
    state: identityRepair
      ? "blocked" as const
      : reviewerExecution?.pending
        ? "queued" as const
        : reviewerExecution
          ? "terminal" as const
          : "actionable" as const,
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
