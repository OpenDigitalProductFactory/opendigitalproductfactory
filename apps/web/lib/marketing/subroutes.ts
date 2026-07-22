import type { Intent } from "@/components/ui/report-kit";
import {
  formatMarketingLabel,
  type MarketingWorkspaceSnapshot,
  type OutboundDraftRow,
} from "@/lib/marketing";
import {
  getOpportunityStageMeta,
  isOpenOpportunityStage,
  OPEN_OPPORTUNITY_STAGES,
} from "@/lib/crm/presentation";
import { assessArchetypeFit, type ArchetypeFitAssessment } from "@/lib/marketing/archetype-fit";

export type MarketingMetric = {
  label: string;
  value: string;
  hint: string;
  intent: Intent;
};

export type MarketingCampaignRow = {
  id: string;
  title: string;
  objective: string;
  audience: string;
  channels: string[];
  channelsLabel: string;
  status: string;
  createdAt: Date;
  taskCount: number;
  pendingDraftCount: number;
  approvedDraftCount: number;
  nextWorkLabel: string;
  kpis: string[];
  archetypeFit: ArchetypeFitAssessment;
};

export type MarketingAssetTaskRow = {
  id: string;
  title: string;
  assetType: string;
  channelLabel: string;
  dueWindow: string;
  status: string;
  draftStatusLabel: string;
  brief: string;
  archetypeFit: ArchetypeFitAssessment;
};

export type MarketingCampaignsView = {
  metrics: MarketingMetric[];
  campaigns: MarketingCampaignRow[];
  assetTasks: MarketingAssetTaskRow[];
  hasWork: boolean;
  /** Count of saved artifacts flagged as imported/test data (blocked from publish). */
  importedTestCount: number;
};

export type MarketingFunnelEngagementInput = {
  source: string | null;
  status: string;
  count: number;
};

export type MarketingFunnelOpportunityInput = {
  source: string | null;
  stage: string;
  expectedValue: number | null;
};

export type MarketingFunnelEvidenceInput = {
  engagements: MarketingFunnelEngagementInput[];
  opportunities: MarketingFunnelOpportunityInput[];
};

export type MarketingFunnelSourceRow = {
  source: string;
  engagementCount: number;
  opportunityCount: number;
  openOpportunityCount: number;
  wonCount: number;
  pipelineValue: number;
  pipelineValueLabel: string;
  evidenceLabel: string;
};

export type MarketingFunnelStageRow = {
  stage: string;
  stageLabel: string;
  count: number;
  pipelineValue: number;
  pipelineValueLabel: string;
};

export type MarketingFunnelView = {
  metrics: MarketingMetric[];
  sourceRows: MarketingFunnelSourceRow[];
  stageRows: MarketingFunnelStageRow[];
  kpiRows: Array<{
    id: string;
    metric: string;
    target: string;
    cadence: string;
    status: string;
    notes: string;
  }>;
  hasEvidence: boolean;
};

export type MarketingAutomationCandidateRow = {
  id: string;
  title: string;
  trigger: string;
  action: string;
  rationale: string;
  status: string;
  approvalLabel: string;
  safetyLabel: string;
  intent: Intent;
};

export type MarketingAutomationView = {
  metrics: MarketingMetric[];
  candidates: MarketingAutomationCandidateRow[];
  hasCandidates: boolean;
};

const STAGE_ORDER = [...OPEN_OPPORTUNITY_STAGES, "closed_won", "closed_lost"];

