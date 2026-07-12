import type { CrmTone } from "./presentation";
import { isOpenOpportunityStage } from "./presentation";

/**
 * Which customer needs the operator? The account list leads with attention:
 * accounts carrying an unmet signal are surfaced first so the operator does not
 * have to scan a flat "Active" directory to find the one going sideways.
 *
 * Signals are derived from existing CRM data (opportunities, quotes,
 * engagements, activity recency) — no new persisted state. The classifier is
 * pure so the ordering and thresholds are unit-testable.
 */
export type AccountAttentionSignal =
  | "at_risk"
  | "follow_up_due"
  | "commitment_pending"
  | "stale";

/** Days without a logged activity before an account with open work reads as stale. */
export const STALE_ACTIVITY_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export type AccountOpportunitySignal = {
  stage: string;
  isDormant: boolean;
  expectedClose: Date | null;
};

export type AccountQuoteSignal = {
  status: string;
  validUntil: Date | null;
};

export type AccountEngagementSignal = {
  status: string;
};

export type AccountAttentionInput = {
  /** Account lifecycle status (prospect | qualified | active | at_risk | ...). */
  status: string;
  /** Open + closed opportunities on the account. Closed stages are ignored. */
  opportunities: AccountOpportunitySignal[];
  /** Quotes on the account (any status). */
  quotes: AccountQuoteSignal[];
  /** Engagements on the account (any status). */
  engagements: AccountEngagementSignal[];
  /** Most recent logged activity timestamp, or null when none exists. */
  lastActivityAt: Date | null;
  /** When the account record was created (used as the stale reference when no activity exists). */
  createdAt: Date;
  /** Evaluation clock — injected for deterministic tests. */
  now: Date;
};

export type AccountAttention = {
  signal: AccountAttentionSignal | null;
  /** Higher = more urgent. 0 means nothing needs the operator. */
  severity: number;
  /** Short badge label. Empty when there is no signal. */
  label: string;
  /** One-line reason the account was flagged. Empty when there is no signal. */
  reason: string;
  tone: CrmTone;
};

const NO_ATTENTION: AccountAttention = {
  signal: null,
  severity: 0,
  label: "",
  reason: "",
  tone: "neutral",
};

const OPEN_ENGAGEMENT_STATUSES = ["new", "contacted"];

function isOverdue(date: Date | null, now: Date): boolean {
  return date !== null && date.getTime() < now.getTime();
}

function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / DAY_MS;
}

/**
 * Classify a single account into at most one attention signal, using the
 * highest-priority match. Priority (most urgent first):
 *   at_risk > follow_up_due > commitment_pending > stale > none.
 */
export function classifyAccountAttention(input: AccountAttentionInput): AccountAttention {
  const openOpportunities = input.opportunities.filter((o) => isOpenOpportunityStage(o.stage));
  const openEngagements = input.engagements.filter((e) =>
    OPEN_ENGAGEMENT_STATUSES.includes(e.status),
  );
  const hasOpenWork = openOpportunities.length > 0 || openEngagements.length > 0;

  // 1. At risk — the account is flagged, a quote lapsed, or open work went dormant.
  const dormantOpen = openOpportunities.filter((o) => o.isDormant).length;
  const expiredQuotes = input.quotes.filter((q) => q.status === "expired").length;
  if (input.status === "at_risk") {
    return {
      signal: "at_risk",
      severity: 4,
      label: "At risk",
      reason: "Account flagged at risk",
      tone: "danger",
    };
  }
  if (expiredQuotes > 0) {
    return {
      signal: "at_risk",
      severity: 4,
      label: "At risk",
      reason: `${expiredQuotes} quote${expiredQuotes === 1 ? "" : "s"} expired without a decision`,
      tone: "danger",
    };
  }
  if (dormantOpen > 0) {
    return {
      signal: "at_risk",
      severity: 4,
      label: "At risk",
      reason: `${dormantOpen} open opportunit${dormantOpen === 1 ? "y has" : "ies have"} gone dormant`,
      tone: "danger",
    };
  }

  // 2. Follow-up due — a dated commitment has lapsed or inbound interest is unworked.
  const overdueOpps = openOpportunities.filter((o) => isOverdue(o.expectedClose, input.now)).length;
  const lapsingSentQuotes = input.quotes.filter(
    (q) => q.status === "sent" && isOverdue(q.validUntil, input.now),
  ).length;
  const newEngagements = input.engagements.filter((e) => e.status === "new").length;
  if (overdueOpps > 0) {
    return {
      signal: "follow_up_due",
      severity: 3,
      label: "Follow-up due",
      reason: `${overdueOpps} opportunit${overdueOpps === 1 ? "y is" : "ies are"} past expected close`,
      tone: "warning",
    };
  }
  if (lapsingSentQuotes > 0) {
    return {
      signal: "follow_up_due",
      severity: 3,
      label: "Follow-up due",
      reason: `${lapsingSentQuotes} sent quote${lapsingSentQuotes === 1 ? "" : "s"} past validity`,
      tone: "warning",
    };
  }
  if (newEngagements > 0) {
    return {
      signal: "follow_up_due",
      severity: 3,
      label: "Follow-up due",
      reason: `${newEngagements} new engagement${newEngagements === 1 ? "" : "s"} awaiting first contact`,
      tone: "warning",
    };
  }

  // 3. Commitment pending — the ball is in the customer's court; monitor it.
  const openSentQuotes = input.quotes.filter((q) => q.status === "sent").length;
  const negotiating = openOpportunities.filter((o) => o.stage === "negotiation").length;
  if (openSentQuotes > 0) {
    return {
      signal: "commitment_pending",
      severity: 2,
      label: "Awaiting decision",
      reason: `${openSentQuotes} quote${openSentQuotes === 1 ? "" : "s"} sent, awaiting the customer`,
      tone: "accent",
    };
  }
  if (negotiating > 0) {
    return {
      signal: "commitment_pending",
      severity: 2,
      label: "Awaiting decision",
      reason: `${negotiating} opportunit${negotiating === 1 ? "y is" : "ies are"} in negotiation`,
      tone: "accent",
    };
  }

  // 4. Stale — live work has gone quiet with no recent activity.
  if (hasOpenWork) {
    const reference = input.lastActivityAt ?? input.createdAt;
    const idleDays = daysBetween(reference, input.now);
    if (idleDays >= STALE_ACTIVITY_DAYS) {
      const wholeDays = Math.floor(idleDays);
      return {
        signal: "stale",
        severity: 1,
        label: "No recent activity",
        reason: `No activity in ${wholeDays} days with open work`,
        tone: "warning",
      };
    }
  }

  return { ...NO_ATTENTION };
}

/**
 * Stable ordering: accounts needing the operator most come first (by severity),
 * ties broken by the caller-supplied name so the list stays deterministic.
 */
export function sortAccountsByAttention<T>(
  accounts: T[],
  getAttention: (account: T) => AccountAttention,
  getName: (account: T) => string,
): T[] {
  return [...accounts].sort((a, b) => {
    const severityDiff = getAttention(b).severity - getAttention(a).severity;
    if (severityDiff !== 0) {
      return severityDiff;
    }
    return getName(a).localeCompare(getName(b));
  });
}
