// Marketing campaign performance — cross-channel rollup.
//
// pullChannelKpis (kpi-pullback.ts) fetches raw engagement per publication and
// aggregates it PER CHANNEL into a text-note checkpoint. What the Marketing
// Strategist actually needs to reason about a running campaign is the
// CAMPAIGN-level picture: every channel's numbers rolled together, the derived
// efficiency metrics (CTR / CPC / CPA / conversion rate), spend paced against
// the campaign budget, and attainment against the campaign's KPI targets.
//
// summarizeCampaignPerformance is a PURE function (no DB) so the rollup math is
// unit-testable in isolation, mirroring summarizeCampaignExecution. getCampaign
// Performance walks the campaign → asset tasks → drafts → publications →
// lastMetricsSnapshot path and feeds the pure function.

import { prisma } from "@dpf/db";

/** One publication's measured engagement, tagged with its channel. Shape mirrors
 *  the adapter engagement snapshot written to OutboundPublication.lastMetricsSnapshot. */
export type PublicationMetricRow = {
  channel: string;
  impressions: number;
  clicks: number;
  costInUsdCents: number;
  conversions: number;
};

export type ChannelPerformance = {
  channel: string;
  publications: number;
  impressions: number;
  clicks: number;
  spendCents: number;
  conversions: number;
  /** clicks / impressions, 0..1 (0 when no impressions). */
  ctr: number;
  /** cost per click, cents (0 when no clicks). */
  cpcCents: number;
  /** cost per acquisition, cents (0 when no conversions). */
  cpaCents: number;
  /** conversions / clicks, 0..1 (0 when no clicks). */
  conversionRate: number;
};

export type CampaignTargetAttainment = {
  metric: string;
  target: number;
  actual: number;
  /** actual / target, 0..1+ (capped display is the caller's concern). */
  attainment: number;
};

export type CampaignPerformanceRollup = {
  publications: number;
  channelsActive: number;
  totals: Omit<ChannelPerformance, "channel">;
  byChannel: ChannelPerformance[];
  budget: {
    budgetTotalCents: number | null;
    spentCents: number;
    /** spentCents / budgetTotalCents, 0..1+ (null when no budget set). */
    utilization: number | null;
    remainingCents: number | null;
  };
  targets: CampaignTargetAttainment[];
  /** Plain-language one-liner for the coworker to lead with. */
  headline: string;
};

