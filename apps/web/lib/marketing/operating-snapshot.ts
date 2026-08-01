// The canonical marketing operating snapshot.
//
// Marketing already had the architecture — strategy, campaigns, briefs, tasks,
// variants, drafts, approvals, publications, scheduled actions, KPI checkpoints,
// channel adapters. What it did not have was one place that assembled the
// DECISION CONTEXT. getMarketingWorkspaceSnapshot() (../marketing) served the
// owner surface with strategy + work products and knew nothing about
// MarketingCampaign rows; get_marketing_summary independently reconstructed a
// different partial truth (storefront inbox + CRM pipeline) and returned no
// campaign identities at all — which is why the Marketing Strategist repeatedly
// called get_campaign_plan with empty arguments and failed.
//
// This module composes the workspace snapshot rather than replacing it, and
// layers on the execution/measurement/readiness view both surfaces need. Pure
// builders are exported separately from the single DB assembler so the decision
// logic is unit-testable without a database.
//
// Scope note: the recurring operating CYCLE (the blocked/wait/prepare/
// approval-needed/measure/iterate reducer and its scheduler) is a separate
// deliverable and is deliberately NOT built here — this module gives that
// reducer the state it will read. Evidence SUFFICIENCY for declaring a
// winner/loser is likewise separate; `attributionConfidence` and `stale` state
// what the data can honestly support, not whether a decision may be made.

import { prisma } from "@dpf/db";

import { getMarketingWorkspaceSnapshot, type MarketingWorkspaceSnapshot } from "../marketing";
import { resolveMarketingArchetypeContext, type MarketingArchetype } from "./archetype-context";
import {
  summarizeCampaignExecution,
  type CampaignExecutionRollup,
} from "./campaigns";
import { loadPublicationMetricsForTasks, type PublicationMetricRow } from "./campaign-performance";
import type { ChannelCapability } from "./channels/contracts";
import { listAdapters } from "./channels/registry";

// ─── Channel readiness ──────────────────────────────────────────────────────

/**
 * The operations a marketing channel adapter can contractually be asked for.
 * An adapter that does not register one of these must advertise it as
 * unsupported rather than failing silently at call time (AGENTS.md §2).
 * `draft-preview` is excluded — it is a local capability every adapter has.
 */
export const MARKETING_CHANNEL_CONTRACT_OPERATIONS = [
  "publish-post",
  "send-email",
  "place-ad",
  "fetch-engagement",
  "receive-inbound",
] as const satisfies ReadonlyArray<ChannelCapability>;

export type MarketingChannelReadiness = {
  channelId: string;
  displayName: string;
  credentialIntegrationId: string;
  connected: boolean;
  capabilities: ChannelCapability[];
  /** Contractual operations this adapter does not implement. */
  unsupported: ChannelCapability[];
  /** One recovery line when the channel cannot be used yet; null when ready. */
  blocker: string | null;
};

type AdapterLike = {
  channelId: string;
  displayName: string;
  credentialIntegrationId: string;
  capabilities: ReadonlyArray<ChannelCapability>;
};

/** Pure: project registered adapters + connected credentials into readiness rows. */
export function buildChannelReadiness(input: {
  adapters: ReadonlyArray<AdapterLike>;
  connectedIntegrationIds: ReadonlyArray<string>;
}): MarketingChannelReadiness[] {
  const connected = new Set(input.connectedIntegrationIds);
  return input.adapters.map((adapter) => {
    const capabilities = [...adapter.capabilities];
    const declared = new Set<string>(capabilities);
    const unsupported = MARKETING_CHANNEL_CONTRACT_OPERATIONS.filter((op) => !declared.has(op));
    const isConnected =
      connected.has(adapter.credentialIntegrationId) || connected.has(adapter.channelId);
    return {
      channelId: adapter.channelId,
      displayName: adapter.displayName,
      credentialIntegrationId: adapter.credentialIntegrationId,
      connected: isConnected,
      capabilities,
      unsupported: [...unsupported],
      blocker: isConnected
        ? null
        : `Connect ${adapter.displayName} before anything can be published on this channel.`,
    };
  });
}

// ─── Campaign measurement ───────────────────────────────────────────────────

