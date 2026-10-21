import { prisma } from "@dpf/db";
import type { ToolExecutionContext, ToolResult } from "@/lib/mcp-tool-types";
import { isRecord } from "@/lib/shared/coerce";
import { readOriginalReviewResult } from "@/lib/mcp-task-original-result";
import { currentTaskReadAuthority, admitOwnedTaskOrigin, taskReadFingerprint, type OwnedTaskRow } from "./owned-task-read-origin";
import { MCP_TASK_DURABLE_SELECT, tasksLifecycleEnabled, projectMcpTaskStatus, projectMcpTaskResult } from "./tasks-lifecycle";
import { projectOwnedTaskRead } from "./owned-task-read-projection";

const unavailable = (): ToolResult => ({ success: false, error: "owned_task_read_unavailable",
  message: "The task is unavailable under this connection." });
const select = { ...MCP_TASK_DURABLE_SELECT, id: true } as const;
async function load(taskId: string): Promise<OwnedTaskRow | null> {
  return prisma.taskRun.findUnique({ where: { taskRunId: taskId }, select });
}

/** Named compatibility projection; no polling, recovery, dispatch or protocol change. */
export async function getOwnedMcpTask(params: Record<string, unknown>, userId: string,
  context?: ToolExecutionContext): Promise<ToolResult> {
  const taskId = params.taskId;
  const mode = params.mode === undefined ? "status" : params.mode;
  if (Object.keys(params).some(key => key !== "taskId" && key !== "mode")
    || typeof taskId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,255}$/.test(taskId)
    || (mode !== "status" && mode !== "result")) {
    return { success: false, error: "owned_task_read_invalid", message: "Provide one exact taskId and mode status or result." };
  }
  if (!tasksLifecycleEnabled()) return unavailable();
  try {
    const authority = await currentTaskReadAuthority(userId, context);
    if (!authority) return unavailable();
    const row = await load(taskId);
    if (!row) return unavailable();
    const origin = await admitOwnedTaskOrigin(row, authority);
    if (!origin) return unavailable();
    const actor = { actingAgentId: authority.agentId, tokenGrantScopes: context?.tokenGrantScopes ?? [] };
    // The generic protocol status path does not perform the initiative collector's
    // current original-owner/scope/room checks. Apply those in both named modes.
    const initiative = origin.kind === "initiative" ? await readOriginalReviewResult({
      taskRunId: taskId, userId, ...actor,
      expected: { requestDigest: String(isRecord(row.a2aMetadata) ? row.a2aMetadata.requestDigest ?? "" : ""),
        updatedAt: row.updatedAt.toISOString() },
    }) : null;
    if (origin.kind === "initiative" && (!initiative?.binding
      || initiative.binding.requestDigest !== String(isRecord(row.a2aMetadata) ? row.a2aMetadata.requestDigest : "")
      || initiative.binding.checkpointUpdatedAt !== row.updatedAt.toISOString())) return unavailable();
    let lifecycle = await (mode === "status" ? projectMcpTaskStatus(row, userId)
      : projectMcpTaskResult(row, userId, { taskId }, actor));
    if (lifecycle.kind !== "ok") return unavailable();
    if (mode === "result" && initiative) {
      const value = isRecord(lifecycle.value) && isRecord(lifecycle.value.structuredContent) ? lifecycle.value.structuredContent : null;
      if (!value || taskReadFingerprint(value.originalResult) !== taskReadFingerprint(initiative)) return unavailable();
    }
    if (mode === "status" && initiative && isRecord(lifecycle.value)) {
      lifecycle = { kind: "ok", value: { ...lifecycle.value, originalResult: initiative } };
    }
    const projected = projectOwnedTaskRead({ mode, task: row, lifecycle, originKind: origin.kind });
    if (origin.kind === "initiative") {
      const finalResult = await readOriginalReviewResult({ taskRunId: taskId, userId, ...actor,
        expected: { requestDigest: String(isRecord(row.a2aMetadata) ? row.a2aMetadata.requestDigest ?? "" : ""),
          updatedAt: row.updatedAt.toISOString() } });
      if (!finalResult || taskReadFingerprint(finalResult) !== taskReadFingerprint(initiative)) return unavailable();
    }
    if (origin.kind === "durable") {
      const latest = await (mode === "status" ? projectMcpTaskStatus(row, userId)
        : projectMcpTaskResult(row, userId, { taskId }, actor));
      if (taskReadFingerprint(latest) !== taskReadFingerprint(lifecycle)) return unavailable();
    }
    // Specialized readers retain their own proof fences. Re-read this exact task,
    // its origin artifact/message and current admission after all result collection.
    const finalRow = await load(taskId);
    const finalAuthority = await currentTaskReadAuthority(userId, context);
    if (!tasksLifecycleEnabled() || !finalRow || !finalAuthority
      || finalAuthority.fingerprint !== authority.fingerprint
      || taskReadFingerprint(finalRow) !== taskReadFingerprint(row)) return unavailable();
    const finalOrigin = await admitOwnedTaskOrigin(finalRow, finalAuthority);
    if (!finalOrigin || finalOrigin.kind !== origin.kind || finalOrigin.fingerprint !== origin.fingerprint) return unavailable();
    return projected;
  } catch { return unavailable(); }
}