function safeDiv(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/** The campaign KPI-target metric names this rollup can score against actuals. */
const TARGETABLE_METRICS = new Set(["impressions", "clicks", "conversions", "spendCents"]);

function parseKpiTargets(kpiTargets: unknown): Record<string, number> {
  if (!kpiTargets || typeof kpiTargets !== "object" || Array.isArray(kpiTargets)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(kpiTargets as Record<string, unknown>)) {
    if (typeof value === "number" && Number.isFinite(value) && TARGETABLE_METRICS.has(key)) {
      out[key] = value;
    }
  }
  return out;
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Pure: roll per-publication metrics up to a campaign-level performance view.
 * No DB access — unit-testable.
 */
export function summarizeCampaignPerformance(input: {
  rows: PublicationMetricRow[];
  budgetTotalCents?: number | null;
  kpiTargets?: unknown;
}): CampaignPerformanceRollup {
  const byChannelMap = new Map<string, ChannelPerformance>();

  for (const row of input.rows) {
    const channel = row.channel || "unknown";
    const existing = byChannelMap.get(channel) ?? {
      channel,
      publications: 0,
      impressions: 0,
      clicks: 0,
      spendCents: 0,
      conversions: 0,
      ctr: 0,
      cpcCents: 0,
      cpaCents: 0,
      conversionRate: 0,
    };
    existing.publications += 1;
    existing.impressions += row.impressions || 0;
    existing.clicks += row.clicks || 0;
    existing.spendCents += row.costInUsdCents || 0;
    existing.conversions += row.conversions || 0;
    byChannelMap.set(channel, existing);
  }

  const byChannel = Array.from(byChannelMap.values()).map((c) => ({
    ...c,
    ctr: safeDiv(c.clicks, c.impressions),
    cpcCents: c.clicks > 0 ? Math.round(safeDiv(c.spendCents, c.clicks)) : 0,
    cpaCents: c.conversions > 0 ? Math.round(safeDiv(c.spendCents, c.conversions)) : 0,
    conversionRate: safeDiv(c.conversions, c.clicks),
  }));
  // Stable, useful ordering: biggest spend first.
  byChannel.sort((a, b) => b.spendCents - a.spendCents);

  const sum = (pick: (c: ChannelPerformance) => number) => byChannel.reduce((acc, c) => acc + pick(c), 0);
  const impressions = sum((c) => c.impressions);
  const clicks = sum((c) => c.clicks);
  const spendCents = sum((c) => c.spendCents);
  const conversions = sum((c) => c.conversions);
  const publications = sum((c) => c.publications);

  const totals: Omit<ChannelPerformance, "channel"> = {
    publications,
    impressions,
    clicks,
    spendCents,
    conversions,
    ctr: safeDiv(clicks, impressions),
    cpcCents: clicks > 0 ? Math.round(safeDiv(spendCents, clicks)) : 0,
    cpaCents: conversions > 0 ? Math.round(safeDiv(spendCents, conversions)) : 0,
    conversionRate: safeDiv(conversions, clicks),
  };

  const budgetTotalCents =
    typeof input.budgetTotalCents === "number" && Number.isFinite(input.budgetTotalCents)
      ? input.budgetTotalCents
      : null;
  const budget = {
    budgetTotalCents,
    spentCents: spendCents,
    utilization: budgetTotalCents && budgetTotalCents > 0 ? spendCents / budgetTotalCents : null,
    remainingCents: budgetTotalCents !== null ? budgetTotalCents - spendCents : null,
  };

  const targetMap = parseKpiTargets(input.kpiTargets);
  const actualByMetric: Record<string, number> = { impressions, clicks, conversions, spendCents };
  const targets: CampaignTargetAttainment[] = Object.entries(targetMap).map(([metric, target]) => {
    const actual = actualByMetric[metric] ?? 0;
    return { metric, target, actual, attainment: target > 0 ? actual / target : 0 };
  });

  const headlineParts = [
    `${byChannel.length} channel${byChannel.length === 1 ? "" : "s"}`,
    `${publications} publication${publications === 1 ? "" : "s"}`,
  ];
  const budgetClause = budget.utilization !== null
    ? `, ${formatUsd(spendCents)} spent (${Math.round(budget.utilization * 100)}% of budget)`
    : `, ${formatUsd(spendCents)} spent`;
  const headline = publications === 0
    ? "No measured publications yet — publish approved drafts and pull channel KPIs to populate performance."
    : `${headlineParts.join(", ")}: ${impressions.toLocaleString("en-US")} impressions, `
      + `${clicks.toLocaleString("en-US")} clicks (${(totals.ctr * 100).toFixed(1)}% CTR), `
      + `${conversions.toLocaleString("en-US")} conversions${budgetClause}.`;

  return {
    publications,
    channelsActive: byChannel.length,
    totals,
    byChannel,
    budget,
    targets,
    headline,
  };
}

/** Coerce a lastMetricsSnapshot JSON blob into a numeric metric row. Defensive:
 *  missing/non-numeric fields become 0 so a partially-populated snapshot still
 *  contributes what it has. */
export function metricRowFromSnapshot(channel: string, snapshot: unknown): PublicationMetricRow {
  const m = snapshot && typeof snapshot === "object" ? (snapshot as Record<string, unknown>) : {};
  // Clamp to >= 0: a corrupt/adversarial snapshot with a negative count would
  // otherwise flow into totals and produce a negative CTR/conversion rate in
  // the rollup and headline. Mirrors recordVariantResult's clamping.
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0);
  return {
    channel,
    impressions: num(m.impressions),
    clicks: num(m.clicks),
    costInUsdCents: num(m.costInUsdCents),
    conversions: num(m.conversions),
  };
}

/**
 * Read a campaign's measured cross-channel performance from the publications of
 * its asset tasks. Returns the rollup plus the campaign's headline identity.
 */
export async function getCampaignPerformance(
  campaignId: string,
): Promise<
  | { message: string; data: Record<string, unknown> }
  | { error: string; message: string }
> {
  const campaign = await prisma.marketingCampaign.findUnique({
    where: { campaignId },
    select: {
      campaignId: true,
      name: true,
      status: true,
      budgetTotalCents: true,
      kpiTargets: true,
      assetTasks: { select: { taskId: true } },
    },
  });
  if (!campaign) {
    return { error: "not-found", message: `Campaign ${campaignId} does not exist.` };
  }

  const taskIds = campaign.assetTasks.map((t: { taskId: string }) => t.taskId);
  const rows: PublicationMetricRow[] = [];
  if (taskIds.length > 0) {
    const drafts = await prisma.outboundDraft.findMany({
      where: { domain: "marketing", sourceType: "marketing-asset-task", sourceId: { in: taskIds } },
      select: { draftId: true },
    });
    const draftIds = drafts.map((d: { draftId: string }) => d.draftId);
    if (draftIds.length > 0) {
      const pubs = await prisma.outboundPublication.findMany({
        where: { draftId: { in: draftIds } },
        select: { channelId: true, lastMetricsSnapshot: true },
      });
      for (const pub of pubs) {
        rows.push(metricRowFromSnapshot(pub.channelId, pub.lastMetricsSnapshot));
      }
    }
  }

  const rollup = summarizeCampaignPerformance({
    rows,
    budgetTotalCents: campaign.budgetTotalCents,
    kpiTargets: campaign.kpiTargets,
  });

  return {
    message: `Campaign "${campaign.name}" — ${campaign.status}. ${rollup.headline}`,
    data: {
      campaign: {
        campaignId: campaign.campaignId,
        name: campaign.name,
        status: campaign.status,
      },
      performance: rollup,
    },
  };
}
