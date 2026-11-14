// The asset tasks a coworker can draft right now (BI-3F641F91).
//
// draft_marketing_asset takes an assetTaskId, and until this list no marketing
// read tool returned one: the operating snapshot reports counts and a prose
// next step. A scheduled marketing run would decide "draft the next asset" and
// had no id to draft from. This names the live LinkedIn and email tasks (the
// channels the drafter supports) that have no draft yet, newest first.

import { prisma } from "@dpf/db";
import { ACTIVE_MARKETING_WORK } from "./retire-work";

export type DraftableAssetTask = {
  assetTaskId: string;
  title: string;
  channel: string;
  campaignId: string | null;
};

/** The channels draft_marketing_asset can write today. */
const DRAFTABLE_CHANNELS = ["linkedin", "email"];

export async function listDraftableAssetTasks(organizationId: string, limit = 3): Promise<DraftableAssetTask[]> {
  const tasks = await prisma.marketingAssetTask.findMany({
    where: { organizationId, ...ACTIVE_MARKETING_WORK, channel: { in: DRAFTABLE_CHANNELS } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { taskId: true, title: true, channel: true, campaignId: true },
  });
  if (tasks.length === 0) return [];
  const drafts = await prisma.outboundDraft.findMany({
    where: { domain: "marketing", sourceType: "marketing-asset-task", sourceId: { in: tasks.map((t) => t.taskId) } },
    select: { sourceId: true },
  });
  const drafted = new Set(drafts.map((d) => d.sourceId));
  return tasks
    .filter((t) => !drafted.has(t.taskId))
    .slice(0, limit)
    .map((t) => ({ assetTaskId: t.taskId, title: t.title, channel: t.channel ?? "", campaignId: t.campaignId }));
}
