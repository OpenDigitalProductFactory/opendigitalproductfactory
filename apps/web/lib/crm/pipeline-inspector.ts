import type { CrmTone } from "./presentation";
import {
  formatCrmStatusLabel,
  getOpportunityStageMeta,
  getQuoteStatusMeta,
  isOpenOpportunityStage,
  OPEN_OPPORTUNITY_STAGES,
} from "./presentation";
import { formatRevenueAmount } from "./revenue-cockpit";
import { OPPORTUNITY_GRAMMAR } from "../lifecycle-grammars";

const DAY_MS = 24 * 60 * 60 * 1000;

// Per-stage exit criteria + stale thresholds are the canonical lifecycle grammar's now
// (BI-E55991E9): the opportunity grammar (lib/lifecycle-grammars.ts) is the single source, so
// the CRM and any future lifecycle board read the same definitions. Derived here into the same
// record shape this module has always used, preserving behaviour exactly (the default fallbacks
// below in getStageExitCriteria/isStageStale are unchanged).
const STAGE_STALE_THRESHOLDS_DAYS: Record<string, number> = Object.fromEntries(
  OPPORTUNITY_GRAMMAR.stages
    .filter((stage) => stage.staleAfterDays !== undefined)
    .map((stage) => [stage.key, stage.staleAfterDays as number]),
);

const STAGE_EXIT_CRITERIA: Record<string, string[]> = Object.fromEntries(
  OPPORTUNITY_GRAMMAR.stages
    .filter((stage) => stage.exitCriteria !== undefined)
    .map((stage) => [stage.key, [...(stage.exitCriteria as readonly string[])]]),
);

const CRM_ADVISOR_BOUNDARY =
  "Do not create CRM records, update stages, send, or schedule anything. Return review notes or draft copy for operator approval.";

export const PIPELINE_STAGE_UPDATE_OPTIONS = OPEN_OPPORTUNITY_STAGES.map((stage) => ({
  value: stage,
  label: getOpportunityStageMeta(stage).label,
}));

export type PipelineInspectorActivityInput = {
  id: string;
  type: string;
  subject: string;
  body?: string | null;
  createdAt: Date;
};

export type PipelineInspectorQuoteInput = {
  id: string;
  quoteNumber: string;
  status: string;
  totalAmount?: number | string | { toString(): string } | null;
  currency?: string | null;
  sentAt?: Date | null;
  acceptedAt?: Date | null;
};

export type PipelineInspectorEngagementInput = {
  id: string;
  title: string;
  status: string;
  source?: string | null;
  sourceRefId?: string | null;
} | null;

export type PipelineInspectorOpportunityInput = {
  id: string;
  opportunityId: string;
  title: string;
  stage: string;
  isDormant: boolean;
  probability: number;
  expectedValue?: number | string | { toString(): string } | null;
  currency?: string | null;
  expectedClose?: Date | null;
  stageChangedAt: Date;
  nextActivityAt?: Date | null;
  notes?: string | null;
  account: {
    id: string;
    name: string;
  };
  contact?: {
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  } | null;
  engagement?: PipelineInspectorEngagementInput;
  quotes: PipelineInspectorQuoteInput[];
  activities: PipelineInspectorActivityInput[];
};

export type PipelineInspectorTopic = {
  id: string;
  label: string;
  description: string;
  prompt: string;
  contextSummary: string;
  expectedNextStep: string;
};

export type PipelineInspectorView = {
  id: string;
  opportunityId: string;
  title: string;
  account: {
    id: string;
    name: string;
  };
  contactLabel: string | null;
  stage: string;
  stageLabel: string;
  stageTone: CrmTone;
  stageAgeDays: number;
  stageAgeLabel: string;
  isStale: boolean;
  staleLabel: string | null;
  nextActivityAt: string | null;
  probabilityLabel: string;
  expectedValueLabel: string | null;
  expectedCloseLabel: string | null;
  sourceEngagement: {
    id: string;
    label: string;
    detail: string;
  } | null;
  latestQuote: {
    id: string;
    quoteNumber: string;
    statusLabel: string;
    statusTone: CrmTone;
    totalLabel: string | null;
  } | null;
  recentActivities: {
    id: string;
    label: string;
    detail: string;
    body: string | null;
  }[];
  stageExitCriteria: string[];
  suggestedNextAction: string;
  aiTopics: PipelineInspectorTopic[];
};

