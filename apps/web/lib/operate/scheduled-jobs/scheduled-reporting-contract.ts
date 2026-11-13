import type { ToolDefinition } from "@/lib/mcp-tool-types";
import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { DATA_MODEL_MIRROR_TASK_ID, SYSML_PROJECTION_TASK_ID, SELF_OPTIMIZATION_SWEEP_TASK_ID } from "@dpf/db";
import { isRecord } from "@/lib/shared/coerce";
import { readScheduledWorkTrigger } from "@dpf/validators/workroom-policy/scheduled-work-trigger";
import { isCoworkerSelfTaskId } from "./coworker-self-tasks";
import { getRequiredProceduralToolForScheduledTask, scheduledMandatoryToolNames } from "./scheduled-required-procedural-tool";
import { isOneShotCron, parseCronSchedule } from "@/lib/operate/cron-next-run";

export const SCHEDULED_REPORTING_MODE = "read-only-history" as const;
export const scheduledReportingModeSchema = z.object({ version: z.literal(1), mode: z.literal(SCHEDULED_REPORTING_MODE) }).strict();
const reportSchema = z.object({
  version: z.literal(1), state: z.enum(["routine", "actionable", "unchanged", "resolved", "needs-decision"]),
  summary: z.string().trim().min(1).max(2000),
  evidenceToolNames: z.array(z.string().trim().min(1).max(128)).min(1).max(20)
    .refine(names => new Set(names).size === names.length),
  recommendation: z.string().trim().min(1).max(2000).optional(),
  decisionBrief: z.string().trim().min(1).max(2000).optional(),
  conditionId: z.string().trim().min(1).max(128).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.state === "actionable" && !value.recommendation
    || value.state === "needs-decision" && !value.decisionBrief
    || value.state === "resolved" && !value.conditionId) {
    ctx.addIssue({ code: "custom", message: "The report state requires its supporting detail." });
  }
});
export type ScheduledReport = z.infer<typeof reportSchema>;
const reportingStateSchema = z.object({ version: z.literal(1), condition: z.object({
  conditionId: z.string().uuid(), notificationId: z.string().min(1), attemptId: z.string().min(1), taskRunId: z.string().min(1),
}).strict().nullable(), lastRun: z.object({ taskRunId: z.string().min(1), reportDigest: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["completed", "failed", "input-required", "auth-required"]), summary: z.string().min(1).max(2000),
}).strict().optional() }).strict();
export type ScheduledReportingState = z.infer<typeof reportingStateSchema>;

export function readScheduledReportingState(taskConfig: unknown): ScheduledReportingState {
  const state = isRecord(taskConfig) ? taskConfig.routineReportingState : undefined;
  if (state === undefined) return { version: 1, condition: null };
  const parsed = reportingStateSchema.safeParse(state);
  if (!parsed.success) throw new Error("Scheduled reporting state is unavailable.");
  return parsed.data;
}

export function scheduledReportingPrompt(prompt: string, taskConfig: unknown): string {
  const state = readScheduledReportingState(taskConfig);
  return "This commission permits observation and reporting only. Keep all original privacy, resource and timeout limits. "
    + "Do not perform operational writes or file per-tick evidence. This reporting instruction supersedes routine evidence-writing requests in the retained context. "
    + "Perform real available observations, then return exactly one JSON object (no fences/prose), at most16KiB: "
    + '{"version":1,"state":"routine|actionable|unchanged|resolved|needs-decision","summary":"up to2000 characters","evidenceToolNames":["actual successful read tool names"]}. '
    + "Actionable requires recommendation; needs-decision requires decisionBrief; resolved requires the exact current conditionId and fresh successful observations. "
    + "Optional recommendation/decisionBrief each have a2000-character limit. No extra keys, recipients, URLs, permissions or executable calls. "
    + "Routine/unchanged results stay in task history. Never describe failed/zero observations as healthy. "
    + (state.condition ? `Current unresolved conditionId: ${state.condition.conditionId}. ` : "There is no unresolved condition. ")
    + "\nOriginal task context follows unchanged:\n" + prompt;
}