function plural(count: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

function nonEmpty(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function channelLabel(channel: string | null | undefined): string {
  return channel ? formatMarketingLabel(channel) : "Unassigned channel";
}

function joinLabels(values: string[], fallback: string): string {
  return values.length > 0 ? values.map(formatMarketingLabel).join(", ") : fallback;
}

function sourceLabel(source: string | null | undefined): string {
  if (!source) return "Unattributed";
  if (source === "facebook-lead-ads") return "Facebook Lead Ads";
  return formatMarketingLabel(source);
}

function moneyLabel(value: number): string {
  return `GBP ${Math.round(value).toLocaleString("en-GB")}`;
}

function draftForTask(taskId: string, drafts: OutboundDraftRow[]): OutboundDraftRow | null {
  return (
    drafts.find(
      (draft) =>
        draft.sourceType === "marketing-asset-task" && draft.sourceId === taskId,
    ) ?? null
  );
}

function draftLifecycleLabel(status: string): string {
  if (status === "pending-review") return "Pending review";
  if (status === "needs-changes") return "Needs changes";
  return formatMarketingLabel(status);
}

function draftStatusLabel(taskId: string, snapshot: MarketingWorkspaceSnapshot): string {
  const pending = draftForTask(taskId, snapshot.pendingDrafts);
  if (pending) return draftLifecycleLabel(pending.status);
  const approved = draftForTask(taskId, snapshot.approvedDrafts);
  if (approved) return "Approved";
  return "Not drafted";
}

// Associate an asset task with a campaign brief. Prefers the real campaign
// relation: when both rows carry the same campaignId it is a definitive match,
// and when both carry a (different) campaignId it is a definitive non-match — no
// fuzzy guessing. Only when at least one side has no campaign yet do we fall
// back to the legacy heuristic (channel overlap or brief-title substring), so
// pre-campaign rows keep rendering as before.
export function taskMatchesBrief(
  task: { campaignId?: string | null; channel?: string | null; title: string; brief?: string | null },
  brief: { campaignId?: string | null; channels: readonly string[]; title: string },
): boolean {
  if (task.campaignId && brief.campaignId) {
    return task.campaignId === brief.campaignId;
  }
  if (task.channel && brief.channels.includes(task.channel)) return true;
  const taskText = `${task.title} ${task.brief ?? ""}`.toLowerCase();
  return taskText.includes(brief.title.toLowerCase());
}

export function buildMarketingCampaignsView(
  snapshot: MarketingWorkspaceSnapshot,
): MarketingCampaignsView {
  const briefs = snapshot.workProducts.campaignBriefs;
  const tasks = snapshot.workProducts.assetTasks;
  const pendingReviewCount = snapshot.pendingDrafts.length;
  const approvedCount = snapshot.approvedDrafts.length;
  const category = snapshot.storefront.category;

  const campaigns = briefs.map((brief) => {
    const matchedTasks = tasks.filter((task) => taskMatchesBrief(task, brief));
    const pendingDraftCount = matchedTasks.filter((task) =>
      Boolean(draftForTask(task.taskId, snapshot.pendingDrafts)),
    ).length;
    const approvedDraftCount = matchedTasks.filter((task) =>
      Boolean(draftForTask(task.taskId, snapshot.approvedDrafts)),
    ).length;
    const undraftedCount = Math.max(0, matchedTasks.length - pendingDraftCount - approvedDraftCount);
    const nextWorkLabel =
      pendingDraftCount > 0
        ? `${plural(pendingDraftCount, "draft")} waiting for review`
        : undraftedCount > 0
          ? `${plural(undraftedCount, "asset task")} needs a draft`
          : approvedDraftCount > 0
            ? `${plural(approvedDraftCount, "draft")} ready to publish`
            : "No asset tasks yet";

    return {
      id: brief.briefId,
      title: brief.title,
      objective: brief.objective,
      audience: nonEmpty(brief.audience, "Audience not specified"),
      channels: brief.channels,
      channelsLabel: joinLabels(brief.channels, "Channels not selected"),
      status: brief.status,
      createdAt: brief.createdAt,
      taskCount: matchedTasks.length,
      pendingDraftCount,
      approvedDraftCount,
      nextWorkLabel,
      kpis: brief.kpis,
      archetypeFit: assessArchetypeFit({
        text: [brief.title, brief.objective, brief.audience, brief.notes, brief.kpis.join(" ")]
          .filter(Boolean)
          .join("\n"),
        category,
      }),
    };
  });

  const assetTasks = tasks.map((task) => ({
    id: task.taskId,
    title: task.title,
    assetType: task.assetType,
    channelLabel: channelLabel(task.channel),
    dueWindow: nonEmpty(task.dueWindow, "No due window"),
    status: task.status,
    draftStatusLabel: draftStatusLabel(task.taskId, snapshot),
    brief: nonEmpty(task.brief, "No saved brief"),
    archetypeFit: assessArchetypeFit({
      text: [task.title, task.brief].filter(Boolean).join("\n"),
      category,
    }),
  }));

  const importedTestCount =
    campaigns.filter((c) => c.archetypeFit.blocked).length +
    assetTasks.filter((t) => t.archetypeFit.blocked).length;

  return {
    metrics: [
      {
        label: "Campaign briefs",
        value: String(briefs.length),
        hint: plural(briefs.length, "active work plan"),
        intent: "accent",
      },
      {
        label: "Asset tasks",
        value: String(tasks.length),
        hint:
          pendingReviewCount > 0
            ? `${pendingReviewCount} waiting for review`
            : "draft queue clear",
        intent: "info",
      },
      {
        label: "Ready to publish",
        value: String(approvedCount),
        hint: "approval-gated",
        intent: "success",
      },
    ],
    campaigns,
    assetTasks,
    hasWork: briefs.length > 0 || tasks.length > 0,
    importedTestCount,
  };
}

export function buildMarketingFunnelView(
  snapshot: MarketingWorkspaceSnapshot,
  evidence: MarketingFunnelEvidenceInput,
): MarketingFunnelView {
  const bySource = new Map<string, MarketingFunnelSourceRow>();
  const byStage = new Map<string, MarketingFunnelStageRow>();

  function ensureSource(source: string | null | undefined): MarketingFunnelSourceRow {
    const key = source ?? "__unattributed";
    const existing = bySource.get(key);
    if (existing) return existing;
    const row: MarketingFunnelSourceRow = {
      source: sourceLabel(source),
      engagementCount: 0,
      opportunityCount: 0,
      openOpportunityCount: 0,
      wonCount: 0,
      pipelineValue: 0,
      pipelineValueLabel: moneyLabel(0),
      evidenceLabel: "Source evidence, not full attribution",
    };
    bySource.set(key, row);
    return row;
  }

  for (const engagement of evidence.engagements) {
    ensureSource(engagement.source).engagementCount += engagement.count;
  }

  for (const opportunity of evidence.opportunities) {
    const source = ensureSource(opportunity.source);
    const value = opportunity.expectedValue ?? 0;
    source.opportunityCount += 1;
    source.pipelineValue += value;
    if (isOpenOpportunityStage(opportunity.stage)) {
      source.openOpportunityCount += 1;
    }
    if (opportunity.stage === "closed_won") {
      source.wonCount += 1;
    }

    const stageMeta = getOpportunityStageMeta(opportunity.stage);
    const stageRow = byStage.get(opportunity.stage) ?? {
      stage: opportunity.stage,
      stageLabel: stageMeta.label,
      count: 0,
      pipelineValue: 0,
      pipelineValueLabel: moneyLabel(0),
    };
    stageRow.count += 1;
    stageRow.pipelineValue += value;
    byStage.set(opportunity.stage, stageRow);
  }

  const sourceRows = [...bySource.values()]
    .map((row) => ({
      ...row,
      pipelineValueLabel: moneyLabel(row.pipelineValue),
    }))
    .sort((a, b) => b.opportunityCount - a.opportunityCount || b.engagementCount - a.engagementCount);
  const stageRows = [...byStage.values()]
    .map((row) => ({
      ...row,
      pipelineValueLabel: moneyLabel(row.pipelineValue),
    }))
    .sort((a, b) => {
      const ai = STAGE_ORDER.indexOf(a.stage as (typeof STAGE_ORDER)[number]);
      const bi = STAGE_ORDER.indexOf(b.stage as (typeof STAGE_ORDER)[number]);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

  const totalEngagements = evidence.engagements.reduce((sum, row) => sum + row.count, 0);
  const totalOpportunities = evidence.opportunities.length;
  const openOpportunities = evidence.opportunities.filter((row) =>
    isOpenOpportunityStage(row.stage),
  ).length;

  return {
    metrics: [
      {
        label: "Source signals",
        value: String(totalEngagements),
        hint: plural(sourceRows.length, "source"),
        intent: "accent",
      },
      {
        label: "Opportunities",
        value: String(totalOpportunities),
        hint: `${openOpportunities} open`,
        intent: "info",
      },
      {
        label: "KPI checkpoints",
        value: String(snapshot.workProducts.kpiCheckpoints.length),
        hint: "strategist evidence",
        intent: "success",
      },
    ],
    sourceRows,
    stageRows,
    kpiRows: snapshot.workProducts.kpiCheckpoints.map((checkpoint) => ({
      id: checkpoint.checkpointId,
      metric: checkpoint.metric,
      target: nonEmpty(checkpoint.target, "No target"),
      cadence: checkpoint.cadence ? formatMarketingLabel(checkpoint.cadence) : "No cadence",
      status: checkpoint.status,
      notes: nonEmpty(checkpoint.notes, "No notes"),
    })),
    hasEvidence: totalEngagements > 0 || totalOpportunities > 0,
  };
}

export function buildMarketingAutomationView(
  snapshot: MarketingWorkspaceSnapshot,
): MarketingAutomationView {
  const candidates = snapshot.workProducts.automationCandidates.map((candidate) => {
    const approvalLabel = candidate.approvalRequired
      ? "Approval required"
      : "Review before enabling";
    const intent: Intent = candidate.approvalRequired ? "warning" : "info";
    return {
      id: candidate.candidateId,
      title: candidate.title,
      trigger: candidate.trigger,
      action: candidate.action,
      rationale: nonEmpty(candidate.rationale, "No rationale recorded"),
      status: candidate.status,
      approvalLabel,
      safetyLabel: candidate.approvalRequired
        ? "Human approval before this can run"
        : "Keep disabled until reviewed",
      intent,
    };
  });

  const approvalRequiredCount = candidates.filter(
    (candidate) => candidate.approvalLabel === "Approval required",
  ).length;

  return {
    metrics: [
      {
        label: "Automation candidates",
        value: String(candidates.length),
        hint:
          approvalRequiredCount > 0
            ? `${approvalRequiredCount} approval-gated`
            : "no approvals waiting",
        intent: "warning",
      },
      {
        label: "Connected channels",
        value: String(snapshot.connectedChannels.length),
        hint: "available to marketing",
        intent: "info",
      },
      {
        label: "Pending drafts",
        value: String(snapshot.pendingDrafts.length),
        hint: "review before external action",
        intent: "accent",
      },
    ],
    candidates,
    hasCandidates: candidates.length > 0,
  };
}