export type CampaignMeasurementSummary = {
  publications: number;
  impressions: number;
  clicks: number;
  conversions: number;
  spendCents: number;
  lastPublishedAt: Date | null;
  lastMetricsPolledAt: Date | null;
  /**
   * How far the numbers can honestly be trusted:
   *   none     — nothing measured yet
   *   reported — the channel reported engagement, but nothing ties a conversion
   *              back to this campaign
   *   linked   — tracked links carry the campaign through to the destination
   */
  attributionConfidence: "none" | "reported" | "linked";
};

/** Pure: roll measured publication rows up to one campaign-level summary. */
export function summarizeCampaignMeasurement(input: {
  rows: ReadonlyArray<PublicationMetricRow>;
  trackedLinkCount: number;
}): CampaignMeasurementSummary {
  const nonNegative = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);
  let impressions = 0;
  let clicks = 0;
  let conversions = 0;
  let spendCents = 0;
  let lastPublishedAt: Date | null = null;
  let lastMetricsPolledAt: Date | null = null;

  for (const row of input.rows) {
    impressions += nonNegative(row.impressions);
    clicks += nonNegative(row.clicks);
    conversions += nonNegative(row.conversions);
    spendCents += nonNegative(row.costInUsdCents);
    if (row.publishedAt && (!lastPublishedAt || row.publishedAt > lastPublishedAt)) {
      lastPublishedAt = row.publishedAt;
    }
    if (row.metricsPolledAt && (!lastMetricsPolledAt || row.metricsPolledAt > lastMetricsPolledAt)) {
      lastMetricsPolledAt = row.metricsPolledAt;
    }
  }

  const publications = input.rows.length;
  const attributionConfidence: CampaignMeasurementSummary["attributionConfidence"] =
    publications === 0 ? "none" : input.trackedLinkCount > 0 ? "linked" : "reported";

  return {
    publications,
    impressions,
    clicks,
    conversions,
    spendCents,
    lastPublishedAt,
    lastMetricsPolledAt,
    attributionConfidence,
  };
}

// ─── Evidence freshness ─────────────────────────────────────────────────────

/**
 * Default window after which a channel metrics pull is considered stale.
 * This is a DATA-FRESHNESS default, not a marketing decision rule: how much
 * evidence is enough to call a winner is objective- and channel-specific and is
 * decided elsewhere. Callers may override it per channel/objective.
 */
export const DEFAULT_METRICS_WINDOW_HOURS = 24;

export type MarketingEvidenceFreshness = {
  lastPublishedAt: Date | null;
  lastMetricsPolledAt: Date | null;
  lastKpiCheckpointAt: Date | null;
  lastStrategyReviewAt: Date | null;
  stale: boolean;
  staleReasons: string[];
};

/** Pure: decide whether measured evidence can be trusted right now. */
export function assessEvidenceFreshness(input: {
  now: Date;
  publications: number;
  lastPublishedAt: Date | null;
  lastMetricsPolledAt: Date | null;
  lastKpiCheckpointAt: Date | null;
  lastStrategyReviewAt: Date | null;
  metricsWindowHours?: number;
}): MarketingEvidenceFreshness {
  const windowHours = input.metricsWindowHours ?? DEFAULT_METRICS_WINDOW_HOURS;
  const staleReasons: string[] = [];

  if (input.publications > 0) {
    if (!input.lastMetricsPolledAt) {
      staleReasons.push(
        `${input.publications} publication${input.publications === 1 ? "" : "s"} but channel KPIs were never pulled — run refresh_channel_kpis.`,
      );
    } else {
      const ageHours = (input.now.getTime() - input.lastMetricsPolledAt.getTime()) / 3_600_000;
      if (ageHours > windowHours) {
        staleReasons.push(
          `Channel KPIs were last pulled ${Math.round(ageHours)}h ago, past the ${windowHours}h freshness window.`,
        );
      }
    }
  }

  return {
    lastPublishedAt: input.lastPublishedAt,
    lastMetricsPolledAt: input.lastMetricsPolledAt,
    lastKpiCheckpointAt: input.lastKpiCheckpointAt,
    lastStrategyReviewAt: input.lastStrategyReviewAt,
    stale: staleReasons.length > 0,
    staleReasons,
  };
}

// ─── Campaign identity ──────────────────────────────────────────────────────

