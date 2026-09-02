// apps/web/lib/mcp/tasks-lifecycle.ts
//
// Standard MCP Tasks lifecycle — Phase 0 read-only surface (BI-06B66FFD,
// Slice 4). Projects the standard `2025-11-25` Tasks methods (tasks/get,
// tasks/result, tasks/list, tasks/cancel) onto the EXISTING durable `TaskRun`
// substrate. Scope is deliberately bounded to the design's Phase 0:
//   - NO task-augmented tools/call (execution semantics unchanged) — Phase 1.
//   - NO tasks/submit convergence (the bespoke method is untouched) — Phase 2.
// So the three kernel-routed questions (TTL deletion, cancel of a running
// side-effecting loop, tasks/submit deprecation) do not arise here: rows are
// never deleted, cancel is auth-bound and cooperative (sets the A2A `canceled`
// state the executor already honours via heartbeat/stall), and tasks/submit is
// left exactly as-is. Advertising the capability + these reads is additive.
//
// Auth-context binding is a spec MUST: get/result/cancel verify the row's
// userId == the caller, and list filters on userId (index @@index([userId,status])).

import { prisma } from "@dpf/db";
import { MCP_ROUTE_TOOL_RESULT_CHAR_CAP } from "@/lib/tak/tool-result-budget";
import { withTaskRunApprovalLocation } from "./external-approval-location-lookup";

/** Phase-0 surface is on by default (read-only + auth-bound); MCP_TASKS_LIFECYCLE=off disables it. */
export function tasksLifecycleEnabled(): boolean {
  return process.env.MCP_TASKS_LIFECYCLE !== "off";
}

/**
 * Protocol revisions that define the standard Tasks capability
 * (`capabilities.tasks` + tasks/get|result|list|cancel).
 *
 * Tasks arrived with MCP 2025-11-25. Advertising them on older negotiated
 * versions (2024-11-05 / 2025-03-26 / 2025-06-18) breaks clients whose
 * InitializeResult deserializers reject unknown capability keys — observed on
 * Grok Build 1.0.0 as
 * `expect initialized result, but received: Some(CustomResult(...))`.
 * Advertise only when the negotiated version is Tasks-aware so pre-Tasks
 * clients (Grok, older Claude/Codex SDKs, etc.) can still complete handshake.
 */
export const MCP_TASKS_PROTOCOL_VERSIONS = Object.freeze(["2025-11-25"] as const);

/**
 * Whether initialize may include `capabilities.tasks` for this negotiated
 * protocol version. Feature-flag off OR a pre-Tasks protocol → false.
 * Pure (aside from the env flag) so route tests and client-compat suites share it.
 */
export function shouldAdvertiseTasksCapability(negotiatedProtocolVersion: string): boolean {
  if (!tasksLifecycleEnabled()) return false;
  return (MCP_TASKS_PROTOCOL_VERSIONS as readonly string[]).includes(negotiatedProtocolVersion);
}

// A2A/DPF ↔ MCP-spec state spelling. Internal enum (ops-map, watchdog) is
// untouched; we only adapt at the wire boundary (design §3).
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

/** Map a DPF/A2A TaskRun.status to the MCP-spec wire state. Pure. */
export function mcpTaskStateForWire(dpfStatus: string): string {
  return DPF_TO_MCP_STATE[dpfStatus] ?? "working";
}

/** True when a DPF task status is terminal (no further transitions). Pure. */
export function isTerminalTaskStatus(dpfStatus: string): boolean {
  return TERMINAL_DPF_STATES.has(dpfStatus);
}

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const MAX_LIST_PAGE = 50;

export type TaskLifecycleResult =
  | { kind: "ok"; value: unknown }
  | { kind: "invalid"; message: string }
  | { kind: "forbidden"; message: string }
  | { kind: "notfound"; message: string };

