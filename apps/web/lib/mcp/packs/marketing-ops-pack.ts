// Marketing-ops / autopilot tool pack — EP-8DC217EB BET-4.
//
// Drains the self-contained marketing-operations domain out of the
// mcp-tools.ts executeTool switch: the 16 tools the Marketing Strategist and
// autopilot runtime use to read archetype-aware marketing context, persist
// strategist reviews / campaign briefs / asset tasks / KPI checkpoints, draft
// and publish outbound assets across connected channels (LinkedIn, email,
// LinkedIn Ads), and run the scheduler / autopilot policy loop. Each handler
// reproduces the former switch case verbatim, so behaviour is identical when the
// tool is invoked over MCP.
//
// This pack is distinct from marketing-pack.ts (campaign-aggregate tools);
// the two own disjoint tool sets. Definitions moved verbatim out of the inline
// PLATFORM_TOOLS array; grants mirror agent-grants.ts TOOL_TO_GRANTS, which
// stays the gating source.

import { prisma } from "@dpf/db";
import {
  MARKETING_CHANNELS,
  MARKETING_REVIEW_CADENCE,
  createMarketingAssetTask,
  createMarketingAutomationCandidate,
  createMarketingCampaignBrief,
  recordMarketingKpiCheckpoint,
  recordMarketingStrategistReview,
} from "@/lib/marketing";
import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import { planUpcomingMarketingDraftsHandler } from "../marketing-cadence-handler";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "get_marketing_summary",
    description:
      "Start here for the whole marketing picture: campaigns with ids, next step, channel readiness, evidence freshness, blockers, inbox, pipeline, playbook.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Number of days to look back (default 30)" },
      },
      required: [],
    },
    requiredCapability: "view_marketing",
    sideEffect: false,
  },
  {
    name: "suggest_campaign_ideas",
    description: "Get structured context for generating archetype-specific marketing campaign ideas, including business type, season, playbook, and top storefront items",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    requiredCapability: "view_marketing",
    sideEffect: false,
  },
  {
    name: "save_marketing_review",
    description: "Persist the Marketing Strategist's recommendation as the current marketing review and update the canonical MarketingStrategy. Use this after giving a concrete strategy, cadence, channel, KPI, or campaign recommendation so the page shows what was decided and what changed.",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Plain-language recommendation summary shown on the marketing page" },
        primaryChannels: { type: "array", items: { type: "string", enum: [...MARKETING_CHANNELS] }, description: "Recommended primary channels" },
        secondaryChannels: { type: "array", items: { type: "string", enum: [...MARKETING_CHANNELS] }, description: "Optional secondary channels" },
        skippedChannels: { type: "array", items: { type: "string", enum: [...MARKETING_CHANNELS] }, description: "Channels intentionally skipped for now" },
        kpis: { type: "array", items: { type: "string" }, description: "Small KPI stack used to judge channel fit" },
        cadence: { type: "string", enum: [...MARKETING_REVIEW_CADENCE], description: "Review cadence for this plan" },
        suggestedActions: { type: "array", items: { type: "string" }, description: "Action checklist items to display under the strategist review" },
      },
      required: ["summary"],
    },
    requiredCapability: "operate_marketing",
    sideEffect: true,
    coworkerArtifact: true,
  },
  {
    name: "create_marketing_campaign_brief",
    description: "Create a durable campaign brief from the Marketing Strategist's active plan. Use this after a user confirms a campaign direction or says ok/continue after a concrete campaign recommendation.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short campaign name" },
        objective: { type: "string", description: "Specific marketing objective" },
        audience: { type: "string", description: "Target audience or buyer segment" },
        channels: { type: "array", items: { type: "string", enum: [...MARKETING_CHANNELS] }, description: "Channels used in the campaign" },
        cta: { type: "string", description: "Primary call to action" },
        proofAssets: { type: "array", items: { type: "string" }, description: "Proof assets needed to support the campaign" },
        kpis: { type: "array", items: { type: "string" }, description: "Metrics used to judge the campaign" },
        notes: { type: "string", description: "Execution notes or exclusions" },
      },
      required: ["title", "objective"],
    },
    requiredCapability: "operate_marketing",
    sideEffect: true,
    coworkerArtifact: true,
  },
  {
    name: "create_marketing_asset_task",
    description: "Create a durable proof/content asset task from the Marketing Strategist's plan, such as an FAQ, testimonial, case study, landing page, LinkedIn post, or email draft.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title" },
        assetType: { type: "string", description: "Asset type, for example FAQ, testimonial, case-study, LinkedIn post, SEO page, email" },
        channel: { type: "string", enum: [...MARKETING_CHANNELS], description: "Primary channel for this asset" },
        dueWindow: { type: "string", description: "Plain-language timing, for example week 1 or next 14 days" },
        brief: { type: "string", description: "Short instructions for the asset" },
      },
      required: ["title", "assetType"],
    },
    requiredCapability: "operate_marketing",
    sideEffect: true,
    coworkerArtifact: true,
  },
  {
    name: "publish_to_linkedin",
    description: "Publish an APPROVED marketing OutboundDraft (channelId=linkedin or linkedin-personal-social) to the operator's connected LinkedIn personal feed. Requires the LinkedIn integration to be connected via /platform/tools/integrations/linkedin-personal-social. Fails fast if the draft is not status=approved or no LinkedIn credential is connected. On success, writes an OutboundPublication row and flips the draft to status=published.",
    inputSchema: {
      type: "object",
      properties: {
        draftId: { type: "string", description: "OutboundDraft.draftId in status='approved' on a LinkedIn channel" },
      },
      required: ["draftId"],
    },
    requiredCapability: "operate_marketing",
    sideEffect: true,
    consequence: "outward",
  },
  {
    name: "send_marketing_email",
    description: "Send an APPROVED marketing OutboundDraft (channelId=email or email-postmark, assetType=email) through the operator's connected Postmark server. Requires the Email (Postmark) integration to be connected via /platform/tools/integrations/email-postmark. Fails fast if the draft is not status=approved, the Postmark credential is not connected, or the From address is unverified. On success, writes an OutboundPublication row and flips the draft to status=published.",
    inputSchema: {
      type: "object",
      properties: {
        draftId: { type: "string", description: "OutboundDraft.draftId in status='approved' on an email channel" },
      },
      required: ["draftId"],
    },
    requiredCapability: "operate_marketing",
    sideEffect: true,
    consequence: "outward",
  },
  {
    name: "place_linkedin_ad",
    description: "Place a LinkedIn Ads campaign from an APPROVED OutboundDraft (channelId=linkedin-ads, assetType=ad-creative). Requires the LinkedIn integration connected with the ads scope (r_ads, rw_ads). Refuses if the placement would exceed the per-channel weekly spend ceiling — operators must set a ceiling on /customer/marketing before any ad spend. AGENTS MUST NOT CALL THIS WITHOUT EXPLICIT USER CONFIRMATION naming the spend amount, audience, and ad account.",
    inputSchema: {
      type: "object",
      properties: {
        draftId: { type: "string", description: "OutboundDraft.draftId in status='approved' on the linkedin-ads channel" },
      },
      required: ["draftId"],
    },
    requiredCapability: "operate_marketing",
    sideEffect: true,
    consequence: "outward",
  },
  {
    name: "refresh_channel_kpis",
    description: "Pull recent engagement metrics from a channel adapter (currently linkedin-ads) for OutboundPublication rows still inside their 30-day analytics window, write a per-publication snapshot, and aggregate channel-level impressions/clicks/cost/conversions into a fresh MarketingKpiCheckpoint row so the next strategist review sees real numbers.",
    inputSchema: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "Channel id, e.g. linkedin-ads" },
        sinceDaysAgo: { type: "number", description: "Optional override for the analytics window (default 30)" },
      },
      required: ["channelId"],
    },
    requiredCapability: "operate_marketing",
    sideEffect: true,
  },
  {
    name: "tick_marketing_scheduler",
    description: "Dispatch all ScheduledOutboundAction rows whose scheduledFor <= now. Fires each via the right service (draftMarketingAsset / publishApprovedDraft / pullChannelKpis) and reports fired vs failed counts. Idempotent and safe to call as often as the scheduler cadence requires.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    requiredCapability: "operate_marketing",
    sideEffect: true,
    consequence: "outward",
  },
  {
    name: "plan_upcoming_marketing_drafts",
    description: "Walk recent MarketingAssetTask rows for the organization and schedule a draft-marketing-asset action 3 days ahead of each task's due window (idempotent — skips tasks that already have a pending or fired schedule).",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    requiredCapability: "operate_marketing",
    sideEffect: true,
  },
  {
    name: "set_marketing_autopilot_policy",
    description: "Operator-only. Upsert a bounded per-channel autopilot policy. Channel must be in the autopilot allowlist (linkedin-personal-social, linkedin, email-postmark, email); ad channels are hard-refused by design. The runtime enforces channel allowlist + word-count threshold + weekly publish ceiling + low-confidence-marker check on every auto-approval.",
    inputSchema: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "Channel id; must be on the autopilot allowlist" },
        enabled: { type: "boolean", description: "Whether the policy is active right now" },
        autoApproveBelowWords: { type: "number", description: "Auto-approve only drafts shorter than this word count (null = no length gate)" },
        autoPublishAfterMinutes: { type: "number", description: "Minutes a draft must age before autopilot fires (null = no aging gate)" },
        weeklyCeiling: { type: "number", description: "Maximum publishes per rolling 7-day window for this channel" },
      },
      required: ["channelId", "enabled", "weeklyCeiling"],
    },
    requiredCapability: "manage_provider_connections",
    sideEffect: true,
    // changes identity or authority → consult-gated (TAK §8.4.1).
    consequence: "authority",
  },
  {
    name: "draft_marketing_asset",
    description: "Turn a saved MarketingAssetTask brief into a channel-shaped, human-reviewable draft. Creates an OutboundDraft with status='pending-review' that appears in the marketing approval queue on /customer/marketing. Currently LinkedIn posts and emails only. No external API call — the draft is internal until a human approves and a publish tool fires.",
    inputSchema: {
      type: "object",
      properties: {
        assetTaskId: { type: "string", description: "MarketingAssetTask.taskId to draft from" },
        channelOverride: { type: "string", enum: [...MARKETING_CHANNELS], description: "Override the asset task's channel if drafting a variant" },
        toneNotes: { type: "string", description: "Optional one-line guidance the drafter should respect (e.g. 'first person, technical, no emojis')" },
      },
      required: ["assetTaskId"],
    },
    requiredCapability: "operate_marketing",
    sideEffect: true,
    coworkerArtifact: true,
  },
  {
    name: "record_marketing_kpi_checkpoint",
    description: "Record a KPI checkpoint or target for the active marketing plan so the workspace can show what will be measured.",
    inputSchema: {
      type: "object",
      properties: {
        metric: { type: "string", description: "Metric name" },
        target: { type: "string", description: "Target value or baseline" },
        cadence: { type: "string", enum: [...MARKETING_REVIEW_CADENCE], description: "Review cadence" },
        notes: { type: "string", description: "Measurement notes" },
      },
      required: ["metric"],
    },
    requiredCapability: "operate_marketing",
    sideEffect: true,
    coworkerArtifact: true,
  },
  {
    name: "create_marketing_automation_candidate",
    description: "Create an internal automation candidate for a marketing workflow. This does not publish, send, or schedule anything; external actions still require approval.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Automation candidate name" },
        trigger: { type: "string", description: "Event or condition that starts the automation" },
        action: { type: "string", description: "Internal action to prepare or propose" },
        approvalRequired: { type: "boolean", description: "Whether explicit human approval is required before execution" },
        rationale: { type: "string", description: "Why this automation would reduce work or improve outcomes" },
      },
      required: ["title", "trigger", "action"],
    },
    requiredCapability: "operate_marketing",
    sideEffect: true,
    coworkerArtifact: true,
  },
  {
    name: "analyze_seo_opportunity",
    description: "Get structured business context for SEO content recommendations: archetype, services/products, location, existing content sections, and suggested local search intents",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    requiredCapability: "view_marketing",
    sideEffect: false,
  },
];