export type MarketingCampaignIdentity = {
  campaignId: string;
  name: string;
  objective: string;
  status: string;
  channels: string[];
  startDate: Date | null;
  endDate: Date | null;
  execution: CampaignExecutionRollup;
  measurement: CampaignMeasurementSummary;
};

// ─── Blockers ───────────────────────────────────────────────────────────────

export type MarketingBlocker = {
  id:
    | "no-connected-channel"
    | "channel-unsupported"
    | "no-strategy-review"
    | "no-campaign"
    | "awaiting-approval"
    | "stale-evidence";
  /** `blocked` cannot progress without the recovery; `waiting` is a healthy pause. */
  severity: "blocked" | "waiting";
  summary: string;
  /** Exactly one recovery action. */
  recovery: string;
  campaignId: string | null;
};

type DecisionInput = {
  channels: MarketingChannelReadiness[];
  hasStrategyReview: boolean;
  strategyStale: boolean;
  campaigns: MarketingCampaignIdentity[];
  pendingDraftCount: number;
  approvedDraftCount: number;
  evidence: MarketingEvidenceFreshness;
};

function hasConnectedChannel(channels: MarketingChannelReadiness[]): boolean {
  return channels.some((channel) => channel.connected);
}

function totalPublications(campaigns: MarketingCampaignIdentity[]): number {
  return campaigns.reduce((acc, c) => acc + c.measurement.publications, 0);
}

/** Pure: every state that stops or pauses the loop, each with one recovery action. */
export function resolveMarketingBlockers(input: DecisionInput): MarketingBlocker[] {
  const blockers: MarketingBlocker[] = [];
  const connected = hasConnectedChannel(input.channels);

  // Only a blocker once there is something that would actually go out.
  if (!connected && (input.approvedDraftCount > 0 || input.campaigns.length > 0)) {
    const first = input.channels[0];
    blockers.push({
      id: "no-connected-channel",
      severity: "blocked",
      summary: "No marketing channel is connected, so approved work cannot be published.",
      recovery: first
        ? `Connect ${first.displayName} at /platform/tools/integrations/${first.credentialIntegrationId}.`
        : "Connect a marketing channel integration before publishing.",
      campaignId: null,
    });
  }

  if (!input.hasStrategyReview || input.strategyStale) {
    blockers.push({
      id: "no-strategy-review",
      severity: "waiting",
      summary: input.hasStrategyReview
        ? "The saved marketing strategy is past its review cadence."
        : "No marketing strategy review has been recorded yet.",
      recovery: "Ask the Marketing Strategist for a strategy review so campaigns target a decided goal.",
      campaignId: null,
    });
  }

  if (input.campaigns.length === 0) {
    blockers.push({
      id: "no-campaign",
      severity: "waiting",
      summary: "No marketing campaign exists, so there is nothing to execute or measure.",
      recovery: "Establish one bounded campaign with create_marketing_campaign.",
      campaignId: null,
    });
  }

  if (input.pendingDraftCount > 0) {
    blockers.push({
      id: "awaiting-approval",
      severity: "waiting",
      summary: `${input.pendingDraftCount} draft${input.pendingDraftCount === 1 ? "" : "s"} are waiting on the owner's approval.`,
      recovery: "Review the approval queue — nothing publishes until it is approved.",
      campaignId: null,
    });
  }

  if (input.evidence.stale) {
    blockers.push({
      id: "stale-evidence",
      severity: "blocked",
      summary: input.evidence.staleReasons[0] ?? "Measured evidence is stale.",
      recovery: "Run refresh_channel_kpis to pull current channel metrics before deciding anything.",
      campaignId: null,
    });
  }

  for (const channel of input.channels) {
    if (channel.connected && channel.unsupported.includes("fetch-engagement")) {
      blockers.push({
        id: "channel-unsupported",
        severity: "waiting",
        summary: `${channel.displayName} cannot report engagement metrics, so its results stay unmeasured.`,
        recovery: `Attribute ${channel.displayName} results with tracked links (build_tracked_links) instead of channel metrics.`,
        campaignId: null,
      });
    }
  }

  return blockers;
}

// ─── One next executable step ───────────────────────────────────────────────

export const MARKETING_NEXT_STEP_IDS = [
  "review-drafts",
  "publish-approved",
  "connect-channel",
  "run-strategy-review",
  "establish-campaign",
  "produce-assets",
  "measure-evidence",
  "decide-outcome",
] as const;

