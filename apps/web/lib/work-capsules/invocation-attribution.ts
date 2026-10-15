/** Read-side attribution only: creation source is not proof of invocation. */
export type InvocationAttribution = { executor: string; invocation: string };
type AttributionRoom = {
  title?: string;
  status?: string;
  source?: string;
  executorKind?: string | null;
  executorRef?: string | null;
  workspaceState?: unknown;
  activities?: Array<{ kind: string; payload?: unknown }>;
  taskRun?: {
    taskRunId: string;
    source?: string | null;
    initiatingAgentId?: string | null;
    currentAgentId?: string | null;
    parentTaskRunId?: string | null;
    a2aMetadata?: unknown;
  } | null;
};

type RecordedDrive = { taskId?: string; stageKey?: string; agentId?: string; historical: boolean };

function readDispatch(value: unknown, historical: boolean): RecordedDrive | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const drive = value as Record<string, unknown>;
  if (drive.action !== "dispatch_agent" || (drive.reason !== undefined && drive.reason !== "agent_stage")) return null;
  if (historical && drive.reason !== "agent_stage") return null;
  const stageKey = typeof drive.stageKey === "string" ? drive.stageKey : undefined;
  let agentId = typeof drive.agentId === "string" ? drive.agentId : undefined;
  // Compatibility with the exact ledger emitted before structured agentId existed.
  // A scheduled task can be reassigned, so its current agent is not historical evidence.
  if (!agentId && stageKey && Array.isArray(drive.ledger)) {
    const suffix = ` for stage ${stageKey}.`;
    const entry = drive.ledger.find((line): line is string => typeof line === "string" && line.startsWith("Dispatch agent:") && line.endsWith(suffix));
    if (entry) agentId = entry.slice("Dispatch agent:".length, -suffix.length) || undefined;
  }
  return { taskId: typeof drive.taskId === "string" ? drive.taskId : undefined, stageKey, agentId, historical };
}

export function recordedDriveTask(room: AttributionRoom): RecordedDrive | null {
  const state = room.workspaceState;
  const current = state && typeof state === "object" && "workroomDrive" in state
    ? readDispatch(state.workroomDrive, false) : null;
  if (current) return current;
  for (const activity of room.activities ?? []) {
    if (activity.kind !== "workroom-drive") continue;
    const dispatch = readDispatch(activity.payload, true);
    if (dispatch) return dispatch;
  }
  return null;
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
  if (drive?.historical && room.executorKind && room.executorKind !== "dpf-native") return { executor, invocation: room.executorRef || "Invocation reference not recorded" };
  const scheduledAgent = drive?.agentId || (!drive?.historical ? scheduledTask?.agentId : undefined);
  if (drive) return {
    executor: room.executorKind || scheduledAgent || executor,
    invocation: ["Scheduled", scheduledAgent || "agent not recorded", drive.taskId,
      drive.stageKey ? `stage ${drive.stageKey}` : null].filter(Boolean).join(" · "),
  };
  const native = room.activities?.find(({ kind }) => kind === "concierge-sweep" || kind === "embedding-coverage");
  if (native && (!room.executorKind || room.executorKind === "dpf-native")) return { executor: "dpf-native", invocation: `Native automation · ${native.kind}` };
  if (room.executorKind) return { executor, invocation: room.executorRef || "Invocation reference not recorded" };
  return { executor, invocation: room.status === "draft" ? "No invocation recorded" : "Invocation history not recorded" };
}