async function getMarketingSummaryHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { resolveMarketingArchetypeContext, MARKETING_NO_STOREFRONT_MESSAGE } = await import(
    "@/lib/marketing/archetype-context"
  );
  const days = typeof params["days"] === "number" ? params["days"] : 30;

  const context = await resolveMarketingArchetypeContext();
  if (!context) {
    return { success: true, message: MARKETING_NO_STOREFRONT_MESSAGE };
  }
  const { archetype, playbook, storefrontId } = context;

  // The operating snapshot is the canonical decision context — campaign
  // identities, channel readiness, evidence freshness, blockers, and one next
  // executable step. Without it this summary reported inbox counts and no way
  // to name a campaign, which is what drove empty get_campaign_plan calls.
  const { getMarketingOperatingSnapshot, projectOperatingSnapshotForTools } = await import(
    "@/lib/marketing/operating-snapshot"
  );
  const { loadAcquisitionSignals } = await import("@/lib/marketing/acquisition-signals");

  const [operating, signals] = await Promise.all([
    getMarketingOperatingSnapshot(),
    loadAcquisitionSignals({ storefrontId, days }),
  ]);

  const projection = operating ? projectOperatingSnapshotForTools(operating) : null;
  const nextStep = projection?.["nextStep"] as { headline?: string } | undefined;
  return {
    success: true,
    message: nextStep?.headline
      ? `Marketing summary for ${archetype.name} (${archetype.ctaType}) — next: ${nextStep.headline}`
      : `Marketing summary for ${archetype.name} (${archetype.ctaType})`,
    data: {
      archetype: { id: archetype.archetypeId, name: archetype.name, category: archetype.category, ctaType: archetype.ctaType },
      playbook,
      inbox: signals.inbox,
      pipeline: signals.pipeline,
      // Campaign identities and the one next step come from the canonical
      // snapshot; an install with no workspace yet reports empty, never absent.
      campaigns: projection?.["campaigns"] ?? [],
      channels: projection?.["channels"] ?? [],
      evidence: projection?.["evidence"] ?? null,
      blockers: projection?.["blockers"] ?? [],
      nextStep: projection?.["nextStep"] ?? null,
      strategy: projection?.["strategy"] ?? null,
      approvals: projection?.["approvals"] ?? null,
    },
  };
}

