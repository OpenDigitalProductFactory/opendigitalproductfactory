import { Prisma, prisma } from "@dpf/db";
import { z } from "zod";
import type { ToolResult } from "@/lib/mcp-tool-types";
import { isRecord } from "@/lib/shared/coerce";
import { assertScheduledReportingEligible, scheduledReportingRevision, SCHEDULED_REPORTING_MODE } from "./scheduled-reporting-contract";

const inputSchema = z.object({ taskId: z.string().trim().min(1).max(128),
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/), mode: z.literal(SCHEDULED_REPORTING_MODE),
  reason: z.string().trim().min(1).max(500) }).strict();

function assertCurrent(task: Record<string, unknown> | null, userId: string, revision: string): void {
  if (!task) throw new Error("Scheduled task is unavailable.");
  assertScheduledReportingEligible(task, userId, true);
  if (scheduledReportingRevision(task) !== revision) throw new Error("Scheduled task changed; read its current revision before configuring reporting.");
}

/** Read-only eligibility runs before the governor can offer an approval. */
export async function preflightConfigureScheduledReporting(params: unknown, userId: string, db = prisma): Promise<ToolResult | null> {
  const parsed = inputSchema.safeParse(params);
  if (!parsed.success) return { success: false, error: "invalid_scheduled_reporting_input", message: "Select the exact task, current revision and supported reporting mode." };
  const task = await db.scheduledAgentTask.findUnique({ where: { taskId: parsed.data.taskId } });
  try { assertCurrent(task, userId, parsed.data.expectedRevision); }
  catch (error) { return { success: false, error: "scheduled_reporting_ineligible", message: error instanceof Error ? error.message : "Scheduled reporting is unavailable." }; }
  return null;
}

export async function configureScheduledReportingFor(userId: string, params: unknown, db = prisma): Promise<ToolResult> {
  const refusal = await preflightConfigureScheduledReporting(params, userId, db);
  if (refusal) return refusal;
  const input = inputSchema.parse(params);
  try {
    const revision = await db.$transaction(async tx => {
      // The owner-filtered row lock also fences same-millisecond revisions.
      const locked = await tx.$queryRaw<Array<{ taskId: string }>>`SELECT "taskId" FROM "ScheduledAgentTask" WHERE "taskId" = ${input.taskId} AND "ownerUserId" = ${userId} FOR UPDATE`;
      if (locked.length !== 1) throw new Error("Scheduled task is unavailable.");
      const task = await tx.scheduledAgentTask.findUnique({ where: { taskId: input.taskId } });
      assertCurrent(task, userId, input.expectedRevision);
      const config = isRecord(task!.taskConfig) ? task!.taskConfig : {};
      const changed = await tx.scheduledAgentTask.updateMany({
        where: { taskId: input.taskId, ownerUserId: userId, isActive: false, updatedAt: task!.updatedAt },
        data: { taskConfig: { ...config, routineReporting: { version: 1, mode: input.mode } } as Prisma.InputJsonValue },
      });
      if (changed.count !== 1) throw new Error("Scheduled task changed before reporting could be configured.");
      const updated = await tx.scheduledAgentTask.findUnique({ where: { taskId: input.taskId } });
      if (!updated) throw new Error("Scheduled task is unavailable.");
      return scheduledReportingRevision(updated);
    }, { maxWait: 5000, timeout: 20000 });
    return { success: true, message: "Reporting now keeps routine observations in this task's history and surfaces actionable changes. The task remains paused.",
      entityId: input.taskId, data: { taskId: input.taskId, mode: input.mode, revision } };
  } catch {
    return { success: false, error: "scheduled_reporting_not_configured", message: "Reporting configuration could not be confirmed. Read the current task before trying again." };
  }
}
