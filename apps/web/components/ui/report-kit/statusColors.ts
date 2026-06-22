// apps/web/components/ui/report-kit/statusColors.ts
//
// Central status/severity color semantics for the reporting palette.
//
// A domain status string (e.g. "overdue", "critical") maps to a semantic
// `Intent`, and an Intent maps to DPF design tokens. This is the single place
// that defines those mappings, so individual surfaces stop re-declaring their
// own color maps (and stop bypassing tokens with raw hex).
//
// NOTE: unrelated to apps/web/lib/reporting-types.ts (compliance-posture math).

export type Intent =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral"
  | "accent";

export interface IntentStyle {
  /** Foreground (text/icon) color — a CSS value, always a --dpf-* token. */
  fg: string;
  /** Border color — a CSS value, always a --dpf-* token. */
  border: string;
  /** Soft background wash derived from the foreground token via color-mix. */
  softBg: string;
}

const INTENT_TOKEN: Record<Intent, { fg: string; border: string }> = {
  success: { fg: "var(--dpf-success)", border: "var(--dpf-success)" },
  warning: { fg: "var(--dpf-warning)", border: "var(--dpf-warning)" },
  danger: { fg: "var(--dpf-error)", border: "var(--dpf-error)" },
  info: { fg: "var(--dpf-info)", border: "var(--dpf-info)" },
  accent: { fg: "var(--dpf-accent)", border: "var(--dpf-accent)" },
  neutral: { fg: "var(--dpf-muted)", border: "var(--dpf-border)" },
};

/**
 * Resolve the token-backed style for a semantic intent. Soft backgrounds use
 * color-mix so we never introduce new tokens for tints.
 */
export function intentStyle(intent: Intent): IntentStyle {
  const token = INTENT_TOKEN[intent];
  const softBg =
    intent === "neutral"
      ? "var(--dpf-surface-2)"
      : `color-mix(in srgb, ${token.fg} 12%, transparent)`;
  return { fg: token.fg, border: token.border, softBg };
}

/**
 * Per-domain status → intent registry. Adding a new domain (or status) is a
 * one-line change here rather than a new color map inside a page component.
 *
 * Keys are domain namespaces; some domains split severity vs. lifecycle status
 * (e.g. complaints) so each gets its own namespace.
 */
