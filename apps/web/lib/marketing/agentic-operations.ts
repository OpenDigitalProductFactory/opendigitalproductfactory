export type MarketingAgenticOperationContext = {
  marketFocus: string;
  audienceFocus: string;
  routeFocus: string;
  primaryChannels: string;
  recommendedChannels: string;
  skippedChannels: string;
  proofFocus: string;
  kpiStack: string;
  suggestions: string[];
};

export type MarketingAgenticOperationTopic = {
  id: string;
  label: string;
  description: string;
  prompt: string;
  contextSummary: string;
  expectedNextStep: string;
};

export const MARKETING_AGENTIC_OPERATIONS_ROUTE = "/customer/marketing";

export const EXTERNAL_MARKETING_SIDE_EFFECT_TOOLS = [
  "publish_to_linkedin",
  "send_marketing_email",
  "place_linkedin_ad",
  "tick_marketing_scheduler",
  "plan_upcoming_marketing_drafts",
  "set_marketing_autopilot_policy",
] as const;

const SIDE_EFFECT_BOUNDARY =
  "Do not publish, send, schedule, place ads, or change autopilot policy.";

function suggestionBrief(suggestions: string[]): string {
  return suggestions.length > 0
    ? suggestions.slice(0, 3).join(" ")
    : "No specific gaps are currently flagged.";
}

export function buildMarketingAgenticOperationTopics(
  context: MarketingAgenticOperationContext,
): MarketingAgenticOperationTopic[] {
  const strategyContext =
    `Market: ${context.marketFocus}. Buyer: ${context.audienceFocus}. ` +
    `Motion: ${context.routeFocus}.`;
  const channelContext =
    `Channels: ${context.primaryChannels}. Recommended: ${context.recommendedChannels}. ` +
    `Skipped: ${context.skippedChannels}.`;
  const proofContext =
    `Proof: ${context.proofFocus}. KPIs: ${context.kpiStack}.`;
  const gapContext = suggestionBrief(context.suggestions);

  return [
    {
      id: "signal-review",
      label: "Signal review",
      description:
        "Review acquisition signals, stale assumptions, and the next useful marketing decision.",
      prompt:
        "Review the current customer acquisition signals and marketing assumptions. " +
        `${strategyContext} ${channelContext} Current gaps: ${gapContext} ` +
        "If you name a concrete channel, cadence, audience, KPI, proof asset, or next step, " +
        "persist the recommendation with save_marketing_review and record KPI evidence with record_marketing_kpi_checkpoint when useful. " +
        `${SIDE_EFFECT_BOUNDARY}`,
      contextSummary: `${strategyContext} ${channelContext}`,
      expectedNextStep:
        "Marketing Strategist should save the internal recommendation and ask one focused follow-up question.",
    },
    {
      id: "campaign-brief",
      label: "Campaign brief",
      description:
        "Turn the current strategy into a campaign brief and the first asset task.",
      prompt:
        "Create the next internal campaign work product for this business. " +
        `${strategyContext} ${channelContext} ${proofContext} ` +
        "Use create_marketing_campaign_brief for the campaign plan, create_marketing_asset_task for the first concrete asset, " +
        "and draft_marketing_asset only after the asset task exists and the draft can stay in the approval queue. " +
        `${SIDE_EFFECT_BOUNDARY}`,
      contextSummary: `${context.audienceFocus}; ${context.primaryChannels}; ${context.proofFocus}`,
      expectedNextStep:
        "Marketing Strategist should create a reviewable campaign brief and first asset task.",
    },
    {
      id: "automation-candidates",
      label: "Automation candidates",
      description:
        "Identify repeated follow-up or campaign work that could become a governed proposal.",
      prompt:
        "Look for repeated marketing or sales-support actions that could become internal automation candidates. " +
        `${strategyContext} ${channelContext} Current gaps: ${gapContext} ` +
        "Create proposal-only candidates with create_marketing_automation_candidate, including trigger, action, rationale, and why employee approval is required. " +
        `${SIDE_EFFECT_BOUNDARY}`,
      contextSummary: `${channelContext} ${gapContext}`,
      expectedNextStep:
        "Marketing Strategist should save proposal-only candidates with employee approval posture.",
    },
    {
      id: "integration-recommendations",
      label: "Integration fit",
      description:
        "Recommend which connected or candidate integration should feed marketing evidence next.",
      prompt:
        "Recommend the next integration or signal source that should strengthen this customer acquisition system. " +
        `${strategyContext} ${channelContext} ${proofContext} ` +
        "Use get_marketing_summary, suggest_campaign_ideas, or analyze_seo_opportunity for read-only evidence where useful. " +
        "If the recommendation is concrete, save it with save_marketing_review instead of leaving it only in chat. " +
        `${SIDE_EFFECT_BOUNDARY}`,
      contextSummary: `${strategyContext} ${proofContext}`,
      expectedNextStep:
        "Marketing Strategist should save the internal recommendation and name the evidence gap it addresses.",
    },
  ];
}
