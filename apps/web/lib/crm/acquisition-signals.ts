import { formatCrmStatusLabel, getEngagementStatusMeta, type CrmTone } from "./presentation";

export type AcquisitionSignalKind =
  | "storefront_inquiry"
  | "facebook_lead_ads"
  | "google_business_profile";

export type AcquisitionSignalSource =
  | "web_inquiry"
  | "facebook_lead_ads"
  | "google_business_profile"
  | string;

export type AcquisitionSignalRoutingState =
  | "route_ready"
  | "linked"
  | "needs_contact";

export type AcquisitionSignalTopic = {
  id: string;
  label: string;
  description: string;
  prompt: string;
  contextSummary: string;
  expectedNextStep: string;
};

export type AcquisitionSignalContactInput = {
  id: string;
  accountId: string;
  label: string;
  email?: string | null;
  accountLabel?: string | null;
};

export type AcquisitionSignalInput = {
  id: string;
  kind: AcquisitionSignalKind;
  source: AcquisitionSignalSource;
  sourceRefId: string;
  title: string;
  summary: string;
  buyerLabel: string;
  channelLabel: string;
  observedAt: Date;
  evidence: string[];
  contact?: AcquisitionSignalContactInput | null;
  accountLabel?: string | null;
  linkedEngagement?: {
    id: string;
    title: string;
    status: string;
  } | null;
  integrationHref?: string | null;
};

export type AcquisitionSignalRouteAction = {
  title: string;
  contactId: string;
  accountId: string;
  source: AcquisitionSignalSource;
  sourceRefId: string;
  notes: string;
};

export type AcquisitionSignalView = {
  id: string;
  kind: AcquisitionSignalKind;
  source: AcquisitionSignalSource;
  sourceRefId: string;
  title: string;
  summary: string;
  buyerLabel: string;
  channelLabel: string;
  observedAtLabel: string;
  routingState: AcquisitionSignalRoutingState;
  routingLabel: string;
  routingTone: CrmTone;
  evidence: string[];
  contactLabel: string | null;
  accountLabel: string | null;
  linkedEngagement: {
    id: string;
    title: string;
    statusLabel: string;
  } | null;
  routeAction: AcquisitionSignalRouteAction | null;
  integrationHref: string | null;
  aiTopics: AcquisitionSignalTopic[];
};

export type AcquisitionSignalWorkspace = {
  summary: {
    observedCount: number;
    routeReadyCount: number;
    linkedCount: number;
    needsContactCount: number;
  };
  signals: AcquisitionSignalView[];
};

const SOURCE_LABELS: Record<string, string> = {
  facebook_lead_ads: "Facebook Lead Ads",
  google_business_profile: "Google Business Profile",
  import: "Import",
  manual: "Manual",
  referral: "Referral",
  web_inquiry: "Storefront inquiry",
};

export function formatAcquisitionSourceLabel(source: string | null | undefined): string {
  if (!source) return "Unknown source";
  return SOURCE_LABELS[source] ?? formatCrmStatusLabel(source);
}

function formatDateLabel(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);
}

function buildNotes(input: AcquisitionSignalInput): string {
  return [
    `Source: ${formatAcquisitionSourceLabel(input.source)}`,
    `Source ref: ${input.sourceRefId}`,
    `Observed: ${formatDateLabel(input.observedAt)}`,
    ...input.evidence,
    input.summary,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildAiTopics(input: AcquisitionSignalInput): AcquisitionSignalTopic[] {
  const sourceLabel = formatAcquisitionSourceLabel(input.source);
  const context = `${sourceLabel}: ${input.title}. Buyer/source: ${input.buyerLabel}. Evidence: ${input.evidence.join("; ") || "none"}.`;

  return [
    {
      id: "signal-summary",
      label: "Summarize signal",
      description: "Review the source evidence and recommend the next internal action.",
      prompt:
        `Summarize this CRM acquisition signal without taking external action. ${context} ` +
        `Call out whether it should become an engagement, what evidence is missing, and who should own follow-up.`,
      contextSummary: context,
      expectedNextStep:
        "Customer Advisor or Marketing Strategist returns a short signal summary for operator review.",
    },
    {
      id: "campaign-brief",
      label: "Campaign brief",
      description: "Turn the signal into a campaign or proof-asset idea for review.",
      prompt:
        `Create a draft campaign-brief idea from this acquisition signal without publishing or scheduling anything. ${context} ` +
        `Tie it to a target segment, channel, proof asset, and expected CRM stage movement.`,
      contextSummary: context,
      expectedNextStep:
        "Marketing Strategist proposes an internal campaign brief only; the operator decides what to save or launch.",
    },
  ];
}

function buildSignalView(input: AcquisitionSignalInput): AcquisitionSignalView {
  const linkedEngagement = input.linkedEngagement
    ? {
        id: input.linkedEngagement.id,
        title: input.linkedEngagement.title,
        statusLabel: getEngagementStatusMeta(input.linkedEngagement.status).label,
      }
    : null;
  const routeAction =
    !linkedEngagement && input.contact
      ? {
          title: input.title,
          contactId: input.contact.id,
          accountId: input.contact.accountId,
          source: input.source,
          sourceRefId: input.sourceRefId,
          notes: buildNotes(input),
        }
      : null;
  const routingState: AcquisitionSignalRoutingState = linkedEngagement
    ? "linked"
    : routeAction
      ? "route_ready"
      : "needs_contact";
  const routingLabel =
    routingState === "linked"
      ? "Engagement exists"
      : routingState === "route_ready"
        ? "Ready to create engagement"
        : "Needs contact";
  const routingTone: CrmTone =
    routingState === "linked"
      ? "success"
      : routingState === "route_ready"
        ? "accent"
        : "warning";

  return {
    id: input.id,
    kind: input.kind,
    source: input.source,
    sourceRefId: input.sourceRefId,
    title: input.title,
    summary: input.summary,
    buyerLabel: input.buyerLabel,
    channelLabel: input.channelLabel,
    observedAtLabel: formatDateLabel(input.observedAt),
    routingState,
    routingLabel,
    routingTone,
    evidence: input.evidence,
    contactLabel: input.contact?.label ?? null,
    accountLabel: input.contact?.accountLabel ?? input.accountLabel ?? null,
    linkedEngagement,
    routeAction,
    integrationHref: input.integrationHref ?? null,
    aiTopics: buildAiTopics(input),
  };
}

export function buildAcquisitionSignalWorkspace(input: {
  signals: AcquisitionSignalInput[];
  now?: Date;
}): AcquisitionSignalWorkspace {
  const signals = input.signals
    .map(buildSignalView)
    .sort((a, b) => {
      if (a.routingState !== b.routingState) {
        const order: Record<AcquisitionSignalRoutingState, number> = {
          route_ready: 0,
          needs_contact: 1,
          linked: 2,
        };
        return order[a.routingState] - order[b.routingState];
      }
      return a.title.localeCompare(b.title);
    });

  return {
    summary: {
      observedCount: signals.length,
      routeReadyCount: signals.filter((signal) => signal.routingState === "route_ready").length,
      linkedCount: signals.filter((signal) => signal.routingState === "linked").length,
      needsContactCount: signals.filter((signal) => signal.routingState === "needs_contact").length,
    },
    signals,
  };
}
