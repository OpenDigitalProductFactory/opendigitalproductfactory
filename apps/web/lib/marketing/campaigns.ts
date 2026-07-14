// Marketing campaign aggregate — the executable plan object.
//
// A campaign ties objective + audience + channels + budget + timeline + KPI
// targets together and owns its child briefs and asset tasks (via the
// campaignId relation added in the 20260626120000_add_marketing_campaign
// migration). These functions are the establish/execute surface the Marketing
// Strategist drives: create the plan, attach work to it, read the plan with a
// live execution rollup, and update its status/budget/timeline.
//
// The rollup math is a PURE function (summarizeCampaignExecution) so it is
// unit-testable without a database, mirroring the view-builders in subroutes.ts.

import { prisma } from "@dpf/db";
import { getMarketingWorkspaceSnapshot } from "../marketing";

export const CAMPAIGN_STATUSES = ["draft", "active", "paused", "complete"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export type CampaignExecutionInput = {
  briefs: Array<{ status: string }>;
  tasks: Array<{ status: string; taskId: string }>;
  draftedTaskIds?: Set<string>;
  approvedTaskIds?: Set<string>;
};

export type CampaignExecutionRollup = {
  briefCount: number;
  taskCount: number;
  draftedCount: number;
  approvedCount: number;
  undraftedCount: number;
  /** The single most useful next executable step, in plain language. */
  nextStep: string;
};

/**
 * Pure: summarize where a campaign is in execution from its briefs, tasks, and
 * which tasks have drafted/approved assets. No DB access — unit-testable.
 */
export function summarizeCampaignExecution(input: CampaignExecutionInput): CampaignExecutionRollup {
  const briefCount = input.briefs.length;
  const taskCount = input.tasks.length;
  const drafted = input.draftedTaskIds ?? new Set<string>();
  const approved = input.approvedTaskIds ?? new Set<string>();

  const approvedCount = input.tasks.filter((t) => approved.has(t.taskId)).length;
  const draftedCount = input.tasks.filter((t) => drafted.has(t.taskId) && !approved.has(t.taskId)).length;
  const undraftedCount = Math.max(0, taskCount - draftedCount - approvedCount);

  let nextStep: string;
  if (briefCount === 0) {
    nextStep = "Create a campaign brief to define the objective, audience, and channels.";
  } else if (taskCount === 0) {
    nextStep = "Break the brief into asset tasks for each piece of content.";
  } else if (undraftedCount > 0) {
    nextStep = `Draft ${undraftedCount} asset task${undraftedCount === 1 ? "" : "s"} that still need content.`;
  } else if (draftedCount > 0) {
    nextStep = `Review ${draftedCount} draft${draftedCount === 1 ? "" : "s"} in the approval queue.`;
  } else if (approvedCount > 0) {
    nextStep = `Publish ${approvedCount} approved draft${approvedCount === 1 ? "" : "s"} on their channels.`;
  } else {
    nextStep = "All asset tasks are produced — set KPI targets and measure.";
  }

  return { briefCount, taskCount, draftedCount, approvedCount, undraftedCount, nextStep };
}

export type CreateCampaignInput = {
  name: string;
  objective: string;
  audience?: string;
  channels?: string[];
  budgetTotalCents?: number;
  budgetByChannel?: Record<string, number>;
  startDate?: string;
  endDate?: string;
  kpiTargets?: unknown;
  primaryCta?: string;
  notes?: string;
  createdByAgentId?: string | null;
};

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function createMarketingCampaign(
  input: CreateCampaignInput,
): Promise<{ campaignId: string; message: string } | null> {
  const snapshot = await getMarketingWorkspaceSnapshot();
  if (!snapshot) return null;

  const record = await prisma.marketingCampaign.create({
    data: {
      organizationId: snapshot.organization.id,
      strategyId: snapshot.strategy.strategyId,
      name: input.name.trim(),
      objective: input.objective.trim(),
      audience: input.audience?.trim() || null,
      channels: input.channels ?? [],
      budgetTotalCents: typeof input.budgetTotalCents === "number" ? Math.round(input.budgetTotalCents) : null,
      budgetByChannel: input.budgetByChannel ?? undefined,
      startDate: parseDate(input.startDate),
      endDate: parseDate(input.endDate),
      kpiTargets: input.kpiTargets ?? undefined,
      primaryCta: input.primaryCta?.trim() || null,
      notes: input.notes?.trim() || null,
      createdByAgentId: input.createdByAgentId ?? null,
    },
    select: { campaignId: true, name: true },
  });

  return {
    campaignId: record.campaignId,
    message: `Established campaign "${record.name}" (${record.campaignId}). Attach briefs and asset tasks to execute it.`,
  };
}

export async function updateMarketingCampaign(input: {
  campaignId: string;
  status?: string;
  budgetTotalCents?: number;
  startDate?: string;
  endDate?: string;
  notes?: string;
}): Promise<{ campaignId: string; message: string } | { error: string; message: string }> {
  if (input.status && !CAMPAIGN_STATUSES.includes(input.status as CampaignStatus)) {
    return {
      error: "invalid-status",
      message: `status must be one of: ${CAMPAIGN_STATUSES.join(", ")}.`,
    };
  }
  const existing = await prisma.marketingCampaign.findUnique({
    where: { campaignId: input.campaignId },
    select: { campaignId: true },
  });
  if (!existing) {
    return { error: "not-found", message: `Campaign ${input.campaignId} does not exist.` };
  }

  await prisma.marketingCampaign.update({
    where: { campaignId: input.campaignId },
    data: {
      ...(input.status ? { status: input.status } : {}),
      ...(typeof input.budgetTotalCents === "number" ? { budgetTotalCents: Math.round(input.budgetTotalCents) } : {}),
      ...(input.startDate !== undefined ? { startDate: parseDate(input.startDate) } : {}),
      ...(input.endDate !== undefined ? { endDate: parseDate(input.endDate) } : {}),
      ...(input.notes !== undefined ? { notes: input.notes.trim() || null } : {}),
    },
  });
  return { campaignId: input.campaignId, message: `Updated campaign ${input.campaignId}.` };
}

export async function attachToCampaign(input: {
  campaignId: string;
  briefId?: string;
  taskId?: string;
}): Promise<{ message: string } | { error: string; message: string }> {
  const campaignId = input.campaignId.trim();
  const briefId = input.briefId?.trim() || undefined;
  const taskId = input.taskId?.trim() || undefined;

  if (!briefId && !taskId) {
    return { error: "no-target", message: "Provide a briefId or taskId to attach to the campaign." };
  }
  const campaign = await prisma.marketingCampaign.findUnique({
    where: { campaignId },
    select: { campaignId: true },
  });
  if (!campaign) {
    const [briefWithThatId, taskWithThatId] = await Promise.all([
      prisma.marketingCampaignBrief.findUnique({
        where: { briefId: campaignId },
        select: { briefId: true },
      }),
      prisma.marketingAssetTask.findUnique({
        where: { taskId: campaignId },
        select: { taskId: true },
      }),
    ]);
    if (briefWithThatId) {
      return {
        error: "wrong-campaign-id",
        message: `The value passed as campaignId looks like a briefId (${campaignId}). Use the MarketingCampaign.campaignId returned by create_marketing_campaign or get_campaign_plan, and pass ${campaignId} as briefId if that is the brief to attach.`,
      };
    }
    if (taskWithThatId) {
      return {
        error: "wrong-campaign-id",
        message: `The value passed as campaignId looks like a taskId (${campaignId}). Use the MarketingCampaign.campaignId returned by create_marketing_campaign or get_campaign_plan, and pass ${campaignId} as taskId if that is the task to attach.`,
      };
    }
    return { error: "not-found", message: `Campaign ${campaignId} does not exist.` };
  }

  if (briefId) {
    const brief = await prisma.marketingCampaignBrief.findUnique({
      where: { briefId },
      select: { briefId: true },
    });
    if (!brief) {
      return { error: "brief-not-found", message: `Brief ${briefId} does not exist.` };
    }
  }
  if (taskId) {
    const task = await prisma.marketingAssetTask.findUnique({
      where: { taskId },
      select: { taskId: true },
    });
    if (!task) {
      return { error: "task-not-found", message: `Task ${taskId} does not exist.` };
    }
  }

  const attached: string[] = [];
  if (briefId) {
    await prisma.marketingCampaignBrief.update({
      where: { briefId },
      data: { campaignId },
    });
    attached.push(`brief ${briefId}`);
  }
  if (taskId) {
    await prisma.marketingAssetTask.update({
      where: { taskId },
      data: { campaignId },
    });
    attached.push(`task ${taskId}`);
  }
  return { message: `Attached ${attached.join(" and ")} to campaign ${campaignId}.` };
}

export async function getCampaignPlan(
  campaignId: string,
): Promise<{ message: string; data: Record<string, unknown> } | { error: string; message: string }> {
  const campaign = await prisma.marketingCampaign.findUnique({
    where: { campaignId },
    include: {
      briefs: { select: { briefId: true, title: true, status: true } },
      assetTasks: { select: { taskId: true, title: true, assetType: true, channel: true, status: true } },
    },
  });
  if (!campaign) {
    return { error: "not-found", message: `Campaign ${campaignId} does not exist.` };
  }

  const draftedTaskIds = new Set<string>();
  const approvedTaskIds = new Set<string>();
  const drafts = await prisma.outboundDraft.findMany({
    where: {
      domain: "marketing",
      sourceType: "marketing-asset-task",
      sourceId: { in: campaign.assetTasks.map((t: { taskId: string }) => t.taskId) },
    },
    select: { sourceId: true, status: true },
  });
  for (const d of drafts) {
    if (!d.sourceId) continue;
    if (d.status === "approved" || d.status === "published") approvedTaskIds.add(d.sourceId);
    else draftedTaskIds.add(d.sourceId);
  }

  const rollup = summarizeCampaignExecution({
    briefs: campaign.briefs,
    tasks: campaign.assetTasks,
    draftedTaskIds,
    approvedTaskIds,
  });

  return {
    message: `Campaign "${campaign.name}" — ${campaign.status}. ${rollup.nextStep}`,
    data: {
      campaign: {
        campaignId: campaign.campaignId,
        name: campaign.name,
        objective: campaign.objective,
        audience: campaign.audience,
        channels: campaign.channels,
        status: campaign.status,
        budgetTotalCents: campaign.budgetTotalCents,
        budgetByChannel: campaign.budgetByChannel,
        startDate: campaign.startDate,
        endDate: campaign.endDate,
        kpiTargets: campaign.kpiTargets,
        primaryCta: campaign.primaryCta,
      },
      briefs: campaign.briefs,
      assetTasks: campaign.assetTasks,
      execution: rollup,
    },
  };
}