export type MarketingNextStepId = (typeof MARKETING_NEXT_STEP_IDS)[number];

export type MarketingNextStep = {
  id: MarketingNextStepId;
  headline: string;
  detail: string;
  /** The campaign the step applies to, when it is campaign-specific. */
  campaignId: string | null;
  href: string;
};

const MARKETING_ROOT = "/customer/marketing";

/**
 * Pure: the single most useful next executable step.
 *
 * Priority is owner-first: work waiting on a human decision outranks anything
 * the platform could do on its own, so the owner is never asked to plan while
 * their approval queue is full. Everything below that is ordered by what
 * unblocks the loop soonest.
 */
export function resolveMarketingNextStep(input: DecisionInput): MarketingNextStep {
  const connected = hasConnectedChannel(input.channels);

  if (input.pendingDraftCount > 0) {
    const n = input.pendingDraftCount;
    return {
      id: "review-drafts",
      headline: `Review ${n} draft${n === 1 ? "" : "s"} waiting on you`,
      detail: "Copy is ready for your approval. Nothing goes out until you approve it.",
      campaignId: null,
      href: `${MARKETING_ROOT}#marketing-approval-queue`,
    };
  }

  if (input.approvedDraftCount > 0) {
    const n = input.approvedDraftCount;
    if (!connected) {
      return {
        id: "connect-channel",
        headline: `Connect a channel to publish ${n} approved post${n === 1 ? "" : "s"}`,
        detail: "Approved copy is ready but no channel is connected to send it on.",
        campaignId: null,
        href: `${MARKETING_ROOT}/automation`,
      };
    }
    return {
      id: "publish-approved",
      headline: `Publish ${n} approved post${n === 1 ? "" : "s"}`,
      detail: "Each publish is one explicit action — you stay in control of what goes live.",
      campaignId: null,
      href: `${MARKETING_ROOT}#marketing-publish-queue`,
    };
  }

  if (!input.hasStrategyReview || input.strategyStale) {
    return {
      id: "run-strategy-review",
      headline: "Decide what to grow first",
      detail: "Run a strategy review so the next campaign targets a decided goal.",
      campaignId: null,
      href: `${MARKETING_ROOT}/strategy`,
    };
  }

  if (input.campaigns.length === 0) {
    return {
      id: "establish-campaign",
      headline: "Turn the plan into one bounded campaign",
      detail: "There is a strategy but no campaign yet — establish one so work can be tracked and measured.",
      campaignId: null,
      href: `${MARKETING_ROOT}/campaigns`,
    };
  }

  const unfinished = input.campaigns.find((c) => c.execution.undraftedCount > 0);
  if (unfinished) {
    const n = unfinished.execution.undraftedCount;
    return {
      id: "produce-assets",
      headline: `Draft ${n} asset${n === 1 ? "" : "s"} for "${unfinished.name}"`,
      detail: unfinished.execution.nextStep,
      campaignId: unfinished.campaignId,
      href: `${MARKETING_ROOT}/campaigns`,
    };
  }

  const measured = input.campaigns.find((c) => c.measurement.publications > 0);
  if (measured) {
    if (input.evidence.stale) {
      return {
        id: "measure-evidence",
        headline: `Pull current results for "${measured.name}"`,
        detail: input.evidence.staleReasons[0] ?? "Published work has no fresh measurement yet.",
        campaignId: measured.campaignId,
        href: `${MARKETING_ROOT}/funnel`,
      };
    }
    return {
      id: "decide-outcome",
      headline: `Decide what to do with "${measured.name}"`,
      detail:
        `${measured.measurement.clicks} clicks and ${measured.measurement.conversions} conversions are measured` +
        ` (${measured.measurement.attributionConfidence} attribution) — continue, stop, or iterate.`,
      campaignId: measured.campaignId,
      href: `${MARKETING_ROOT}/funnel`,
    };
  }

  if (!connected) {
    const first = input.channels[0];
    return {
      id: "connect-channel",
      headline: `Connect ${first ? first.displayName : "a marketing channel"} to start publishing`,
      detail: "The campaign is prepared but has no connected channel to reach anyone on.",
      campaignId: input.campaigns[0]?.campaignId ?? null,
      href: `${MARKETING_ROOT}/automation`,
    };
  }

  const first = input.campaigns[0]!;
  return {
    id: "produce-assets",
    headline: `Keep "${first.name}" moving`,
    detail: first.execution.nextStep,
    campaignId: first.campaignId,
    href: `${MARKETING_ROOT}/campaigns`,
  };
}