export type McpTaskRunRow = {
  taskRunId: string;
  userId: string;
  title: string;
  objective: string;
  status: string;
  progressPayload: unknown;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

/** The standard Task object projected from a TaskRun row. */
export function toMcpTaskObject(row: McpTaskRunRow) {
  return {
    taskId: row.taskRunId,
    status: mcpTaskStateForWire(row.status),
    createdAt: row.createdAt.toISOString(),
    lastUpdatedAt: row.updatedAt.toISOString(),
    ttl: null as number | null, // governed TaskRuns are durable audit records (design D1: retain, never delete)
    pollInterval: DEFAULT_POLL_INTERVAL_MS,
  };
}

export const MCP_TASK_SELECT = {
  taskRunId: true,
  userId: true,
  title: true,
  objective: true,
  status: true,
  progressPayload: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
} as const;

function requireTaskId(params: Record<string, unknown> | undefined): string | null {
  const id = params?.["taskId"];
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** tasks/get — return the Task status object; auth-context bound. */
export async function handleTasksGet(
  userId: string,
  params: Record<string, unknown> | undefined,
): Promise<TaskLifecycleResult> {
  const taskId = requireTaskId(params);
  if (!taskId) return { kind: "invalid", message: "tasks/get requires params.taskId (string)" };
  const row = await prisma.taskRun.findUnique({ where: { taskRunId: taskId }, select: MCP_TASK_SELECT });
  if (!row) return { kind: "notfound", message: `task not found: ${taskId}` };
  if (row.userId !== userId) return { kind: "forbidden", message: "task belongs to a different auth context" };
  const task = toMcpTaskObject(row);
  if (row.status !== "input-required" && row.status !== "auth-required") {
    return { kind: "ok", value: task };
  }
  return {
    kind: "ok",
    value: await withTaskRunApprovalLocation(
      { ...task, requiresApproval: true },
      { taskRunId: row.taskRunId, callerUserId: userId },
    ),
  };
}

/** tasks/result — for terminal tasks return a CallToolResult-shaped payload; for
 * non-terminal, return the current status (non-blocking Phase-0 simplification —
 * the spec's block-to-terminal is Phase 1, when execution is task-augmented). */
export async function handleTasksResult(
  userId: string,
  params: Record<string, unknown> | undefined,
): Promise<TaskLifecycleResult> {
  const taskId = requireTaskId(params);
  if (!taskId) return { kind: "invalid", message: "tasks/result requires params.taskId (string)" };
  const row = await prisma.taskRun.findUnique({ where: { taskRunId: taskId }, select: MCP_TASK_SELECT });
  if (!row) return { kind: "notfound", message: `task not found: ${taskId}` };
  if (row.userId !== userId) return { kind: "forbidden", message: "task belongs to a different auth context" };

  const meta = { "io.modelcontextprotocol/related-task": { taskId } };
  if (!isTerminalTaskStatus(row.status)) {
    const structuredContent: Record<string, unknown> = {
      taskId,
      status: mcpTaskStateForWire(row.status),
      terminal: false,
    };
    const located = row.status === "input-required" || row.status === "auth-required"
      ? await withTaskRunApprovalLocation(
          { ...structuredContent, requiresApproval: true },
          { taskRunId: row.taskRunId, callerUserId: userId },
        )
      : structuredContent;
    return {
      kind: "ok",
      value: {
        content: [
          {
            type: "text",
            text: `Task ${taskId} is not yet terminal (status: ${mcpTaskStateForWire(row.status)}). Poll tasks/get until it completes.`,
          },
        ],
        structuredContent: located,
        isError: false,
        _meta: meta,
      },
    };
  }

  const isError = row.status === "failed" || row.status === "rejected";
  let structured: Record<string, unknown> = {
    taskId,
    status: mcpTaskStateForWire(row.status),
    terminal: true,
    title: row.title,
    objective: row.objective,
    progressPayload: row.progressPayload ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
  // Bound the model-facing payload (context-engineering-standards.md G1/P6):
  // progressPayload is arbitrary JSON. Drop it to a marker before overflow.
  if (JSON.stringify(structured).length > MCP_ROUTE_TOOL_RESULT_CHAR_CAP) {
    structured = {
      ...structured,
      progressPayload: { _truncated: true, _note: "progressPayload exceeded the MCP route result cap." },
    };
  }
  return {
    kind: "ok",
    value: {
      content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
      structuredContent: structured,
      isError,
      _meta: meta,
    },
  };
}

/** tasks/list — the caller's own tasks, newest first, cursor-paginated (spec MUST: scoped to requestor). */
export async function handleTasksList(
  userId: string,
  params: Record<string, unknown> | undefined,
): Promise<TaskLifecycleResult> {
  const cursor = typeof params?.["cursor"] === "string" ? (params["cursor"] as string) : undefined;
  const rows = await prisma.taskRun.findMany({
    where: { userId },
    select: MCP_TASK_SELECT,
    orderBy: { createdAt: "desc" },
    take: MAX_LIST_PAGE + 1,
    ...(cursor ? { cursor: { taskRunId: cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, MAX_LIST_PAGE);
  const nextCursor = rows.length > MAX_LIST_PAGE ? page[page.length - 1]?.taskRunId : undefined;
  return {
    kind: "ok",
    value: {
      tasks: page.map(toMcpTaskObject),
      ...(nextCursor ? { nextCursor } : {}),
    },
  };
}

/** tasks/cancel — auth-bound cooperative cancel of a non-terminal task. Sets the
 * A2A `canceled` state the executor already honours; never force-kills. */
export async function handleTasksCancel(
  userId: string,
  params: Record<string, unknown> | undefined,
): Promise<TaskLifecycleResult> {
  const taskId = requireTaskId(params);
  if (!taskId) return { kind: "invalid", message: "tasks/cancel requires params.taskId (string)" };
  const row = await prisma.taskRun.findUnique({ where: { taskRunId: taskId }, select: MCP_TASK_SELECT });
  if (!row) return { kind: "notfound", message: `task not found: ${taskId}` };
  if (row.userId !== userId) return { kind: "forbidden", message: "task belongs to a different auth context" };
  if (isTerminalTaskStatus(row.status)) {
    // Idempotent: already terminal, report current state.
    return { kind: "ok", value: toMcpTaskObject(row) };
  }
  const updated = await prisma.taskRun.update({
    where: { taskRunId: taskId },
    data: { status: "canceled", completedAt: new Date() },
    select: MCP_TASK_SELECT,
  });
  return { kind: "ok", value: toMcpTaskObject(updated) };
}