export function getStageAgeDays(stageChangedAt: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - stageChangedAt.getTime()) / DAY_MS));
}

export function isStageStale(input: {
  stage: string;
  stageAgeDays: number;
  isDormant: boolean;
}): boolean {
  if (!isOpenOpportunityStage(input.stage)) {
    return false;
  }
  if (input.isDormant) {
    return true;
  }
  const threshold = STAGE_STALE_THRESHOLDS_DAYS[input.stage] ?? 14;
  return input.stageAgeDays >= threshold;
}

export function getStageExitCriteria(stage: string): string[] {
  return STAGE_EXIT_CRITERIA[stage] ?? [
    "Confirm the next buyer commitment",
    "Record the evidence needed to leave this stage",
  ];
}

function toNumber(value: number | string | { toString(): string } | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const numberValue = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(numberValue) ? numberValue : null;
}

function formatDateLabel(value: Date | null | undefined): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);
}

function formatStageAgeLabel(days: number): string {
  if (days === 0) return "New in stage";
  return `${days} day${days === 1 ? "" : "s"} in stage`;
}

function formatSourceLabel(source: string | null | undefined): string {
  if (!source) return "unknown source";
  return source.replace(/[_-]+/g, " ");
}

function buildContactLabel(contact: PipelineInspectorOpportunityInput["contact"]): string | null {
  if (!contact) return null;
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim();
  return name || contact.email || null;
}

function selectLatestQuote(quotes: PipelineInspectorQuoteInput[]): PipelineInspectorQuoteInput | null {
  return quotes[0] ?? null;
}

function buildSuggestedNextAction(input: {
  stage: string;
  isStale: boolean;
  latestQuote: PipelineInspectorQuoteInput | null;
  activityCount: number;
}): string {
  if (input.latestQuote?.status === "sent") {
    return "Follow up on the sent quote and confirm the next buyer commitment.";
  }
  if (input.stage === "proposal" && !input.latestQuote) {
    return "Prepare the proposal or quote evidence needed to leave this stage.";
  }
  if (input.stage === "negotiation") {
    return "Confirm the decision process, blockers, and signature step.";
  }
  if (input.activityCount === 0) {
    return "Log the first buyer activity and confirm the next commitment.";
  }
  if (input.isStale) {
    return "Review why this stage is stale and schedule the next buyer action.";
  }
  if (input.stage === "qualification") {
    return "Confirm the buyer problem, owner, and value hypothesis.";
  }
  if (input.stage === "discovery") {
    return "Capture needs, stakeholders, and success criteria from the buyer.";
  }
  return "Confirm the next buyer commitment and keep the timeline current.";
}

function buildAiTopics(input: {
  opportunityId: string;
  title: string;
  accountName: string;
  stageLabel: string;
  stageAgeLabel: string;
  suggestedNextAction: string;
  latestQuote: PipelineInspectorView["latestQuote"];
  isStale: boolean;
}): PipelineInspectorTopic[] {
  const quoteContext = input.latestQuote
    ? `Latest quote: ${input.latestQuote.quoteNumber} (${input.latestQuote.statusLabel}).`
    : "No quote is linked yet.";
  const baseContext =
    `${input.opportunityId} "${input.title}" for ${input.accountName} is in ${input.stageLabel}. ` +
    `${input.stageAgeLabel}. ${quoteContext}`;

  return [
    {
      id: "deal-summary",
      label: "Summarize deal",
      description: "Review account, activity, quote, and stage context.",
      prompt:
        `Summarize opportunity ${input.opportunityId}: ${input.title}. ` +
        `${baseContext} Highlight current stage evidence, blockers, and the next best internal action. ` +
        CRM_ADVISOR_BOUNDARY,
      contextSummary: baseContext,
      expectedNextStep:
        "Customer Advisor should return a concise stage-aware deal summary without taking external action.",
    },
    {
      id: "stale-stage-diagnosis",
      label: input.isStale ? "Explain stale stage" : "Check stage health",
      description: "Inspect stage age, missing evidence, and what must happen next.",
      prompt:
        `Diagnose stage health for opportunity ${input.opportunityId}. ` +
        `${baseContext} Suggested next action: ${input.suggestedNextAction}. ` +
        CRM_ADVISOR_BOUNDARY,
      contextSummary: `${input.stageLabel}; ${input.stageAgeLabel}; next action: ${input.suggestedNextAction}`,
      expectedNextStep:
        "Customer Advisor should explain the stage posture and propose a governed follow-up task if needed.",
    },
    {
      id: "follow-up-draft",
      label: "Draft follow-up",
      description: "Draft the next buyer-facing follow-up for review.",
      prompt:
        `Draft a buyer follow-up for opportunity ${input.opportunityId}. ` +
        `${baseContext} ${CRM_ADVISOR_BOUNDARY}`,
      contextSummary: baseContext,
      expectedNextStep:
        "Customer Advisor should produce draft copy only; the operator decides whether to send it.",
    },
  ];
}

