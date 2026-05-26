export const OPEN_OPPORTUNITY_STAGES = [
  "qualification",
  "discovery",
  "proposal",
  "negotiation",
] as const;

export type OpenOpportunityStage = typeof OPEN_OPPORTUNITY_STAGES[number];

export type CrmTone =
  | "accent"
  | "attention"
  | "danger"
  | "info"
  | "neutral"
  | "success"
  | "warning";

export type CrmPresentationMeta = {
  label: string;
  tone: CrmTone;
};

export const CRM_TONE_CLASSES: Record<
  CrmTone,
  {
    border: string;
    badge: string;
    text: string;
    surface: string;
  }
> = {
  accent: {
    border: "border-[var(--dpf-accent)]",
    badge: "border-[var(--dpf-accent)] bg-[var(--dpf-surface-2)] text-[var(--dpf-accent)]",
    text: "text-[var(--dpf-accent)]",
    surface: "bg-[var(--dpf-surface-2)]",
  },
  attention: {
    border: "border-[var(--dpf-accent)]",
    badge: "border-[var(--dpf-accent)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]",
    text: "text-[var(--dpf-text)]",
    surface: "bg-[var(--dpf-surface-2)]",
  },
  danger: {
    border: "border-[var(--dpf-border)]",
    badge: "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]",
    text: "text-[var(--dpf-text)]",
    surface: "bg-[var(--dpf-surface-2)]",
  },
  info: {
    border: "border-[var(--dpf-border)]",
    badge: "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]",
    text: "text-[var(--dpf-text)]",
    surface: "bg-[var(--dpf-surface-2)]",
  },
  neutral: {
    border: "border-[var(--dpf-border)]",
    badge: "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]",
    text: "text-[var(--dpf-muted)]",
    surface: "bg-[var(--dpf-surface-1)]",
  },
  success: {
    border: "border-[var(--dpf-accent)]",
    badge: "border-[var(--dpf-accent)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]",
    text: "text-[var(--dpf-text)]",
    surface: "bg-[var(--dpf-surface-2)]",
  },
  warning: {
    border: "border-[var(--dpf-border)]",
    badge: "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]",
    text: "text-[var(--dpf-text)]",
    surface: "bg-[var(--dpf-surface-2)]",
  },
};

const ACCOUNT_STATUS_META: Record<string, CrmPresentationMeta> = {
  prospect: { label: "Prospect", tone: "warning" },
  qualified: { label: "Qualified", tone: "attention" },
  onboarding: { label: "Onboarding", tone: "info" },
  active: { label: "Active", tone: "success" },
  at_risk: { label: "At risk", tone: "danger" },
  suspended: { label: "Suspended", tone: "neutral" },
  closed: { label: "Closed", tone: "neutral" },
};

const ENGAGEMENT_STATUS_META: Record<string, CrmPresentationMeta> = {
  new: { label: "New", tone: "warning" },
  contacted: { label: "Contacted", tone: "info" },
  qualified: { label: "Qualified", tone: "success" },
  unqualified: { label: "Unqualified", tone: "neutral" },
  converted: { label: "Converted", tone: "accent" },
};

const OPPORTUNITY_STAGE_META: Record<string, CrmPresentationMeta> = {
  qualification: { label: "Qualification", tone: "warning" },
  discovery: { label: "Discovery", tone: "attention" },
  proposal: { label: "Proposal", tone: "info" },
  negotiation: { label: "Negotiation", tone: "accent" },
  closed_won: { label: "Won", tone: "success" },
  closed_lost: { label: "Lost", tone: "danger" },
};

const QUOTE_STATUS_META: Record<string, CrmPresentationMeta> = {
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Sent", tone: "info" },
  accepted: { label: "Accepted", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  expired: { label: "Expired", tone: "warning" },
  superseded: { label: "Superseded", tone: "neutral" },
};

const SALES_ORDER_STATUS_META: Record<string, CrmPresentationMeta> = {
  confirmed: { label: "Confirmed", tone: "info" },
  in_progress: { label: "In progress", tone: "warning" },
  fulfilled: { label: "Fulfilled", tone: "success" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

export function formatCrmStatusLabel(value: string): string {
  const normalized = value.replace(/[_-]+/g, " ").trim();
  if (!normalized) {
    return "Unknown";
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function fallbackMeta(value: string): CrmPresentationMeta {
  return {
    label: formatCrmStatusLabel(value),
    tone: "neutral",
  };
}

export function getAccountStatusMeta(status: string): CrmPresentationMeta {
  return ACCOUNT_STATUS_META[status] ?? fallbackMeta(status);
}

export function getEngagementStatusMeta(status: string): CrmPresentationMeta {
  return ENGAGEMENT_STATUS_META[status] ?? fallbackMeta(status);
}

export function getOpportunityStageMeta(stage: string): CrmPresentationMeta {
  return OPPORTUNITY_STAGE_META[stage] ?? fallbackMeta(stage);
}

export function getQuoteStatusMeta(status: string): CrmPresentationMeta {
  return QUOTE_STATUS_META[status] ?? fallbackMeta(status);
}

export function getSalesOrderStatusMeta(status: string): CrmPresentationMeta {
  return SALES_ORDER_STATUS_META[status] ?? fallbackMeta(status);
}

export function isOpenOpportunityStage(stage: string): stage is OpenOpportunityStage {
  return OPEN_OPPORTUNITY_STAGES.includes(stage as OpenOpportunityStage);
}
