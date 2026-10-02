/** Read-side attribution only: creation source is not proof of invocation. */
export type InvocationAttribution = { executor: string; invocation: string };
type AttributionRoom = {
  title?: string;
  status?: string;
  source?: string;
  executorKind?: string | null;
  executorRef?: string | null;
  workspaceState?: unknown;
  activities?: Array<{ kind: string }>;
  taskRun?: {
    taskRunId: string;
    source?: string | null;
    initiatingAgentId?: string | null;
    currentAgentId?: string | null;
    parentTaskRunId?: string | null;
    a2aMetadata?: unknown;
  } | null;
};

export function recordedDriveTask(room: AttributionRoom): { taskId?: string; stageKey?: string; agentId?: string } | null {
  const state = room.workspaceState;
  if (!state || typeof state !== "object" || !("workroomDrive" in state)) return null;
  const drive = state.workroomDrive;
  if (!drive || typeof drive !== "object" || !("action" in drive) || drive.action !== "dispatch_agent") return null;
  return {
    taskId: "taskId" in drive && typeof drive.taskId === "string" ? drive.taskId : undefined,
    stageKey: "stageKey" in drive && typeof drive.stageKey === "string" ? drive.stageKey : undefined,
    agentId: "agentId" in drive && typeof drive.agentId === "string" ? drive.agentId : undefined,
  };
}

export function projectInvocationAttribution(room: AttributionRoom, scheduledTask?: { agentId: string } | null): InvocationAttribution {
  const executor = room.executorKind || "Executor not recorded";
  const run = room.taskRun;
  if (run) {
    const caller = run.initiatingAgentId;
    const callee = run.currentAgentId;
    const delegated = Boolean(caller && callee && caller !== callee);
    return {
      executor: room.executorKind || callee || caller || executor,
      invocation: [delegated ? `A2A: ${caller} → ${callee}` : `Task: ${callee || caller || "agent not recorded"}`,
        run.taskRunId, run.parentTaskRunId ? `parent ${run.parentTaskRunId}` : null,
        run.source ? `via ${run.source}` : null].filter(Boolean).join(" · "),
    };
  }
  const drive = recordedDriveTask(room);
  if (drive) return {
    executor: room.executorKind || drive.agentId || scheduledTask?.agentId || executor,
    invocation: ["Scheduled", drive.agentId || scheduledTask?.agentId || "agent not recorded", drive.taskId,
      drive.stageKey ? `stage ${drive.stageKey}` : null].filter(Boolean).join(" · "),
  };
  const native = room.activities?.find(({ kind }) => kind === "concierge-sweep" || kind === "embedding-coverage");
  if (native && (!room.executorKind || room.executorKind === "dpf-native")) return { executor: "dpf-native", invocation: `Native automation · ${native.kind}` };
  if (room.executorKind) return { executor, invocation: room.executorRef || "Invocation reference not recorded" };
  return { executor, invocation: room.status === "draft" ? "No invocation recorded" : "Invocation history not recorded" };
}
