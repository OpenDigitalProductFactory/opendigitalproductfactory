// Retiring stale marketing work (BI-FB24DC2C).
//
// Campaign briefs and asset tasks had no status transition at all — only
// campaigns did — so work built on a wrong premise could never leave the
// strategy surfaces. On the reference install 16 draft briefs aimed at a buyer
// the business does not serve kept anchoring both the page and the coworker,
// which read them as "current" and refused to plan anything new.
//
// Retiring archives; it never deletes. The rows stay for history and audit,
// carry the reason in their notes, and drop out of the active surfaces (the
// workspace snapshot, the scheduler, the content calendar) via
// ACTIVE_MARKETING_WORK.

import { prisma } from "@dpf/db";

/** The status a retired brief or asset task carries — the strategy's own word for it. */
export const RETIRED_MARKETING_WORK_STATUS = "archived";

/** Prisma filter for briefs and asset tasks that are still live work. */
export const ACTIVE_MARKETING_WORK = { status: { not: RETIRED_MARKETING_WORK_STATUS } } as const;

export type RetireMarketingWorkResult = {
  retiredBriefIds: string[];
  retiredTaskIds: string[];
  /** Ids that were not found in this organization (or were already archived). */
  notFound: string[];
  message: string;
};

function stamp(existing: string | null, reason: string): string {
  const line = `Retired ${new Date().toISOString().slice(0, 10)}: ${reason}`;
  return existing && existing.trim().length > 0 ? `${existing.trim()}\n${line}` : line;
}

/**
 * Archive the named briefs and asset tasks for one organization, recording why.
 * Scoped to the organization so a caller can never retire another org's work.
 */
export async function retireMarketingWork(input: {
  organizationId: string;
  briefIds?: string[];
  taskIds?: string[];
  reason: string;
}): Promise<RetireMarketingWorkResult> {
  const reason = input.reason.trim();
  const briefIds = [...new Set(input.briefIds ?? [])];
  const taskIds = [...new Set(input.taskIds ?? [])];

  const [briefs, tasks] = await Promise.all([
    briefIds.length > 0
      ? prisma.marketingCampaignBrief.findMany({
          where: { organizationId: input.organizationId, briefId: { in: briefIds }, ...ACTIVE_MARKETING_WORK },
          select: { briefId: true, notes: true },
        })
      : Promise.resolve([]),
    taskIds.length > 0
      ? prisma.marketingAssetTask.findMany({
          where: { organizationId: input.organizationId, taskId: { in: taskIds }, ...ACTIVE_MARKETING_WORK },
          select: { taskId: true, brief: true },
        })
      : Promise.resolve([]),
  ]);

  for (const brief of briefs) {
    await prisma.marketingCampaignBrief.update({
      where: { briefId: brief.briefId },
      data: { status: RETIRED_MARKETING_WORK_STATUS, notes: stamp(brief.notes, reason) },
    });
  }
  for (const task of tasks) {
    await prisma.marketingAssetTask.update({
      where: { taskId: task.taskId },
      data: { status: RETIRED_MARKETING_WORK_STATUS, brief: stamp(task.brief, reason) },
    });
  }

  const retiredBriefIds = briefs.map((b) => b.briefId);
  const retiredTaskIds = tasks.map((t) => t.taskId);
  const found = new Set([...retiredBriefIds, ...retiredTaskIds]);
  const notFound = [...briefIds, ...taskIds].filter((id) => !found.has(id));

  return {
    retiredBriefIds,
    retiredTaskIds,
    notFound,
    message:
      `Retired ${retiredBriefIds.length} brief(s) and ${retiredTaskIds.length} asset task(s).` +
      (notFound.length > 0 ? ` Not found or already retired: ${notFound.join(", ")}.` : ""),
  };
}
