import { prisma, type Prisma } from "@dpf/db";
import { isRecord } from "@/lib/shared/coerce";
import { coworkerAuthorityAgentId } from "@/lib/coworker-identity";
import type { ToolDefinition, ToolExecutionContext, ToolResult } from "@/lib/mcp-tool-types";
import { assertScheduledReportingEligible, isScheduledReportingRead, readScheduledReportingMode, scheduledReportingScopeDigest } from "./scheduled-reporting-contract";

const reportingRunSelect = { taskRunId: true, userId: true, threadId: true, currentAgentId: true, initiatingAgentId: true,
  a2aMetadata: true, parentTaskRunId: true, status: true, startedAt: true } as const;
type ReportingRun = Prisma.TaskRunGetPayload<{ select: typeof reportingRunSelect }>;

export function assertCurrentScheduledReportingContext(task: Record<string, unknown>, run: Record<string, unknown>,
  userId: string, context: ToolExecutionContext, allowSettled = false) {
  const mode = readScheduledReportingMode(task.taskConfig);
  assertScheduledReportingEligible(task, userId, false);
  const metadata = isRecord(run.a2aMetadata) ? run.a2aMetadata : {};
  const source = isRecord(metadata.sourceRef) ? metadata.sourceRef : null;
  const binding = isRecord(metadata.scheduledReporting) ? metadata.scheduledReporting : null;
  if (!mode || run.userId !== userId || !task.isActive || task.taskRunId !== run.taskRunId
    || context.taskRunId !== run.taskRunId || context.threadId !== run.threadId
    || !allowSettled && run.status !== "working" || source?.kind !== "scheduled-task" || source.id !== task.taskId
    || !context.agentId || coworkerAuthorityAgentId(context.agentId) !== coworkerAuthorityAgentId(String(task.agentId))
    || !binding || binding.mode !== mode || binding.scopeDigest !== scheduledReportingScopeDigest(task)
    || !Object.hasOwn(binding, "nextRunAt") || binding.nextRunAt !== (task.nextRunAt instanceof Date ? task.nextRunAt.toISOString() : null)) {
    throw new Error("Scheduled reporting requires the current admitted task, owner, actor, thread and commission.");
  }
  return { mode, scopeDigest: String(binding.scopeDigest) };
}

/** Re-resolve persisted authority for every call, including old approved calls. */
export async function resolveScheduledReportingContext(userId: string, context?: ToolExecutionContext) {
  if (!context?.taskRunId) return null;
  const visited = new Set<string>();
  let taskRunId: string | null = context.taskRunId;
  while (taskRunId && visited.size < 8) {
    if (visited.has(taskRunId)) throw new Error("Scheduled reporting lineage is unavailable.");
    visited.add(taskRunId);
    const run: ReportingRun | null = await prisma.taskRun.findUnique({ where: { taskRunId }, select: reportingRunSelect });
    if (!run) return null;
    const metadata = isRecord(run.a2aMetadata) ? run.a2aMetadata : {};
    const source = isRecord(metadata.sourceRef) ? metadata.sourceRef : null;
    if (source?.kind !== "scheduled-task" || typeof source.id !== "string") {
      if (!run.parentTaskRunId) return null;
      if (run.userId !== userId) throw new Error("Scheduled reporting owner context changed.");
      taskRunId = run.parentTaskRunId;
      continue;
    }
    if (run.userId !== userId) throw new Error("Scheduled reporting owner context changed.");
    const task = await prisma.scheduledAgentTask.findUnique({ where: { taskId: source.id } });
    if (!task || task.ownerUserId !== userId) throw new Error("Scheduled reporting task is unavailable.");
    const mode = readScheduledReportingMode(task.taskConfig);
    if (!mode) {
      if (metadata.scheduledReporting !== undefined) throw new Error("Scheduled reporting commission changed.");
      return null;
    }
    const binding = assertCurrentScheduledReportingContext(task, run, userId, context);
    return { task, run, ...binding };
  }
  if (taskRunId) throw new Error("Scheduled reporting lineage exceeds its supported bound.");
  return null;
}

export async function scheduledReportingToolRefusal(toolName: string, userId: string, context?: ToolExecutionContext, definition?: ToolDefinition): Promise<ToolResult | null> {
  try {
    const reporting = await resolveScheduledReportingContext(userId, context);
    if (!reporting) return null;
    if (!definition || definition.name !== toolName || !isScheduledReportingRead(definition)) return { success: false, error: "scheduled_reporting_write_refused",
      message: "This scheduled commission permits observation and reporting only. Operational actions require their own current authority." };
    return null;
  } catch {
    return { success: false, error: "scheduled_reporting_authority_changed", message: "The scheduled commission or its current execution context changed. This call cannot continue." };
  }
}