// ─── The snapshot ───────────────────────────────────────────────────────────

export type MarketingOperatingSnapshot = {
  organizationId: string;
  organizationName: string;
  archetype: MarketingArchetype | null;
  strategy: {
    strategyId: string;
    status: string;
    primaryChannels: string[];
    lastReviewedAt: Date | null;
    nextReviewAt: Date | null;
    hasReview: boolean;
    stale: boolean;
    staleAreas: string[];
  };
  campaigns: MarketingCampaignIdentity[];
  workProducts: {
    campaignBriefs: number;
    assetTasks: number;
    kpiCheckpoints: number;
    automationCandidates: number;
  };
  approvals: {
    pendingDrafts: number;
    approvedDrafts: number;
    scheduledActionsPending: number;
    scheduledActionsFailed: number;
  };
  channels: MarketingChannelReadiness[];
  evidence: MarketingEvidenceFreshness;
  blockers: MarketingBlocker[];
  nextStep: MarketingNextStep;
};

/**
 * The MCP-facing projection. Deliberately narrower than the full snapshot: the
 * coworker needs identities, state, and one next step — not every field the
 * owner page renders. Both surfaces derive from the same snapshot, so what a
 * tool reports and what the page shows cannot drift apart.
 */
export function projectOperatingSnapshotForTools(
  snapshot: MarketingOperatingSnapshot,
): Record<string, unknown> {
  return {
    organizationId: snapshot.organizationId,
    archetype: snapshot.archetype,
    strategy: {
      strategyId: snapshot.strategy.strategyId,
      status: snapshot.strategy.status,
      primaryChannels: snapshot.strategy.primaryChannels,
      hasReview: snapshot.strategy.hasReview,
      stale: snapshot.strategy.stale,
      staleAreas: snapshot.strategy.staleAreas,
      nextReviewAt: snapshot.strategy.nextReviewAt,
    },
    campaigns: snapshot.campaigns.map((campaign) => ({
      campaignId: campaign.campaignId,
      name: campaign.name,
      objective: campaign.objective,
      status: campaign.status,
      channels: campaign.channels,
      briefCount: campaign.execution.briefCount,
      taskCount: campaign.execution.taskCount,
      undraftedCount: campaign.execution.undraftedCount,
      awaitingApprovalCount: campaign.execution.draftedCount,
      approvedCount: campaign.execution.approvedCount,
      nextStep: campaign.execution.nextStep,
      measurement: campaign.measurement,
    })),
    workProducts: snapshot.workProducts,
    approvals: snapshot.approvals,
    channels: snapshot.channels,
    evidence: snapshot.evidence,
    blockers: snapshot.blockers,
    nextStep: snapshot.nextStep,
  };
}

/** The campaign shape the assembler selects. Declared locally so the projection
 *  stays typed without importing Prisma's generated row types. */
type CampaignRow = {
  campaignId: string;
  name: string;
  objective: string;
  status: string;
  channels: string[];
  startDate: Date | null;
  endDate: Date | null;
  briefs: Array<{ briefId: string; status: string }>;
  assetTasks: Array<{ taskId: string; status: string }>;
};

/**
 * Assemble the operating snapshot for the configured organization.
 * Returns null when the install has no organization workspace yet.
 */
