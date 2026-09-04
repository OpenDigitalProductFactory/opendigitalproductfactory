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

import { createHash } from "node:crypto";

import { prisma } from "@dpf/db";
import {
  readPrismaAuthorizedAsyncOperation,
  requestPrismaAuthorizedAsyncOperationCancellation,
} from "@/lib/inference/async-operation-runtime";
import type { AuthorizedAsyncOperationResult } from "@/lib/inference/async-operation-read-model";
import { MCP_ROUTE_TOOL_RESULT_CHAR_CAP } from "@/lib/tak/tool-result-budget";
import { withTaskRunApprovalLocation } from "./external-approval-location-lookup";
import {
  DURABLE_INFERENCE_TASK_CONTRACT_FAMILY,
  parseDurableInferenceTaskMetadata,
} from "../mcp-task-durable-inference-contract";

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
const DURABLE_RESULT_TEXT_JSON_BUDGET = Math.floor(MCP_ROUTE_TOOL_RESULT_CHAR_CAP / 3);

function boundedDurableResultText(value: string | null): {
  text: string | null;
  truncated: boolean;
  sha256: string | null;
  originalChars: number;
} {
  if (value === null) {
    return { text: null, truncated: false, sha256: null, originalChars: 0 };
  }
  const sha256 = createHash("sha256").update(value, "utf8").digest("hex");
  if (JSON.stringify(value).length <= DURABLE_RESULT_TEXT_JSON_BUDGET) {
    return { text: value, truncated: false, sha256, originalChars: value.length };
  }
  let low = 0;
  let high = value.length;
  while (low < high) {
    const candidate = Math.ceil((low + high) / 2);
    if (JSON.stringify(value.slice(0, candidate)).length <= DURABLE_RESULT_TEXT_JSON_BUDGET) {
      low = candidate;
    } else {
      high = candidate - 1;
    }
  }
  return {
    text: value.slice(0, low),
    truncated: true,
    sha256,
    originalChars: value.length,
  };
}

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

const MCP_TASK_DURABLE_SELECT = {
  ...MCP_TASK_SELECT,
  a2aMetadata: true,
} as const;

type DurableTaskRow = McpTaskRunRow & { a2aMetadata: unknown };

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function durableTaskIdentity(row: DurableTaskRow): {
  requestKey: string;
  projectedOperationId: string | null;
} | null {
  const metadata = object(row.a2aMetadata);
  const raw = metadata?.["durableInference"];
  if (raw === undefined) return null;
  if (!parseDurableInferenceTaskMetadata(raw)) {
    throw new Error("DURABLE_INFERENCE_TASK_METADATA_INVALID");
  }
  const requestKey = typeof metadata?.["idempotencyKey"] === "string"
    ? metadata["idempotencyKey"].trim()
    : "";
  if (!requestKey) throw new Error("DURABLE_INFERENCE_REQUEST_KEY_MISSING");
  const durableProgress = object(object(row.progressPayload)?.["durableInference"]);
  const projectedOperationId = typeof durableProgress?.["asyncOperationId"] === "string"
    ? durableProgress["asyncOperationId"].trim() || null
    : null;
  return { requestKey, projectedOperationId };
}

async function readDurableTaskOperation(
  row: DurableTaskRow,
  userId: string,
  identity: NonNullable<ReturnType<typeof durableTaskIdentity>>,
): Promise<AuthorizedAsyncOperationResult> {
  const result = await readPrismaAuthorizedAsyncOperation({
    target: { kind: "task-run", taskRunId: row.taskRunId },
    actor: { userId, agentId: null, principalId: null, isSuperuser: false },
    requestKey: identity.requestKey,
  });
  const operation = result.operation;
  if (
    operation.contractFamily !== DURABLE_INFERENCE_TASK_CONTRACT_FAMILY
    || operation.requestKey !== identity.requestKey
    || (identity.projectedOperationId && identity.projectedOperationId !== operation.operationId)
  ) {
    throw new Error("DURABLE_INFERENCE_OPERATION_ID_MISMATCH");
  }
  return operation;
}

function durableOperationTaskStatus(status: AuthorizedAsyncOperationResult["status"]): string {
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  if (status === "failed" || status === "expired") return "failed";
  return "working";
}

function durableOperationProjection(operation: AuthorizedAsyncOperationResult) {
  return {
    asyncOperationId: operation.operationId,
    status: operation.status,
    progressPct: operation.progressPct,
    progressMessage: operation.progressMessage,
    checkpointSequence: operation.checkpointSequence,
    transitionSequence: operation.transitionSequence,
    expiresAt: operation.expiresAt.toISOString(),
  };
}

