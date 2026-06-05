// Typed catalogs for the marketing execution loop substrate.
//
// All status / domain / source-type / format strings used by the outbound
// draft + approval queue MUST come from here. Pages, tools, server actions,
// and tests import the typed constants — string literals scattered across
// call sites violate the strongly-typed-string-enums kernel principle.
//
// Reference spec:
//   docs/superpowers/specs/2026-05-26-marketing-execution-loop-design.md §6.

export const OUTBOUND_DRAFT_STATUS = [
  "draft",
  "pending-review",
  "approved",
  "rejected",
  "needs-changes",
  "stale",
  "published",
] as const;
export type OutboundDraftStatus = (typeof OUTBOUND_DRAFT_STATUS)[number];

export const OUTBOUND_APPROVAL_DECISION = [
  "approved",
  "rejected",
  "needs-changes",
] as const;
export type OutboundApprovalDecisionValue = (typeof OUTBOUND_APPROVAL_DECISION)[number];

/**
 * Domains that share the outbound execution substrate. Marketing is the
 * first; customer-advisor outbound, ops-coordinator status comms, and
 * build-specialist contributor recruitment join here when they adopt
 * the substrate, without a rename migration.
 */
export const OUTBOUND_DOMAIN = ["marketing"] as const;
export type OutboundDomain = (typeof OUTBOUND_DOMAIN)[number];

export const OUTBOUND_SOURCE_TYPE = [
  "marketing-asset-task",
  "marketing-campaign-brief",
  "inbound-channel-message",
  "manual",
] as const;
export type OutboundSourceType = (typeof OUTBOUND_SOURCE_TYPE)[number];

export const OUTBOUND_BODY_FORMAT = ["markdown", "html", "plain"] as const;
export type OutboundBodyFormat = (typeof OUTBOUND_BODY_FORMAT)[number];

// ─── Phase 5: scheduler catalog ─────────────────────────────────────────────

export const SCHEDULED_ACTION_KIND = [
  "draft-marketing-asset",
  "publish-approved-draft",
  "pull-channel-kpis",
] as const;
export type ScheduledActionKind = (typeof SCHEDULED_ACTION_KIND)[number];

export const SCHEDULED_ACTION_STATUS = [
  "pending",
  "paused",
  "fired",
  "cancelled",
  "failed",
] as const;
export type ScheduledActionStatus = (typeof SCHEDULED_ACTION_STATUS)[number];

const SCHEDULED_TRANSITIONS: Readonly<Record<ScheduledActionStatus, ReadonlyArray<ScheduledActionStatus>>> = {
  pending: ["paused", "fired", "cancelled", "failed"],
  paused: ["pending", "cancelled"],
  fired: [],
  cancelled: [],
  failed: ["pending", "cancelled"],
};

export function isAllowedScheduledTransition(
  from: ScheduledActionStatus,
  to: ScheduledActionStatus,
): boolean {
  return SCHEDULED_TRANSITIONS[from].includes(to);
}

// Channels that may be autopiloted. linkedin-ads is INTENTIONALLY excluded
// and the autopilot eligibility check refuses ad placements regardless of
// what's stored on the policy row. Inbound replies (source-type=inbound-
// channel-message) are also refused — both per spec §13.
export const AUTOPILOT_ALLOWED_CHANNELS = [
  "linkedin-personal-social",
  "linkedin",
  "email-postmark",
  "email",
] as const;
export type AutopilotAllowedChannel = (typeof AUTOPILOT_ALLOWED_CHANNELS)[number];

export function isAutopilotAllowedChannel(channelId: string): boolean {
  return (AUTOPILOT_ALLOWED_CHANNELS as ReadonlyArray<string>).includes(channelId);
}

// ─── State machine ──────────────────────────────────────────────────────────
//
// Strict transitions, enforced by `assertDraftTransition` below.
// `pending-review` is the only state that accepts a decision.
// `approved` and `rejected` are terminal for this draft revision — a new
// revision requires a fresh draft row, not an in-place status flip.

const ALLOWED_TRANSITIONS: Readonly<Record<OutboundDraftStatus, ReadonlyArray<OutboundDraftStatus>>> = {
  draft: ["pending-review", "stale"],
  "pending-review": ["approved", "rejected", "needs-changes", "stale"],
  "needs-changes": ["pending-review", "stale"],
  approved: ["published"], // Phase 2: publish flips approved → published
  rejected: [],
  stale: [],
  published: [], // terminal — engagement metrics update lastMetricsSnapshot, not status
};

export function isAllowedDraftTransition(from: OutboundDraftStatus, to: OutboundDraftStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertDraftTransition(from: OutboundDraftStatus, to: OutboundDraftStatus): void {
  if (!isAllowedDraftTransition(from, to)) {
    throw new Error(
      `Illegal OutboundDraft transition: ${JSON.stringify(from)} -> ${JSON.stringify(to)}. ` +
        `Approved and rejected drafts are terminal; create a new draft revision instead.`,
    );
  }
}

/**
 * Map an approval-decision value to the resulting draft status.
 *   approved      -> approved (terminal)
 *   rejected      -> rejected (terminal)
 *   needs-changes -> needs-changes (drafter can produce a new revision)
 */
export function draftStatusForDecision(decision: OutboundApprovalDecisionValue): OutboundDraftStatus {
  switch (decision) {
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "needs-changes":
      return "needs-changes";
  }
}