export const STATUS_INTENT: Record<string, Record<string, Intent>> = {
  // Portfolio coverage axis (BI-PORTCOV-P6): what relationship the org has to a
  // portfolio entry — used/sold = in use, available = configurable now,
  // potential = one governed click to enable, planned/retired.
  portfolioCoverage: {
    used: "success",
    sold: "success",
    available: "info",
    potential: "accent",
    planned: "warning",
    retired: "neutral",
  },
  // Finance invoice/payment lifecycle (was app/(shell)/finance STATUS_COLOURS).
  finance: {
    draft: "neutral",
    sent: "info",
    viewed: "accent",
    overdue: "danger",
    partially_paid: "warning",
    paid: "success",
    void: "neutral",
    written_off: "neutral",
  },
  // Complaints (was raw hex in ComplaintsClient — now token-backed).
  complaintSeverity: {
    low: "success",
    medium: "warning",
    high: "warning",
    critical: "danger",
  },
  complaintStatus: {
    open: "info",
    investigating: "accent",
    resolved: "success",
    closed: "neutral",
  },
  // Payment direction (was raw hex in finance/payments — now token-backed).
  paymentDirection: {
    inbound: "success",
    outbound: "warning",
  },
  aiFinance: {
    tracked: "success",
    needs_setup: "warning",
    untracked: "danger",
    active: "success",
    draft: "warning",
    seeded: "warning",
    attention_needed: "danger",
  },
  aiFinanceWork: {
    none: "success",
    plan_details_needed: "warning",
    commitment_details_needed: "warning",
    browser_profile_needed: "warning",
    missing_usage_source: "danger",
    underused_commitment: "warning",
    critical_low_allowance: "danger",
  },
  // Compliance control implementation status (was raw Tailwind palette classes).
  controlStatus: {
    planned: "info",
    "in-progress": "warning",
    implemented: "success",
    "not-applicable": "neutral",
  },
  // Compliance control effectiveness.
  controlEffectiveness: {
    effective: "success",
    "partially-effective": "warning",
    ineffective: "danger",
    "not-assessed": "neutral",
  },
  // Compliance module lifecycle statuses (were raw Tailwind palette classes).
  complianceAudit: {
    planned: "info",
    "in-progress": "warning",
    completed: "success",
    cancelled: "neutral",
  },
  complianceAction: {
    open: "warning",
    "in-progress": "warning",
    completed: "info",
    verified: "success",
    "not-applicable": "neutral",
  },
  complianceSubmission: {
    draft: "neutral",
    pending: "warning",
    submitted: "info",
    acknowledged: "success",
    rejected: "danger",
  },
  compliancePolicy: {
    draft: "neutral",
    "in-review": "warning",
    approved: "info",
    published: "success",
    retired: "neutral",
  },
  complianceRegulation: {
    active: "success",
    inactive: "danger",
  },
  complianceApplicability: {
    applies: "success",
    review: "warning",
    reference: "neutral",
  },
  // Marketing strategy/work-product lifecycle.
  marketing: {
    draft: "neutral",
    ready: "info",
    active: "success",
    pending: "warning",
    "pending-review": "warning",
    "needs-changes": "warning",
    approved: "success",
    rejected: "danger",
    stale: "warning",
    published: "success",
    archived: "neutral",
  },
  // Coworker-to-coworker (A2A) interaction state on the AI Operations Map.
  // Keeps the A2A panel's state→color semantics in the one shared registry
  // instead of a private color map. See A2aInteractionsPanel.
  a2aInteraction: {
    active: "accent",
    completed: "success",
    failed: "danger",
    blocked: "warning",
  },
  // Ops self-upgrade lifecycle. Keep these here so the Upgrade Center does not
  // carry a private run-status color map.
  selfUpgradeRun: {
    queued: "info",
    pending: "info",
    running: "accent",
    completing: "accent",
    succeeded: "success",
    failed: "danger",
    skipped: "neutral",
    cancelled: "neutral",
    rolled_back: "warning",
  },
  // Deliberation consensus outcome on the AI Operations Map deliberation lens.
  deliberationConsensus: {
    consensus: "success",
    "partial-consensus": "warning",
    "no-consensus": "danger",
    "insufficient-evidence": "warning",
    pending: "accent",
  },
  // Platform issue-report severity (Admin > Issue Reports). Mirrors the
  // operator-facing severity semantics where an unbreached high is already
  // danger-tier, distinct from the generic `severity` ramp below.
  issueSeverity: {
    info: "info",
    low: "neutral",
    medium: "warning",
    high: "danger",
    critical: "danger",
  },
  // Platform issue-report lifecycle bucket (needs_action/triaged/resolved/...).
  issueStatus: {
    needs_action: "danger",
    triaged: "warning",
    resolved: "success",
    suppressed: "neutral",
  },
  // Backlog item lifecycle (Operations > Backlog and the Improvements evidence
  // view). This is the single canonical work lifecycle: origin queues
  // (improvements, capability needs, issue reports) surface THIS status, not a
  // parallel one. Mirrors BACKLOG_STATUS_VALUES in apps/web/lib/explore/backlog.ts.
  backlogItem: {
    triaging: "warning",
    open: "info",
    "in-progress": "accent",
    done: "success",
    deferred: "neutral",
  },
  // Platform domain-readiness matrix (Six-Cs). good/attention/blocked/unknown
  // map to the shared intent ramp so the readiness surface stops carrying its
  // own state->color map. See PlatformReadinessMatrix + command-center.ts.
  readiness: {
    good: "success",
    attention: "warning",
    blocked: "danger",
    unknown: "neutral",
  },
  // Field-dispatch job lifecycle (dispatch board). Mirrors FIELD_DISPATCH_JOB_STATUSES
  // in @dpf/validators (packages/validators/src/field-dispatch.ts). `needs-review` is the exception
  // bucket (a job with no valid dispatch state) so it is warning, not neutral; truly
  // unknown values fall through resolveIntent() to neutral.
  fieldDispatchJob: {
    quoted: "neutral",
    scheduled: "info",
    confirmed: "info",
    "en-route": "accent",
    "on-site": "accent",
    complete: "success",
    invoiced: "info",
    paid: "success",
    cancelled: "neutral",
    "needs-review": "warning",
  },
  // Operational health ramp shared by the dispatch board and the storefront
  // composition view (CompositionCompatibilityStatus). good/concern/acute/
  // in-motion/unknown — unknown is neutral (never green) for missing data.
  operationalStatus: {
    good: "success",
    concern: "warning",
    acute: "danger",
    "in-motion": "accent",
    unknown: "neutral",
  },
  // Provider routing-eligibility (Providers admin surface). Mirrors
  // RoutingEligibilityState in lib/routing/provider-routing-eligibility.ts —
  // the single mutually-exclusive answer to "can routing use this now?".
  // routable=success; the temporary/needs-action states are warning; off/never
  // and not-a-routing-target are neutral.
  routingEligibility: {
    routable: "success",
    rate_limited: "warning",
    needs_credentials: "warning",
    no_models: "warning",
    disabled: "neutral",
    unconfigured: "neutral",
    not_routable: "neutral",
  },
  // Generic severity ramp, reusable by any surface that has none of its own.
  severity: {
    info: "info",
    low: "success",
    medium: "warning",
    high: "warning",
    critical: "danger",
  },
  // Multi-archetype composition compatibility (EP-ARCH-8D4F2A §4.3).
  // good = same-category or low-conflict; concern = cross-category differences;
  // acute = trust/compliance/identity block; in-motion = seeding in progress;
  // unknown = metadata missing (never green).
  compositionCompatibility: {
    good: "success",
    concern: "warning",
    acute: "danger",
    "in-motion": "accent",
    unknown: "neutral",
  },
};

/**
 * Resolve a (domain, status) pair to an intent. Unknown domain/status falls
 * back to "neutral" so a surface never crashes on an unmapped value.
 */
export function resolveIntent(domain: string, status: string): Intent {
  return STATUS_INTENT[domain]?.[status] ?? "neutral";
}
