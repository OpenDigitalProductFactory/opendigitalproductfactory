import { prisma, type Prisma } from "@dpf/db";
import { createTaskMessage } from "@/lib/tak/task-records";
import { MCP_ROUTE_TOOL_RESULT_CHAR_CAP } from "@/lib/tak/tool-result-budget";

export const MCP_TASKS_EXTENSION = "io.modelcontextprotocol/tasks" as const;
export const MCP_MISSING_REQUIRED_CLIENT_CAPABILITY = -32003;

export type McpTaskAuthContext = {
  userId: string;
  tokenId: string;
  agentId?: string | null;
};

export type TaskLifecycleResult =
  | { kind: "ok"; value: Record<string, unknown> }
  | { kind: "invalid"; message: string }
  | { kind: "forbidden"; message: string }
  | { kind: "notfound"; message: string };

type TaskRunRow = {
  id: string;
  taskRunId: string;
  userId: string;
  contextId: string | null;
  initiatingAgentId: string | null;
  currentAgentId: string | null;
  mcpOwnerTokenId: string | null;
  title: string;
  objective: string;
  status: string;
  a2aMetadata: unknown;
  progressPayload: unknown;
  cancellationRequestedAt: Date | null;
  cancellationRequestedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

const TASK_SELECT = {
  id: true,
  taskRunId: true,
  userId: true,
  contextId: true,
  initiatingAgentId: true,
  currentAgentId: true,
  mcpOwnerTokenId: true,
  title: true,
  objective: true,
  status: true,
  a2aMetadata: true,
  progressPayload: true,
  cancellationRequestedAt: true,
  cancellationRequestedByUserId: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
} as const;

const DPF_TO_MCP_STATE: Record<string, string> = {
  submitted: "working",
  working: "working",
  "input-required": "input_required",
  "auth-required": "input_required",
  completed: "completed",
  failed: "failed",
  canceled: "cancelled",
  rejected: "failed",
  archived: "completed",
};

const TERMINAL_DPF_STATES = new Set(["completed", "failed", "canceled", "rejected", "archived"]);
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const MAX_LIST_PAGE = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson(value: unknown): Record<string, unknown> {
  return isRecord(value) ? JSON.parse(JSON.stringify(value)) as Record<string, unknown> : {};
}

function toInputJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function tasksLifecycleEnabled(): boolean {
  return process.env.MCP_TASKS_LIFECYCLE !== "off";
}

export function tasksExtensionNegotiated(capabilities: Record<string, unknown>): boolean {
  const extensions = capabilities["extensions"];
  return isRecord(extensions) && isRecord(extensions[MCP_TASKS_EXTENSION]);
}

export function mcpTaskStateForWire(dpfStatus: string): string {
  return DPF_TO_MCP_STATE[dpfStatus] ?? "working";
}

export function isTerminalTaskStatus(dpfStatus: string): boolean {
  return TERMINAL_DPF_STATES.has(dpfStatus);
}

function requireTaskId(params: Record<string, unknown> | undefined, method: string): string | null {
  const value = params?.["taskId"];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function authorizeTask(row: TaskRunRow, auth: McpTaskAuthContext): TaskLifecycleResult | null {
  if (row.userId !== auth.userId) {
    return { kind: "forbidden", message: "task belongs to a different auth context" };
  }
  if (row.mcpOwnerTokenId && row.mcpOwnerTokenId !== auth.tokenId) {
    return { kind: "forbidden", message: "task belongs to a different MCP caller binding" };
  }
  return null;
}

function taskBase(row: TaskRunRow) {
  const progress = cloneJson(row.progressPayload);
  return {
    taskId: row.taskRunId,
    status: mcpTaskStateForWire(row.status),
    ...(typeof progress["summary"] === "string" ? { statusMessage: progress["summary"] } : {}),
    createdAt: row.createdAt.toISOString(),
    lastUpdatedAt: row.updatedAt.toISOString(),
    ttlMs: null as number | null,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  };
}

function terminalResult(row: TaskRunRow): Record<string, unknown> {
  const progress = cloneJson(row.progressPayload);
  const summary = typeof progress["summary"] === "string"
    ? progress["summary"]
    : `${row.title} ${mcpTaskStateForWire(row.status)}.`;
  if (row.status === "failed" || row.status === "rejected") {
    return { error: { code: -32603, message: summary } };
  }
  if (row.status === "canceled") return {};
  return {
    result: {
      content: [{ type: "text", text: summary }],
      structuredContent: {
        taskId: row.taskRunId,
        status: mcpTaskStateForWire(row.status),
        completedAt: row.completedAt?.toISOString() ?? null,
      },
      isError: false,
    },
  };
}

function toDetailedTask(row: TaskRunRow): Record<string, unknown> {
  const progress = cloneJson(row.progressPayload);
  const inputRequests = isRecord(progress["inputRequests"])
    ? progress["inputRequests"] as Record<string, unknown>
    : null;
  return {
    resultType: "complete",
    ...taskBase(row),
    ...(row.status === "input-required" || row.status === "auth-required") && inputRequests
      ? { inputRequests }
      : {},
    ...(isTerminalTaskStatus(row.status) ? terminalResult(row) : {}),
  };
}

function toCreateTaskResult(row: TaskRunRow): Record<string, unknown> {
  return { resultType: "task", ...taskBase(row) };
}

async function findAuthorizedTask(
  auth: McpTaskAuthContext,
  taskId: string,
): Promise<{ row: TaskRunRow } | { error: TaskLifecycleResult }> {
  const row = await prisma.taskRun.findUnique({ where: { taskRunId: taskId }, select: TASK_SELECT });
  if (!row) return { error: { kind: "notfound", message: `task not found: ${taskId}` } };
  const denied = authorizeTask(row as TaskRunRow, auth);
  return denied ? { error: denied } : { row: row as TaskRunRow };
}

/** Bind an already-created canonical TaskRun to the current MCP caller before
 * returning its CreateTaskResult. This is the durable-before-handle gate. */
export async function bindMcpTaskOwner(
  auth: McpTaskAuthContext,
  taskId: string,
): Promise<TaskLifecycleResult> {
  const found = await findAuthorizedTask(auth, taskId);
  if ("error" in found) return found.error;
  let row = found.row;
  if (!row.mcpOwnerTokenId) {
    row = await prisma.taskRun.update({
      where: { taskRunId: taskId },
      data: { mcpOwnerTokenId: auth.tokenId },
      select: TASK_SELECT,
    }) as TaskRunRow;
  }
  return { kind: "ok", value: toCreateTaskResult(row) };
}

export async function handleTasksGet(
  auth: McpTaskAuthContext,
  params: Record<string, unknown> | undefined,
): Promise<TaskLifecycleResult> {
  const taskId = requireTaskId(params, "tasks/get");
  if (!taskId) return { kind: "invalid", message: "tasks/get requires params.taskId (string)" };
  const found = await findAuthorizedTask(auth, taskId);
  return "error" in found ? found.error : { kind: "ok", value: toDetailedTask(found.row) };
}

export async function handleTasksUpdate(
  auth: McpTaskAuthContext,
  params: Record<string, unknown> | undefined,
): Promise<TaskLifecycleResult> {
  const taskId = requireTaskId(params, "tasks/update");
  const supplied = params?.["inputResponses"];
  if (!taskId || !isRecord(supplied)) {
    return { kind: "invalid", message: "tasks/update requires params.taskId and params.inputResponses" };
  }
  const found = await findAuthorizedTask(auth, taskId);
  if ("error" in found) return found.error;
  const row = found.row;
  if (isTerminalTaskStatus(row.status)) return { kind: "ok", value: {} };

  const progress = cloneJson(row.progressPayload);
  const outstanding = isRecord(progress["inputRequests"])
    ? { ...progress["inputRequests"] as Record<string, unknown> }
    : {};
  const priorResponses = isRecord(progress["inputResponses"])
    ? { ...progress["inputResponses"] as Record<string, unknown> }
    : {};
  const accepted: Record<string, unknown> = {};

  for (const [key, response] of Object.entries(supplied)) {
    const request = outstanding[key];
    if (!isRecord(request)) continue;
    const requestMeta = isRecord(request["_meta"]) ? request["_meta"] : {};
    const envelopeId = requestMeta["approvalEnvelopeId"];
    if (typeof envelopeId === "string") {
      const envelope = await prisma.coworkerActionEnvelope.findUnique({
        where: { id: envelopeId },
        select: { status: true },
      });
      // An MCP input payload is never authority. Only the canonical employee
      // approval envelope may satisfy an approval-bound input request.
      if (envelope?.status !== "approved") continue;
    }
    accepted[key] = response;
    priorResponses[key] = response;
    delete outstanding[key];
  }

  if (Object.keys(accepted).length === 0) return { kind: "ok", value: {} };

  await createTaskMessage({
    taskRunId: row.taskRunId,
    taskRunRecordId: row.id,
    contextId: row.contextId,
    role: "user",
    messageType: "mcp-task-input",
    content: JSON.stringify(accepted),
    metadata: {
      source: "mcp.tasks/update",
      actorUserId: auth.userId,
      actorTokenId: auth.tokenId,
      inputKeys: Object.keys(accepted),
    },
  });

  const remaining = Object.keys(outstanding).length;
  await prisma.taskRun.update({
    where: { taskRunId: row.taskRunId },
    data: {
      status: remaining === 0 ? "working" : "input-required",
      ...(remaining === 0 ? { lastHeartbeatAt: new Date() } : {}),
      progressPayload: toInputJson({
        ...progress,
        inputRequests: outstanding,
        inputResponses: priorResponses,
      }),
    },
    select: TASK_SELECT,
  });

  if (remaining === 0 && isRecord(row.a2aMetadata)) {
    const trigger = row.a2aMetadata["trigger"];
    if (trigger === "external-mcp") {
      const { enqueueRemoteTaskExecution } = await import("@/lib/mcp/remote-task-executor");
      await enqueueRemoteTaskExecution(row.taskRunId);
    }
  }
  return { kind: "ok", value: {} };
}

export async function handleTasksCancel(
  auth: McpTaskAuthContext,
  params: Record<string, unknown> | undefined,
): Promise<TaskLifecycleResult> {
  const taskId = requireTaskId(params, "tasks/cancel");
  if (!taskId) return { kind: "invalid", message: "tasks/cancel requires params.taskId (string)" };
  const found = await findAuthorizedTask(auth, taskId);
  if ("error" in found) return found.error;
  if (isTerminalTaskStatus(found.row.status) || found.row.cancellationRequestedAt) {
    return { kind: "ok", value: {} };
  }
  await prisma.taskRun.update({
    where: { taskRunId: taskId },
    data: {
      cancellationRequestedAt: new Date(),
      cancellationRequestedByUserId: auth.userId,
    },
    select: TASK_SELECT,
  });
  return { kind: "ok", value: {} };
}

// Legacy 2025 compatibility adapters. They use the same authorization/read
// service but preserve the retired wire methods until M4's runtime gate closes.
export async function handleTasksResult(
  userId: string,
  params: Record<string, unknown> | undefined,
  tokenId = `legacy:${userId}`,
): Promise<TaskLifecycleResult> {
  const taskId = requireTaskId(params, "tasks/result");
  if (!taskId) return { kind: "invalid", message: "tasks/result requires params.taskId (string)" };
  const row = await prisma.taskRun.findUnique({ where: { taskRunId: taskId }, select: TASK_SELECT });
  if (!row) return { kind: "notfound", message: `task not found: ${taskId}` };
  if (row.userId !== userId || (row.mcpOwnerTokenId && row.mcpOwnerTokenId !== tokenId)) {
    return { kind: "forbidden", message: "task belongs to a different auth context" };
  }
  const detailed = toDetailedTask(row as TaskRunRow);
  if (!isTerminalTaskStatus(row.status)) {
    return {
      kind: "ok",
      value: {
        content: [{ type: "text", text: `Task ${taskId} is not yet terminal.` }],
        structuredContent: { taskId, status: mcpTaskStateForWire(row.status), terminal: false },
        isError: false,
      },
    };
  }
  const serialized = JSON.stringify(detailed);
  const bounded = serialized.length > MCP_ROUTE_TOOL_RESULT_CHAR_CAP
    ? JSON.stringify({ taskId, status: detailed["status"], _truncated: true })
    : serialized;
  return {
    kind: "ok",
    value: {
      content: [{ type: "text", text: bounded }],
      structuredContent: detailed,
      isError: row.status === "failed" || row.status === "rejected",
    },
  };
}

export async function handleTasksList(
  userId: string,
  params: Record<string, unknown> | undefined,
): Promise<TaskLifecycleResult> {
  const cursor = typeof params?.["cursor"] === "string" ? params["cursor"] as string : undefined;
  const rows = await prisma.taskRun.findMany({
    where: { userId },
    select: TASK_SELECT,
    orderBy: { createdAt: "desc" },
    take: MAX_LIST_PAGE + 1,
    ...(cursor ? { cursor: { taskRunId: cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, MAX_LIST_PAGE) as TaskRunRow[];
  const nextCursor = rows.length > MAX_LIST_PAGE ? page.at(-1)?.taskRunId : undefined;
  return {
    kind: "ok",
    value: {
      tasks: page.map((row) => ({
        taskId: row.taskRunId,
        status: mcpTaskStateForWire(row.status),
        createdAt: row.createdAt.toISOString(),
        lastUpdatedAt: row.updatedAt.toISOString(),
        ttl: null,
        pollInterval: DEFAULT_POLL_INTERVAL_MS,
      })),
      ...(nextCursor ? { nextCursor } : {}),
    },
  };
}