export function buildPipelineInspectorView(input: {
  opportunity: PipelineInspectorOpportunityInput;
  now?: Date;
}): PipelineInspectorView {
  const now = input.now ?? new Date();
  const opportunity = input.opportunity;
  const stageMeta = getOpportunityStageMeta(opportunity.stage);
  const stageAgeDays = getStageAgeDays(opportunity.stageChangedAt, now);
  const stale = isStageStale({
    stage: opportunity.stage,
    stageAgeDays,
    isDormant: opportunity.isDormant,
  });
  const latestQuoteInput = selectLatestQuote(opportunity.quotes);
  const latestQuoteMeta = latestQuoteInput ? getQuoteStatusMeta(latestQuoteInput.status) : null;
  const latestQuoteTotal = toNumber(latestQuoteInput?.totalAmount);
  const latestQuote = latestQuoteInput && latestQuoteMeta
    ? {
        id: latestQuoteInput.id,
        quoteNumber: latestQuoteInput.quoteNumber,
        statusLabel: latestQuoteMeta.label,
        statusTone: latestQuoteMeta.tone,
        totalLabel: latestQuoteTotal !== null
          ? formatRevenueAmount(latestQuoteTotal, latestQuoteInput.currency ?? "GBP")
          : null,
      }
    : null;
  const expectedValue = toNumber(opportunity.expectedValue);
  const suggestedNextAction = buildSuggestedNextAction({
    stage: opportunity.stage,
    isStale: stale,
    latestQuote: latestQuoteInput,
    activityCount: opportunity.activities.length,
  });

  const view: PipelineInspectorView = {
    id: opportunity.id,
    opportunityId: opportunity.opportunityId,
    title: opportunity.title,
    account: opportunity.account,
    contactLabel: buildContactLabel(opportunity.contact),
    stage: opportunity.stage,
    stageLabel: stageMeta.label,
    stageTone: stageMeta.tone,
    stageAgeDays,
    stageAgeLabel: formatStageAgeLabel(stageAgeDays),
    nextActivityAt: opportunity.nextActivityAt ? opportunity.nextActivityAt.toISOString() : null,
    isStale: stale,
    staleLabel: stale ? "Stale stage" : null,
    probabilityLabel: `${opportunity.probability}%`,
    expectedValueLabel: expectedValue !== null
      ? formatRevenueAmount(expectedValue, opportunity.currency ?? "GBP")
      : null,
    expectedCloseLabel: formatDateLabel(opportunity.expectedClose),
    sourceEngagement: opportunity.engagement
      ? {
          id: opportunity.engagement.id,
          label: opportunity.engagement.title,
          detail:
            `${formatCrmStatusLabel(opportunity.engagement.status)} from ` +
            formatSourceLabel(opportunity.engagement.source),
        }
      : null,
    latestQuote,
    recentActivities: opportunity.activities.slice(0, 3).map((activity) => ({
      id: activity.id,
      label: activity.subject,
      detail: `${formatCrmStatusLabel(activity.type)} / ${formatDateLabel(activity.createdAt)}`,
      body: activity.body ?? null,
    })),
    stageExitCriteria: getStageExitCriteria(opportunity.stage),
    suggestedNextAction,
    aiTopics: [],
  };

  return {
    ...view,
    aiTopics: buildAiTopics({
      opportunityId: view.opportunityId,
      title: view.title,
      accountName: view.account.name,
      stageLabel: view.stageLabel,
      stageAgeLabel: view.stageAgeLabel,
      suggestedNextAction: view.suggestedNextAction,
      latestQuote: view.latestQuote,
      isStale: view.isStale,
    }),
  };
}