async function suggestCampaignIdeasHandler(): Promise<ToolResult> {
  const { resolveMarketingArchetypeContext, MARKETING_NO_STOREFRONT_MESSAGE } = await import(
    "@/lib/marketing/archetype-context"
  );

  const context = await resolveMarketingArchetypeContext({ includeItems: true, itemLimit: 10 });
  if (!context) {
    return { success: true, message: MARKETING_NO_STOREFRONT_MESSAGE };
  }
  const config = { id: context.storefrontId, archetype: context.archetype };
  const playbook = context.playbook;

  // Current season for seasonal relevance
  const month = new Date().getMonth();
  const season = month <= 1 || month === 11 ? "winter" : month <= 4 ? "spring" : month <= 7 ? "summer" : "autumn";

  // Top storefront items by name for campaign targeting
  const items = await prisma.storefrontItem.findMany({
    where: { storefrontId: config.id, isActive: true },
    select: { name: true, priceType: true, ctaType: true },
    orderBy: { sortOrder: "asc" },
    take: 10,
  });

  return {
    success: true,
    message: `Campaign context for ${config.archetype.name}`,
    data: {
      archetype: { name: config.archetype.name, category: config.archetype.category, ctaType: config.archetype.ctaType },
      playbook,
      season,
      currentMonth: new Date().toLocaleString("en-GB", { month: "long", year: "numeric" }),
      activeItems: items.map((i) => ({ name: i.name, priceType: i.priceType, ctaType: i.ctaType })),
    },
  };
}

