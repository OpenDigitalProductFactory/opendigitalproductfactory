// Marketing tool pack.
//
// First marketing-domain pack. Hosts the campaign-execution helpers that do not
// need the inline switch in mcp-tools.ts. build_tracked_links is a pure UTM
// link builder (no DB, no network) used by the Marketing Strategist when
// drafting CTAs so a campaign's clicks are attributable. New marketing tools
// should land here rather than as inline cases. Grants mirror agent-grants.ts
// TOOL_TO_GRANTS (the gating source); tool-registry.test asserts no drift.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "build_tracked_links",
    description:
      "Build UTM-tagged tracked links so a campaign's clicks are measurable in analytics and CRM source attribution. Pure helper (no publish): pass a campaign/source/medium and either a single baseUrl or a links array (one utm_content per asset/variant), get normalized utm_* URLs back. Use when drafting any CTA link so the funnel can attribute inquiries to the right campaign and channel.",
    inputSchema: {
      type: "object",
      properties: {
        baseUrl: { type: "string", description: "Single absolute http(s) destination URL to tag. Provide this OR links." },
        links: {
          type: "array",
          description: "Multiple destinations to tag with the same campaign/source/medium; each may carry its own utm_content.",
          items: {
            type: "object",
            properties: {
              url: { type: "string", description: "Absolute http(s) destination URL" },
              content: { type: "string", description: "Optional utm_content for this link, e.g. post_a / cta_footer" },
            },
            required: ["url"],
          },
        },
        source: { type: "string", description: "utm_source — referrer/platform, e.g. linkedin, newsletter" },
        medium: { type: "string", description: "utm_medium — marketing medium, e.g. social, email, cpc" },
        campaign: { type: "string", description: "utm_campaign — campaign name/identifier" },
        term: { type: "string", description: "Optional utm_term — paid keyword" },
        content: { type: "string", description: "Optional default utm_content applied to links that omit their own" },
      },
      required: ["source", "medium", "campaign"],
    },
    requiredCapability: "view_marketing",
    sideEffect: false,
  },
  {
    name: "create_marketing_campaign",
    description:
      "Establish a first-class marketing campaign: the executable plan that ties objective, audience, channels, budget, timeline, and KPI targets together and owns its briefs and asset tasks. Use this at the start of campaign work so execution status is tracked against one plan. Briefs/tasks attach to it via attach_to_campaign.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short campaign name" },
        objective: { type: "string", description: "Measurable objective" },
        audience: { type: "string", description: "Target audience / ICP" },
        channels: { type: "array", items: { type: "string" }, description: "Channels in the campaign" },
        budgetTotalCents: { type: "number", description: "Total budget in minor currency units (e.g. pence/cents)" },
        budgetByChannel: { type: "object", description: "Optional per-channel budget allocation, channel -> minor units", additionalProperties: { type: "number" } },
        startDate: { type: "string", description: "ISO start date" },
        endDate: { type: "string", description: "ISO end date" },
        kpiTargets: { type: "array", items: { type: "string" }, description: "KPI targets with direction, e.g. '20 inquiries in 30 days'" },
        primaryCta: { type: "string", description: "Primary call to action" },
        notes: { type: "string", description: "Execution notes" },
      },
      required: ["name", "objective"],
    },
    requiredCapability: "operate_marketing",
    sideEffect: true,
    coworkerArtifact: true,
  },
  {
    name: "update_marketing_campaign",
    description:
      "Update a marketing campaign's status (draft/active/paused/complete), budget, timeline, or notes. Use to activate a planned campaign, pause an underperforming one, or mark it complete.",
    inputSchema: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "MarketingCampaign.campaignId" },
        status: { type: "string", enum: ["draft", "active", "paused", "complete"], description: "New lifecycle status" },
        budgetTotalCents: { type: "number", description: "Revised total budget in minor units" },
        startDate: { type: "string", description: "ISO start date" },
        endDate: { type: "string", description: "ISO end date" },
        notes: { type: "string", description: "Execution notes" },
      },
      required: ["campaignId"],
    },
    requiredCapability: "operate_marketing",
    sideEffect: true,
    coworkerArtifact: true,
  },
  {
    name: "attach_to_campaign",
    description:
      "Attach an existing campaign brief and/or asset task to a campaign so it rolls up under one plan (replacing fuzzy title matching with a real link). Provide campaignId plus a briefId and/or taskId.",
    inputSchema: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "MarketingCampaign.campaignId" },
        briefId: { type: "string", description: "MarketingCampaignBrief.briefId to attach" },
        taskId: { type: "string", description: "MarketingAssetTask.taskId to attach" },
      },
      required: ["campaignId"],
    },
    requiredCapability: "operate_marketing",
    sideEffect: true,
    coworkerArtifact: true,
  },
  {
    name: "get_campaign_plan",
    description:
      "Read a campaign's full plan (objective, audience, channels, budget, timeline, KPI targets) plus a live execution rollup (brief/task/draft counts and the single most useful next step). Use to report status or decide what to do next on a campaign.",
    inputSchema: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "MarketingCampaign.campaignId" },
      },
      required: ["campaignId"],
    },
    requiredCapability: "view_marketing",
    sideEffect: false,
  },
  {
    name: "get_campaign_performance",
    description:
      "Read a campaign's measured cross-channel performance: per-channel and total impressions, clicks, spend, conversions, plus derived CTR / CPC / CPA / conversion rate, spend paced against budget, and attainment against the campaign's KPI targets. Use to report how a running campaign is actually performing and which channel is most efficient. Requires published assets whose channel KPIs have been pulled (refresh_channel_kpis).",
    inputSchema: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "MarketingCampaign.campaignId" },
      },
      required: ["campaignId"],
    },
    requiredCapability: "view_marketing",
    sideEffect: false,
  },
  {
    name: "get_content_calendar",
    description:
      "Read the editorial content calendar: campaign asset tasks projected onto week buckets by their due window, with per-channel and per-status counts, plus a list of tasks that have no schedulable due date. Optionally scope to one campaign. Use to answer 'what's our content calendar / what's due when', to spot empty weeks or channel gaps, and to sequence production before a pipeline hole opens. Read-only; complements the auto-scheduler (plan_upcoming_marketing_drafts).",
    inputSchema: {
      type: "object",
      properties: {
        campaignId: {
          type: "string",
          description: "Optional MarketingCampaign.campaignId to scope the calendar to one campaign; omit for the whole marketing workspace.",
        },
      },
      required: [],
    },
    requiredCapability: "view_marketing",
    sideEffect: false,
  },
];