function durableTaskObject(row: DurableTaskRow, operation: AuthorizedAsyncOperationResult) {
  return {
    ...toMcpTaskObject(row),
    status: durableOperationTaskStatus(operation.status),
    lastUpdatedAt: operation.updatedAt.toISOString(),
    asyncOperation: durableOperationProjection(operation),
  };
}

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
  const row = await prisma.taskRun.findUnique({ where: { taskRunId: taskId }, select: MCP_TASK_DURABLE_SELECT });
  if (!row) return { kind: "notfound", message: `task not found: ${taskId}` };
  if (row.userId !== userId) return { kind: "forbidden", message: "task belongs to a different auth context" };
  const durableIdentity = durableTaskIdentity(row);
  if (durableIdentity?.projectedOperationId) {
    const operation = await readDurableTaskOperation(row, userId, durableIdentity);
    return { kind: "ok", value: durableTaskObject(row, operation) };
  }
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
  const row = await prisma.taskRun.findUnique({ where: { taskRunId: taskId }, select: MCP_TASK_DURABLE_SELECT });
  if (!row) return { kind: "notfound", message: `task not found: ${taskId}` };
  if (row.userId !== userId) return { kind: "forbidden", message: "task belongs to a different auth context" };

  const meta = { "io.modelcontextprotocol/related-task": { taskId } };
  const durableIdentity = durableTaskIdentity(row);
  if (durableIdentity?.projectedOperationId) {
    const operation = await readDurableTaskOperation(row, userId, durableIdentity);
    const status = durableOperationTaskStatus(operation.status);
    const terminal = status !== "working";
    const boundedResult = boundedDurableResultText(operation.resultText);
    const boundedError = boundedDurableResultText(operation.errorMessage);
    let structured: Record<string, unknown> = {
      taskId,
      status,
      terminal,
      resultText: boundedResult.text,
      resultTruncated: boundedResult.truncated,
      resultSha256: boundedResult.sha256,
      resultOriginalChars: boundedResult.originalChars,
      errorMessage: boundedError.text,
      errorTruncated: boundedError.truncated,
      errorSha256: boundedError.sha256,
      errorOriginalChars: boundedError.originalChars,
      completedAt: operation.completedAt?.toISOString() ?? null,
      provenance: {
        asyncOperationId: operation.operationId,
        requestDigest: operation.requestDigest,
        providerId: operation.providerId,
        modelId: operation.modelId,
        providerOperationId: operation.providerOperationId,
        contractFamily: operation.contractFamily,
        checkpointSequence: operation.checkpointSequence,
        transitionSequence: operation.transitionSequence,
      },
    };
    const resultText = boundedResult.text
      ?? boundedError.text
      ?? (terminal
        ? `Durable inference task ${taskId} ended with status ${status}.`
        : `Task ${taskId} is not yet terminal (status: ${status}). Poll tasks/get until it completes.`);
    return {
      kind: "ok",
      value: {
        content: [{ type: "text", text: resultText.slice(0, MCP_ROUTE_TOOL_RESULT_CHAR_CAP) }],
        structuredContent: structured,
        isError: operation.status === "failed" || operation.status === "expired",
        _meta: meta,
      },
    };
  }
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
  const row = await prisma.taskRun.findUnique({ where: { taskRunId: taskId }, select: MCP_TASK_DURABLE_SELECT });
  if (!row) return { kind: "notfound", message: `task not found: ${taskId}` };
  if (row.userId !== userId) return { kind: "forbidden", message: "task belongs to a different auth context" };
  const durableIdentity = durableTaskIdentity(row);
  if (durableIdentity?.projectedOperationId) {
    const operation = await requestPrismaAuthorizedAsyncOperationCancellation({
      target: { kind: "task-run", taskRunId: row.taskRunId },
      actor: { userId, agentId: null, principalId: null, isSuperuser: false },
      requestKey: durableIdentity.requestKey,
    });
    if (
      operation.contractFamily !== DURABLE_INFERENCE_TASK_CONTRACT_FAMILY
      || operation.requestKey !== durableIdentity.requestKey
      || (durableIdentity.projectedOperationId
        && durableIdentity.projectedOperationId !== operation.operationId)
    ) throw new Error("DURABLE_INFERENCE_OPERATION_ID_MISMATCH");
    return {
      kind: "ok",
      value: {
        ...durableTaskObject(row, operation),
        cancellationRequested: operation.status !== "completed"
          && operation.status !== "failed"
          && operation.status !== "cancelled"
          && operation.status !== "expired",
      },
    };
  }
  if (durableIdentity) {
    if (isTerminalTaskStatus(row.status)) {
      return { kind: "ok", value: toMcpTaskObject(row) };
    }
    const now = new Date();
    if (row.status === "submitted") {
      const canceled = await prisma.taskRun.updateMany({
        where: { taskRunId: row.taskRunId, status: "submitted", updatedAt: row.updatedAt },
        data: {
          status: "canceled",
          completedAt: now,
          progressPayload: {
            ...(object(row.progressPayload) ?? {}),
            durableInference: {
              ...(object(object(row.progressPayload)?.["durableInference"]) ?? {}),
              state: "cancelled-before-admission",
              cancellationRequestedAt: now.toISOString(),
            },
          },
        },
      });
      if (canceled.count === 1) {
        return {
          kind: "ok",
          value: {
            ...toMcpTaskObject({ ...row, status: "canceled", completedAt: now }),
            cancellationRequested: true,
          },
        };
      }
      throw new Error("DURABLE_INFERENCE_PRE_ADMISSION_CANCEL_RACE");
    }
    if (row.status !== "working" && row.status !== "quiescing") {
      throw new Error("DURABLE_INFERENCE_PRE_ADMISSION_CANCEL_RACE");
    }
    const requested = await prisma.taskRun.updateMany({
      where: { taskRunId: row.taskRunId, status: row.status, updatedAt: row.updatedAt },
      data: {
        progressPayload: {
          ...(object(row.progressPayload) ?? {}),
          durableInference: {
            ...(object(object(row.progressPayload)?.["durableInference"]) ?? {}),
            cancellationRequestedAt: now.toISOString(),
          },
        },
      },
    });
    if (requested.count !== 1) throw new Error("DURABLE_INFERENCE_PRE_ADMISSION_CANCEL_RACE");
    return {
      kind: "ok",
      value: { ...toMcpTaskObject(row), cancellationRequested: true },
    };
  }
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