async function saveMarketingReviewHandler(
  params: Record<string, unknown>,
  _userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const result = await recordMarketingStrategistReview({
    recommendation: {
      summary: String(params["summary"] ?? ""),
      primaryChannels: Array.isArray(params["primaryChannels"])
        ? params["primaryChannels"].filter((value): value is string => typeof value === "string")
        : [],
      secondaryChannels: Array.isArray(params["secondaryChannels"])
        ? params["secondaryChannels"].filter((value): value is string => typeof value === "string")
        : [],
      skippedChannels: Array.isArray(params["skippedChannels"])
        ? params["skippedChannels"].filter((value): value is string => typeof value === "string")
        : [],
      kpis: Array.isArray(params["kpis"])
        ? params["kpis"].filter((value): value is string => typeof value === "string")
        : [],
      cadence: typeof params["cadence"] === "string" ? params["cadence"] : undefined,
      suggestedActions: Array.isArray(params["suggestedActions"])
        ? params["suggestedActions"].filter((value): value is string => typeof value === "string")
        : [],
    },
    createdByAgentId: context?.agentId ?? null,
  });

  if (!result) {
    return {
      success: false,
      message: "No organization workspace is configured, so the marketing review could not be saved.",
      error: "No organization workspace is configured",
    };
  }

  return {
    success: true,
    entityId: result.reviewId,
    message: `${result.message}. The marketing page now has a saved strategist review and updated channel/cadence context.`,
    data: result,
  };
}