export async function getMarketingOperatingSnapshot(options?: {
  /**
   * An already-loaded workspace snapshot. Callers should pass it when available
   * so both projections use the same point in time and avoid duplicate reads.
   */
  workspace?: MarketingWorkspaceSnapshot | null;
  now?: Date;
  metricsWindowHours?: number;
}): Promise<MarketingOperatingSnapshot | null> {
  const workspace =
    options && "workspace" in options ? options.workspace : await getMarketingWorkspaceSnapshot();
  if (!workspace) return null;

  const organizationId = workspace.organization.id;
  const now = options?.now ?? new Date();

  const [archetypeContext, campaignRows, scheduledActions, latestCheckpoint] = await Promise.all([
    resolveMarketingArchetypeContext(),
    prisma.marketingCampaign.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        campaignId: true,
        name: true,
        objective: true,
        status: true,
        channels: true,
        startDate: true,
        endDate: true,
        briefs: { select: { briefId: true, status: true } },
        assetTasks: { select: { taskId: true, status: true } },
      },
    }),
    prisma.scheduledOutboundAction.groupBy({
      by: ["status"],
      where: { organizationId },
      _count: true,
    }),
    prisma.marketingKpiCheckpoint.findFirst({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  // One batched walk over every campaign's tasks → drafts → publications,
  // shared with getCampaignPerformance so the two cannot disagree.
  const rows_ = campaignRows as CampaignRow[];
  const allTaskIds = rows_.flatMap((c) => c.assetTasks.map((t) => t.taskId));
  const metrics = await loadPublicationMetricsForTasks(allTaskIds);

  const campaigns: MarketingCampaignIdentity[] = rows_.map((row) => {
    const taskIds = row.assetTasks.map((t) => t.taskId);
    const rows: PublicationMetricRow[] = [];
    let trackedLinkCount = 0;
    for (const taskId of taskIds) {
      const forTask = metrics.byTask.get(taskId);
      if (!forTask) continue;
      rows.push(...forTask);
      trackedLinkCount += forTask.filter((r) => r.trackedLink).length;
    }
    return {
      campaignId: row.campaignId,
      name: row.name,
      objective: row.objective,
      status: row.status,
      channels: row.channels,
      startDate: row.startDate,
      endDate: row.endDate,
      execution: summarizeCampaignExecution({
        briefs: row.briefs,
        tasks: row.assetTasks,
        draftedTaskIds: metrics.draftedTaskIds,
        approvedTaskIds: metrics.approvedTaskIds,
      }),
      measurement: summarizeCampaignMeasurement({ rows, trackedLinkCount }),
    };
  });

  const channels = buildChannelReadiness({
    adapters: listAdapters(),
    connectedIntegrationIds: workspace.connectedChannels,
  });

  const evidence = assessEvidenceFreshness({
    now,
    publications: totalPublications(campaigns),
    lastPublishedAt: metrics.lastPublishedAt,
    lastMetricsPolledAt: metrics.lastPolledAt,
    lastKpiCheckpointAt: latestCheckpoint?.createdAt ?? null,
    lastStrategyReviewAt: workspace.latestReview?.createdAt ?? null,
    metricsWindowHours: options?.metricsWindowHours,
  });

  const strategyStale = workspace.staleAreas.some((area) => area.toLowerCase().includes("review"));
  const decisionInput: DecisionInput = {
    channels,
    hasStrategyReview: Boolean(workspace.latestReview),
    strategyStale,
    campaigns,
    pendingDraftCount: workspace.pendingDrafts.length,
    approvedDraftCount: workspace.approvedDrafts.length,
    evidence,
  };

  const scheduledByStatus = new Map<string, number>(
    (scheduledActions as Array<{ status: string; _count: number }>).map(
      (row) => [row.status, row._count] as const,
    ),
  );

  return {
    organizationId,
    organizationName: workspace.organization.name,
    archetype: archetypeContext?.archetype ?? null,
    strategy: {
      strategyId: workspace.strategy.strategyId,
      status: workspace.strategy.status,
      primaryChannels: workspace.strategy.primaryChannels,
      lastReviewedAt: workspace.strategy.lastReviewedAt,
      nextReviewAt: workspace.strategy.nextReviewAt,
      hasReview: Boolean(workspace.latestReview),
      stale: strategyStale,
      staleAreas: workspace.staleAreas,
    },
    campaigns,
    workProducts: {
      campaignBriefs: workspace.workProducts.campaignBriefs.length,
      assetTasks: workspace.workProducts.assetTasks.length,
      kpiCheckpoints: workspace.workProducts.kpiCheckpoints.length,
      automationCandidates: workspace.workProducts.automationCandidates.length,
    },
    approvals: {
      pendingDrafts: workspace.pendingDrafts.length,
      approvedDrafts: workspace.approvedDrafts.length,
      scheduledActionsPending: scheduledByStatus.get("pending") ?? 0,
      scheduledActionsFailed: scheduledByStatus.get("failed") ?? 0,
    },
    channels,
    evidence,
    blockers: resolveMarketingBlockers(decisionInput),
    nextStep: resolveMarketingNextStep(decisionInput),
  };
}