async function buildTrackedLinksHandler(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const { buildTrackedLinks } = await import("@/lib/marketing/utm");
  const links = Array.isArray(params["links"])
    ? (params["links"] as Array<{ url: string; content?: string }>)
    : undefined;
  const result = buildTrackedLinks({
    baseUrl: typeof params["baseUrl"] === "string" ? params["baseUrl"] : undefined,
    links,
    source: typeof params["source"] === "string" ? params["source"] : "",
    medium: typeof params["medium"] === "string" ? params["medium"] : "",
    campaign: typeof params["campaign"] === "string" ? params["campaign"] : "",
    term: typeof params["term"] === "string" ? params["term"] : undefined,
    content: typeof params["content"] === "string" ? params["content"] : undefined,
  });
  if (!result.success) {
    return { success: false, error: result.error, message: result.message };
  }
  return { success: true, message: result.message, data: { links: result.links } };
}

async function createCampaignHandler(
  params: Record<string, unknown>,
  _userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const { createMarketingCampaign } = await import("@/lib/marketing/campaigns");
  const result = await createMarketingCampaign({
    name: String(params["name"] ?? ""),
    objective: String(params["objective"] ?? ""),
    audience: typeof params["audience"] === "string" ? params["audience"] : undefined,
    channels: Array.isArray(params["channels"]) ? (params["channels"] as string[]) : undefined,
    budgetTotalCents: typeof params["budgetTotalCents"] === "number" ? params["budgetTotalCents"] : undefined,
    budgetByChannel:
      params["budgetByChannel"] && typeof params["budgetByChannel"] === "object"
        ? (params["budgetByChannel"] as Record<string, number>)
        : undefined,
    startDate: typeof params["startDate"] === "string" ? params["startDate"] : undefined,
    endDate: typeof params["endDate"] === "string" ? params["endDate"] : undefined,
    kpiTargets: params["kpiTargets"],
    primaryCta: typeof params["primaryCta"] === "string" ? params["primaryCta"] : undefined,
    notes: typeof params["notes"] === "string" ? params["notes"] : undefined,
    createdByAgentId: context?.agentId ?? null,
  });
  if (!result) {
    return { success: false, error: "no-workspace", message: "No configured marketing workspace; cannot create a campaign." };
  }
  return { success: true, entityId: result.campaignId, message: result.message };
}