async function createMarketingCampaignBriefHandler(
  params: Record<string, unknown>,
  _userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const result = await createMarketingCampaignBrief({
    brief: {
      title: String(params["title"] ?? ""),
      objective: String(params["objective"] ?? ""),
      audience: typeof params["audience"] === "string" ? params["audience"] : undefined,
      channels: Array.isArray(params["channels"])
        ? params["channels"].filter((value): value is string => typeof value === "string")
        : [],
      cta: typeof params["cta"] === "string" ? params["cta"] : undefined,
      proofAssets: Array.isArray(params["proofAssets"])
        ? params["proofAssets"].filter((value): value is string => typeof value === "string")
        : [],
      kpis: Array.isArray(params["kpis"])
        ? params["kpis"].filter((value): value is string => typeof value === "string")
        : [],
      notes: typeof params["notes"] === "string" ? params["notes"] : undefined,
    },
    createdByAgentId: context?.agentId ?? null,
  });

  if (!result) {
    return {
      success: false,
      message: "No organization workspace is configured, so the campaign brief could not be saved.",
      error: "No organization workspace is configured",
    };
  }

  return {
    success: true,
    entityId: result.briefId,
    message: `${result.message}. The marketing workspace now has a saved campaign brief.`,
    data: result,
  };
}

async function createMarketingAssetTaskHandler(
  params: Record<string, unknown>,
  _userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const result = await createMarketingAssetTask({
    task: {
      title: String(params["title"] ?? ""),
      assetType: String(params["assetType"] ?? ""),
      channel: typeof params["channel"] === "string" ? params["channel"] : undefined,
      dueWindow: typeof params["dueWindow"] === "string" ? params["dueWindow"] : undefined,
      brief: typeof params["brief"] === "string" ? params["brief"] : undefined,
    },
    createdByAgentId: context?.agentId ?? null,
  });

  if (!result) {
    return {
      success: false,
      message: "No organization workspace is configured, so the marketing asset task could not be saved.",
      error: "No organization workspace is configured",
    };
  }

  return {
    success: true,
    entityId: result.taskId,
    message: `${result.message}. The marketing workspace now has a saved proof/content task.`,
    data: result,
  };
}

// publish_to_linkedin, send_marketing_email, place_linkedin_ad share ONE handler
// (fall-through in the former switch): all three publish an approved OutboundDraft
// through the channel-aware publish service.
async function publishApprovedDraftHandler(
  params: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  const { publishApprovedDraft } = await import("@/lib/marketing/publish");
  const result = await publishApprovedDraft({
    draftId: String(params["draftId"] ?? ""),
    publishedByUserId: userId,
  });
  if (!result.ok) {
    return {
      success: false,
      message: result.message,
      error: result.error,
    };
  }
  return {
    success: true,
    entityId: result.publicationId,
    message: result.message,
    data: result,
  };
}

async function refreshChannelKpisHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { pullChannelKpis } = await import("@/lib/marketing/kpi-pullback");
  const result = await pullChannelKpis({
    channelId: String(params["channelId"] ?? ""),
    sinceDaysAgo: typeof params["sinceDaysAgo"] === "number" ? (params["sinceDaysAgo"] as number) : undefined,
  });
  if (!result.ok && result.snapshotsWritten === 0) {
    return {
      success: false,
      message: `KPI pullback returned no snapshots. Failures: ${result.failures.map((f) => f.error).join("; ")}`,
      error: "kpi_pullback_failed",
    };
  }
  return {
    success: true,
    message: `Pulled ${result.snapshotsWritten} ${params["channelId"]} snapshot${result.snapshotsWritten === 1 ? "" : "s"}; wrote ${result.checkpointsWritten} MarketingKpiCheckpoint row${result.checkpointsWritten === 1 ? "" : "s"}.`,
    data: result,
  };
}

async function tickMarketingSchedulerHandler(): Promise<ToolResult> {
  const { tickScheduler } = await import("@/lib/marketing/scheduler");
  const result = await tickScheduler({});
  return {
    success: true,
    message: `Scheduler tick: scanned ${result.pendingScanned}, fired ${result.fired}, failed ${result.failed}.`,
    data: result,
  };
}

