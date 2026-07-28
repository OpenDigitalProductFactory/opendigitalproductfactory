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
import { resolveMarketingOrganizationId } from "./org-scope";

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

// ─── Drill-in scope + recovery ──────────────────────────────────────────────
//
// Two production defects are answered here. First, campaign drill-ins resolved
// their campaign with a bare findUnique on campaignId, so a campaign belonging
// to another organization was readable by id. Second, an omitted campaignId
// produced "Campaign  does not exist." — the exact opaque failure the Marketing
// Strategist hit over and over, with nothing in the response that let it
// self-correct. A drill-in that cannot answer now returns the campaign IDs it
// COULD answer for, plus one instruction.

export type CampaignCandidate = {
  campaignId: string;
  name: string;
  status: string;
  /** The single most useful next step for this campaign, in plain language. */
  nextStep: string;
};

export type CampaignDrillInFailure = {
  error: "campaign-id-required" | "campaign-not-found" | "no-workspace";
  message: string;
  data: { candidates: CampaignCandidate[]; recovery: string };
};

function describeCandidates(candidates: CampaignCandidate[]): string {
  return candidates.map((c) => `${c.campaignId} (${c.name} — ${c.status})`).join(", ");
}

/**
 * Pure: turn a failed drill-in into an actionable result.
 * A blank/whitespace campaignId is classified as "you did not pass one", never
 * as a lookup miss — those need different recovery instructions.
 */
export function buildCampaignDrillInRecovery(input: {
  requestedCampaignId: string;
  candidates: CampaignCandidate[];
  toolName: string;
}): CampaignDrillInFailure {
  const requested = input.requestedCampaignId.trim();
  const { candidates, toolName } = input;

  if (candidates.length === 0) {
    return {
      error: requested ? "campaign-not-found" : "campaign-id-required",
      message: requested
        ? `Campaign ${requested} does not exist in this workspace, and no campaigns exist yet.`
        : `${toolName} needs a campaignId, and no campaign exists yet.`,
      data: {
        candidates: [],
        recovery:
          "Establish a campaign first with create_marketing_campaign, then drill into it by its campaignId.",
      },
    };
  }

  const recovery = `Re-call ${toolName} with campaignId set to one of the listed ids; get_marketing_summary returns the same ids with their current state.`;

  if (!requested) {
    return {
      error: "campaign-id-required",
      message: `${toolName} needs a campaignId. Campaigns in this workspace: ${describeCandidates(candidates)}.`,
      data: { candidates, recovery },
    };
  }

  return {
    error: "campaign-not-found",
    message: `Campaign ${requested} does not exist in this workspace. Campaigns in this workspace: ${describeCandidates(candidates)}.`,
    data: { candidates, recovery },
  };
}

/** The campaigns this organization can be asked about, newest first. */
export async function listCampaignCandidates(organizationId: string): Promise<CampaignCandidate[]> {
  const rows = await prisma.marketingCampaign.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      campaignId: true,
      name: true,
      status: true,
      _count: { select: { briefs: true, assetTasks: true } },
    },
  });
  return rows.map((row: { campaignId: string; name: string; status: string; _count?: { briefs: number; assetTasks: number } }) => ({
    campaignId: row.campaignId,
    name: row.name,
    status: row.status,
    nextStep: summarizeCampaignExecution({
      briefs: new Array(row._count?.briefs ?? 0).fill({ status: "draft" }),
      tasks: new Array(row._count?.assetTasks ?? 0)
        .fill(null)
        .map((_, i) => ({ status: "draft", taskId: `${row.campaignId}:${i}` })),
    }).nextStep,
  }));
}

export type CampaignScopeResult =
  | {
      ok: true;
      organizationId: string;
      campaignId: string;
      listCandidates: () => Promise<CampaignCandidate[]>;
    }
  | { ok: false; failure: CampaignDrillInFailure };