async function updateCampaignHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { updateMarketingCampaign } = await import("@/lib/marketing/campaigns");
  const result = await updateMarketingCampaign({
    campaignId: String(params["campaignId"] ?? ""),
    status: typeof params["status"] === "string" ? params["status"] : undefined,
    budgetTotalCents: typeof params["budgetTotalCents"] === "number" ? params["budgetTotalCents"] : undefined,
    startDate: typeof params["startDate"] === "string" ? params["startDate"] : undefined,
    endDate: typeof params["endDate"] === "string" ? params["endDate"] : undefined,
    notes: typeof params["notes"] === "string" ? params["notes"] : undefined,
  });
  if ("error" in result) {
    return { success: false, error: result.error, message: result.message };
  }
  return { success: true, entityId: result.campaignId, message: result.message };
}

async function attachToCampaignHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { attachToCampaign } = await import("@/lib/marketing/campaigns");
  const result = await attachToCampaign({
    campaignId: String(params["campaignId"] ?? ""),
    briefId: typeof params["briefId"] === "string" ? params["briefId"] : undefined,
    taskId: typeof params["taskId"] === "string" ? params["taskId"] : undefined,
  });
  if ("error" in result) {
    return { success: false, error: result.error, message: result.message };
  }
  return { success: true, message: result.message };
}

async function getCampaignPlanHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { getCampaignPlan } = await import("@/lib/marketing/campaigns");
  const result = await getCampaignPlan(String(params["campaignId"] ?? ""));
  if ("error" in result) {
    return { success: false, error: result.error, message: result.message };
  }
  return { success: true, message: result.message, data: result.data };
}

async function getCampaignPerformanceHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { getCampaignPerformance } = await import("@/lib/marketing/campaign-performance");
  const result = await getCampaignPerformance(String(params["campaignId"] ?? ""));
  if ("error" in result) {
    return { success: false, error: result.error, message: result.message };
  }
  return { success: true, message: result.message, data: result.data };
}

async function getContentCalendarHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { getContentCalendar } = await import("@/lib/marketing/content-calendar");
  const result = await getContentCalendar({
    campaignId: typeof params["campaignId"] === "string" ? params["campaignId"] : undefined,
  });
  if ("error" in result) {
    return { success: false, error: result.error, message: result.message };
  }
  return { success: true, message: result.message, data: result.data };
}

export const marketingPack: ToolPack = {
  packId: "marketing",
  definitions,
  handlers: {
    build_tracked_links: (params) => buildTrackedLinksHandler(params),
    create_marketing_campaign: (params, userId, context) => createCampaignHandler(params, userId, context),
    update_marketing_campaign: (params) => updateCampaignHandler(params),
    attach_to_campaign: (params) => attachToCampaignHandler(params),
    get_campaign_plan: (params) => getCampaignPlanHandler(params),
    get_campaign_performance: (params) => getCampaignPerformanceHandler(params),
    get_content_calendar: (params) => getContentCalendarHandler(params),
  },
  grants: {
    build_tracked_links: ["marketing_read"],
    create_marketing_campaign: ["marketing_write"],
    update_marketing_campaign: ["marketing_write"],
    attach_to_campaign: ["marketing_write"],
    get_campaign_plan: ["marketing_read"],
    get_campaign_performance: ["marketing_read"],
    get_content_calendar: ["marketing_read"],
  },
};