async function setMarketingAutopilotPolicyHandler(
  params: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  const { setAutopilotPolicy } = await import("@/lib/marketing/autopilot");
  const { prisma } = await import("@dpf/db");
  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) {
    return { success: false, message: "No organization configured.", error: "no_org" };
  }
  const result = await setAutopilotPolicy({
    organizationId: org.id,
    channelId: String(params["channelId"] ?? ""),
    enabled: params["enabled"] === true,
    autoApproveBelowWords:
      typeof params["autoApproveBelowWords"] === "number" ? (params["autoApproveBelowWords"] as number) : null,
    autoPublishAfterMinutes:
      typeof params["autoPublishAfterMinutes"] === "number" ? (params["autoPublishAfterMinutes"] as number) : null,
    weeklyCeiling: typeof params["weeklyCeiling"] === "number" ? (params["weeklyCeiling"] as number) : 0,
    userId,
  });
  if (!result.ok) {
    return { success: false, message: result.error, error: "policy_invalid" };
  }
  return {
    success: true,
    entityId: result.policyId,
    message: `Autopilot policy ${result.policyId} ${params["enabled"] === true ? "enabled" : "saved disabled"}.`,
    data: result,
  };
}

async function draftMarketingAssetHandler(
  params: Record<string, unknown>,
  _userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const { draftMarketingAsset } = await import("@/lib/marketing/draft-builder");
  const result = await draftMarketingAsset({
    assetTaskId: String(params["assetTaskId"] ?? ""),
    channelOverride: typeof params["channelOverride"] === "string" ? params["channelOverride"] : undefined,
    toneNotes: typeof params["toneNotes"] === "string" ? params["toneNotes"] : undefined,
    createdByAgentId: context?.agentId ?? null,
  });

  if (!result.success) {
    return {
      success: false,
      message: result.message,
      error: result.error,
    };
  }

  return {
    success: true,
    entityId: result.draftId,
    message: result.message,
    data: result,
  };
}

async function recordMarketingKpiCheckpointHandler(
  params: Record<string, unknown>,
  _userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const result = await recordMarketingKpiCheckpoint({
    checkpoint: {
      metric: String(params["metric"] ?? ""),
      target: typeof params["target"] === "string" ? params["target"] : undefined,
      cadence: typeof params["cadence"] === "string" ? params["cadence"] : undefined,
      notes: typeof params["notes"] === "string" ? params["notes"] : undefined,
    },
    createdByAgentId: context?.agentId ?? null,
  });

  if (!result) {
    return {
      success: false,
      message: "No organization workspace is configured, so the KPI checkpoint could not be saved.",
      error: "No organization workspace is configured",
    };
  }

  return {
    success: true,
    entityId: result.checkpointId,
    message: `${result.message}. The marketing workspace now has a saved KPI checkpoint.`,
    data: result,
  };
}

async function createMarketingAutomationCandidateHandler(
  params: Record<string, unknown>,
  _userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const result = await createMarketingAutomationCandidate({
    candidate: {
      title: String(params["title"] ?? ""),
      trigger: String(params["trigger"] ?? ""),
      action: String(params["action"] ?? ""),
      approvalRequired: typeof params["approvalRequired"] === "boolean"
        ? params["approvalRequired"]
        : true,
      rationale: typeof params["rationale"] === "string" ? params["rationale"] : undefined,
    },
    createdByAgentId: context?.agentId ?? null,
  });

  if (!result) {
    return {
      success: false,
      message: "No organization workspace is configured, so the automation candidate could not be saved.",
      error: "No organization workspace is configured",
    };
  }

  return {
    success: true,
    entityId: result.candidateId,
    message: `${result.message}. The marketing workspace now has a saved automation candidate awaiting review.`,
    data: result,
  };
}