export function parseScheduledReport(content: string): ScheduledReport {
  if (Buffer.byteLength(content, "utf8") > 16 * 1024) throw new Error("Scheduled report exceeds its size limit.");
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw new Error("Scheduled report must be one JSON object."); }
  const parsed = reportSchema.safeParse(value);
  if (!parsed.success) throw new Error("Scheduled report is malformed or lacks required evidence selectors.");
  return parsed.data;
}

/** Fingerprint scope without disclosing original prompt bytes or operational report state. */
export function scheduledReportingScopeDigest(task: Record<string, unknown>): string {
  const config = isRecord(task.taskConfig) ? { ...task.taskConfig } : task.taskConfig ?? null;
  if (isRecord(config)) delete config.routineReportingState;
  const fields = ["taskId", "ownerUserId", "agentId", "title", "prompt", "routeContext", "schedule", "timezone", "isActive", "taskKind", "organizationId", "productLineId", "businessProductId"];
  return createHash("sha256").update(canonicalJson({ ...Object.fromEntries(fields.map(key => [key, task[key] ?? null])), taskConfig: config })).digest("hex");
}

export function scheduledReportingRevision(task: Record<string, unknown>): string {
  const updatedAt = task.updatedAt instanceof Date ? task.updatedAt.toISOString() : task.updatedAt ?? null;
  return createHash("sha256").update(canonicalJson({ scope: scheduledReportingScopeDigest(task), updatedAt })).digest("hex");
}

export function assertScheduledReportingEligible(task: Record<string, unknown>, userId: string, requirePaused: boolean): void {
  const taskId = typeof task.taskId === "string" ? task.taskId : "";
  if (task.ownerUserId !== userId || !taskId || requirePaused && task.isActive !== false) throw new Error("An owned paused scheduled task is required.");
  if (typeof task.schedule !== "string" || !parseCronSchedule(task.schedule) || isOneShotCron(task.schedule)
    || task.timezone != null && task.timezone !== "UTC") throw new Error("History reporting requires a supported recurring UTC schedule.");
  if (task.taskKind != null || task.organizationId != null || task.productLineId != null || task.businessProductId != null
    || taskId.startsWith("workroom-") || isCoworkerSelfTaskId(taskId)
    || [DATA_MODEL_MIRROR_TASK_ID, SYSML_PROJECTION_TASK_ID, SELF_OPTIMIZATION_SWEEP_TASK_ID].includes(taskId)
    || getRequiredProceduralToolForScheduledTask(taskId, String(task.agentId))
    || scheduledMandatoryToolNames({ prompt: String(task.prompt ?? ""), taskConfig: task.taskConfig }).length > 0) {
    throw new Error("Required or domain-owned workflows cannot use history-only reporting.");
  }
  if (task.taskConfig == null) return;
  if (!isRecord(task.taskConfig) || Object.keys(task.taskConfig).some(key => !["trigger", "routineReporting", "routineReportingState"].includes(key))) {
    throw new Error("Unknown or conflicting scheduled workflow configuration.");
  }
  const config = task.taskConfig;
  if (config.trigger !== undefined) {
    const trigger = readScheduledWorkTrigger(config);
    if (!trigger || trigger.workroomId || trigger.obligation) throw new Error("A governed scheduled trigger cannot be replaced by reporting.");
  }
  if (config.routineReporting !== undefined && !scheduledReportingModeSchema.safeParse(config.routineReporting).success) {
    throw new Error("Unsupported scheduled reporting contract.");
  }
  readScheduledReportingState(config);
}

export function readScheduledReportingMode(taskConfig: unknown): typeof SCHEDULED_REPORTING_MODE | null {
  if (!isRecord(taskConfig) || taskConfig.routineReporting === undefined) return null;
  if (!scheduledReportingModeSchema.safeParse(taskConfig.routineReporting).success) throw new Error("Unsupported scheduled reporting contract.");
  return SCHEDULED_REPORTING_MODE;
}

/** A reporting commission can only narrow the normally authorized catalog. */
export function isScheduledReportingRead(tool: ToolDefinition): boolean {
  return tool.sideEffect === false
    && (tool.executionMode === undefined || tool.executionMode === "immediate")
    && tool.consequence == null
    && tool.consequenceForCall === undefined;
}