/**
 * Resolve a campaign drill-in against the configured organization.
 * Every campaign read/write goes through here so organization isolation is
 * expressed once, in the query predicate, rather than re-derived per caller.
 */
export async function requireCampaignInScope(
  campaignId: string,
  toolName: string,
): Promise<CampaignScopeResult> {
  const organizationId = await resolveMarketingOrganizationId();
  if (!organizationId) {
    return {
      ok: false,
      failure: {
        error: "no-workspace",
        message: "No organization workspace is configured, so there are no campaigns to read.",
        data: { candidates: [], recovery: "Complete organization setup before reading marketing campaigns." },
      },
    };
  }

  const requested = campaignId.trim();
  if (!requested) {
    return {
      ok: false,
      failure: buildCampaignDrillInRecovery({
        requestedCampaignId: "",
        candidates: await listCampaignCandidates(organizationId),
        toolName,
      }),
    };
  }

  const campaign = await prisma.marketingCampaign.findFirst({
    where: { campaignId: requested, organizationId },
    select: { campaignId: true },
  });
  if (!campaign) {
    return {
      ok: false,
      failure: buildCampaignDrillInRecovery({
        requestedCampaignId: requested,
        candidates: await listCampaignCandidates(organizationId),
        toolName,
      }),
    };
  }

  return {
    ok: true,
    organizationId,
    campaignId: requested,
    listCandidates: () => listCampaignCandidates(organizationId),
  };
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
  const organizationId = await resolveMarketingOrganizationId();
  const existing = organizationId
    ? await prisma.marketingCampaign.findFirst({
        where: { campaignId: input.campaignId, organizationId },
        select: { campaignId: true },
      })
    : null;
  if (!existing) {
    return { error: "not-found", message: `Campaign ${input.campaignId} does not exist in this workspace.` };
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
  const organizationId = await resolveMarketingOrganizationId();
  if (!organizationId) {
    return { error: "no-workspace", message: "No organization workspace is configured." };
  }
  const campaign = await prisma.marketingCampaign.findFirst({
    where: { campaignId, organizationId },
    select: { campaignId: true },
  });
  if (!campaign) {
    const [briefWithThatId, taskWithThatId] = await Promise.all([
      prisma.marketingCampaignBrief.findFirst({
        where: { briefId: campaignId, organizationId },
        select: { briefId: true },
      }),
      prisma.marketingAssetTask.findFirst({
        where: { taskId: campaignId, organizationId },
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
    return { error: "not-found", message: `Campaign ${campaignId} does not exist in this workspace.` };
  }

  if (briefId) {
    const brief = await prisma.marketingCampaignBrief.findFirst({
      where: { briefId, organizationId },
      select: { briefId: true },
    });
    if (!brief) {
      return { error: "brief-not-found", message: `Brief ${briefId} does not exist.` };
    }
  }
  if (taskId) {
    const task = await prisma.marketingAssetTask.findFirst({
      where: { taskId, organizationId },
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

/**
 * Read a campaign's plan plus its live execution rollup, scoped to the
 * configured organization. A missing or unknown campaignId returns candidate
 * IDs and one recovery instruction instead of an opaque miss.
 */
export async function getCampaignPlan(
  campaignId: string,
): Promise<{ message: string; data: Record<string, unknown> } | CampaignDrillInFailure> {
  const scope = await requireCampaignInScope(campaignId, "get_campaign_plan");
  if (!scope.ok) return scope.failure;

  const campaign = await prisma.marketingCampaign.findFirst({
    where: { campaignId: scope.campaignId, organizationId: scope.organizationId },
    include: {
      briefs: { select: { briefId: true, title: true, status: true } },
      assetTasks: { select: { taskId: true, title: true, assetType: true, channel: true, status: true } },
    },
  });
  if (!campaign) {
    return buildCampaignDrillInRecovery({
      requestedCampaignId: scope.campaignId,
      candidates: await scope.listCandidates(),
      toolName: "get_campaign_plan",
    });
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