async function analyzeSeoOpportunityHandler(): Promise<ToolResult> {
  const { resolveMarketingArchetypeContext, MARKETING_NO_STOREFRONT_MESSAGE } = await import(
    "@/lib/marketing/archetype-context"
  );

  const context = await resolveMarketingArchetypeContext({
    includeItems: true,
    includeSections: true,
    itemLimit: 20,
  });
  if (!context) {
    return { success: true, message: MARKETING_NO_STOREFRONT_MESSAGE };
  }

  const config = {
    id: context.storefrontId,
    archetype: context.archetype,
    items: context.items,
    sections: context.sections,
  };
  const playbook = context.playbook;

  // Get organization location if available
  const org = await prisma.organization.findFirst({
    select: { address: true, name: true },
  });
  const address = org?.address as Record<string, string> | null;
  const location = address?.city
    ? `${address.city}${address.region ? `, ${address.region}` : ""}${address.country ? `, ${address.country}` : ""}`
    : null;

  // Build suggested search intents from services + location
  const serviceNames = config.items.map((i) => i.name);
  const locationSuffix = location ? ` ${address?.city}` : " near me";
  const suggestedSearchIntents = serviceNames.slice(0, 5).map((name) => `${name.toLowerCase()}${locationSuffix}`);

  // Add generic archetype-based intents
  if (config.archetype.category === "healthcare-wellness") {
    suggestedSearchIntents.push(`${config.archetype.name.toLowerCase()} accepting patients${locationSuffix}`);
  } else if (config.archetype.category === "trades-maintenance") {
    suggestedSearchIntents.push(`emergency ${config.archetype.name.toLowerCase()}${locationSuffix}`);
  } else if (config.archetype.category === "food-hospitality") {
    suggestedSearchIntents.push(`best ${config.archetype.name.toLowerCase()}${locationSuffix}`);
  }

  return {
    success: true,
    message: `SEO context for ${config.archetype.name}`,
    data: {
      businessType: config.archetype.name,
      archetype: {
        category: config.archetype.category,
        name: config.archetype.name,
      },
      location,
      services: serviceNames,
      existingContent: config.sections.map((s) => s.title || s.type),
      playbook: {
        primaryGoal: playbook.primaryGoal,
        campaignTypes: playbook.campaignTypes,
      },
      suggestedSearchIntents,
    },
  };
}

const handlers: Record<string, ToolPackHandler> = {
  get_marketing_summary: (params) => getMarketingSummaryHandler(params),
  suggest_campaign_ideas: () => suggestCampaignIdeasHandler(),
  save_marketing_review: (params, userId, context) => saveMarketingReviewHandler(params, userId, context),
  create_marketing_campaign_brief: (params, userId, context) => createMarketingCampaignBriefHandler(params, userId, context),
  create_marketing_asset_task: (params, userId, context) => createMarketingAssetTaskHandler(params, userId, context),
  publish_to_linkedin: (params, userId) => publishApprovedDraftHandler(params, userId),
  send_marketing_email: (params, userId) => publishApprovedDraftHandler(params, userId),
  place_linkedin_ad: (params, userId) => publishApprovedDraftHandler(params, userId),
  refresh_channel_kpis: (params) => refreshChannelKpisHandler(params),
  tick_marketing_scheduler: () => tickMarketingSchedulerHandler(),
  plan_upcoming_marketing_drafts: (params, userId, context) =>
    planUpcomingMarketingDraftsHandler(params, userId, context),
  set_marketing_autopilot_policy: (params, userId) => setMarketingAutopilotPolicyHandler(params, userId),
  draft_marketing_asset: (params, userId, context) => draftMarketingAssetHandler(params, userId, context),
  record_marketing_kpi_checkpoint: (params, userId, context) => recordMarketingKpiCheckpointHandler(params, userId, context),
  create_marketing_automation_candidate: (params, userId, context) => createMarketingAutomationCandidateHandler(params, userId, context),
  analyze_seo_opportunity: () => analyzeSeoOpportunityHandler(),
};

export const marketingOpsPack: ToolPack = {
  packId: "marketing-ops",
  definitions,
  handlers,
  grants: {
    get_marketing_summary: ["marketing_read"],
    suggest_campaign_ideas: ["marketing_read"],
    save_marketing_review: ["marketing_write"],
    create_marketing_campaign_brief: ["marketing_write"],
    create_marketing_asset_task: ["marketing_write"],
    publish_to_linkedin: ["marketing_write"],
    send_marketing_email: ["marketing_write"],
    place_linkedin_ad: ["marketing_write"],
    refresh_channel_kpis: ["marketing_write"],
    tick_marketing_scheduler: ["marketing_write"],
    plan_upcoming_marketing_drafts: ["marketing_write"],
    set_marketing_autopilot_policy: ["marketing_write"],
    draft_marketing_asset: ["marketing_write"],
    record_marketing_kpi_checkpoint: ["marketing_write"],
    create_marketing_automation_candidate: ["marketing_write"],
    analyze_seo_opportunity: ["marketing_read"],
  },
};
