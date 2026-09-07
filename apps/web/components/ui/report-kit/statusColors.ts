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
  workroomStage: {
    passed: "success", holding: "warning", denied: "danger",
    "awaiting-confirmation": "warning", "not-reached": "neutral",
    unknown: "neutral", observed: "neutral", cancelled: "neutral",
  },
  // Durable provider operations. start_indeterminate is deliberately warning:
  // the provider POST may have crossed, so the platform reconciles rather
  // than presenting it as pending or repeating the side effect.
  asyncInferenceOperation: {
    pending: "neutral",
    start_indeterminate: "warning",
    running: "info",
    completed: "success",
    failed: "danger",
    cancelled: "neutral",
    expired: "warning",
  },
  // Edge operational health and operator-governed trust are deliberately
  // separate axes. Both Edge Nodes and Connections consume these semantics.
  edgeHealth: {
    "setup-required": "neutral",
    starting: "info",
    healthy: "success",
    degraded: "warning",
    offline: "danger",
    quarantined: "danger",
    revoked: "neutral",
  },
  edgeTrust: {
    pending: "warning",
    trusted: "success",
    quarantined: "danger",
    revoked: "neutral",
  },
  // Build Studio owner proof. Missing, stale, failed, and not-applicable stay
  // visually distinct so absence is never mistaken for a pass.
  ownerProof: {
    passed: "success",
    failed: "danger",
    "not-applicable": "neutral",
    "not-recorded": "warning",
    stale: "warning",
  },
  // Restaurant table capacity state (BI-7C95A586). Tables & Capacity page,
  // Workspace chips, and public booking all resolve here — one registry.
  restaurantCapacity: {
    available: "success",
    occupied: "info",
    "turning-soon": "warning",
    blocked: "danger",
  },
  // Restaurant host-stand state. Physical scene, equivalent table list, and
  // command preview share this vocabulary; text labels always accompany color.
  restaurantFloor: {
    available: "success",
    held: "warning",
    reserved: "accent",
    seated: "info",
    ordered: "info",
    paid: "warning",
    dirty: "warning",
    blocked: "danger",
    "late-turn": "danger",
  },
  // Shared ROOMS grammar. Occupancy, housekeeping readiness, sellable
  // inventory, and privacy are deliberately separate axes: a clean room can
  // still be blocked, and an occupied room can still need housekeeping.
  roomsOccupancy: {
    vacant: "neutral",
    reserved: "accent",
    occupied: "info",
    "departure-due": "warning",
    unknown: "neutral",
  },
  roomsReadiness: {
    ready: "success",
    clean: "info",
    dirty: "warning",
    cleaning: "accent",
    inspected: "success",
    unknown: "neutral",
  },
  roomsInventory: {
    sellable: "success",
    blocked: "danger",
    "out-of-service": "danger",
    unknown: "neutral",
  },
  roomsPrivacy: {
    none: "neutral",
    "do-not-enter": "warning",
    restricted: "warning",
  },
  // Service-period readiness — "are we ready for the next service?" (BI-7C95A586).
  servicePeriodReadiness: {
    ready: "success",
    attention: "warning",
    "not-ready": "danger",
    closed: "neutral",
  },
  // Owner attention cards: impact words, never raw risk scores.
  ownerDecisionImpact: {
    money: "warning",
    public: "danger",
    reversible: "info",
    deadline: "warning",
  },
  // How much oversight an AI coworker runs under, stored as hitlTier 0..3
  // (BI-F2EC4699). Keyed by the plain-language slug rather than the tier number
  // so the registry reads the way the portal renders it. Six components used to
  // carry their own drifted tier→colour maps, two of them with raw hex; they all
  // resolve here now, via lib/workforce/oversight-copy.ts.
  employeeOversight: {
    "employee-only": "danger",
    "needs-approval": "warning",
    "employee-review": "info",
    "on-its-own": "success",
  },
  // Employment lifecycle (WorkforceStatus in lib/workforce/workforce-types.ts). The org
  // chart and workforce roster previously hand-rolled Tailwind colour maps (bg-green-500,
  // bg-amber-400, …) which broke theming and branding; they resolve here now (BI-HCM-004).
  workforceStatus: {
    offer: "info",
    onboarding: "accent",
    active: "success",
    leave: "warning",
    suspended: "danger",
    offboarding: "warning",
    inactive: "neutral",
  },
  // Human-owned leave approval lifecycle. AI recommendations are rendered on
  // a separate axis so a recommendation can never masquerade as a decision.
  leaveRequest: {
    pending: "warning",
    approved: "success",
    rejected: "danger",
    cancelled: "neutral",
  },
  // Decision governance ledger (DecisionInteraction.outcomeType / riskTier).
  decisionOutcome: {
    recommend: "success",
    arbitrate: "info",
    escalate: "danger",
    defer: "warning",
  },
  decisionRisk: {
    low: "success",
    medium: "warning",
    high: "danger",
    critical: "danger",
  },
  // Portfolio coverage axis (BI-PORTCOV-P6): what relationship the org has to a
  // portfolio entry — used/sold = in use, available = configurable now,
  // potential = one governed click to enable, planned/retired. incumbent
  // (BI-5B2F5447) = a third-party app the customer pays for and DPF aims to
  // displace — "warning" reads as spend to address, not an error.
  portfolioCoverage: {
    used: "success",
    incumbent: "warning",
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
  // Finance AP bill lifecycle (was app/(shell)/finance/bills STATUS_COLOURS).
  financeBill: {
    draft: "neutral",
    awaiting_approval: "accent",
    approved: "info",
    partially_paid: "warning",
    paid: "success",
    void: "neutral",
  },
  // Finance supplier lifecycle (was app/(shell)/finance/suppliers SUPPLIER_STATUS_COLOURS).
  financeSupplier: {
    active: "success",
    inactive: "neutral",
    blocked: "danger",
  },
  // Finance purchase-order lifecycle (was app/(shell)/finance/purchase-orders STATUS_COLOURS).
  financePurchaseOrder: {
    draft: "neutral",
    sent: "info",
    acknowledged: "accent",
    received: "success",
    cancelled: "neutral",
  },
  // Finance expense-claim lifecycle (was app/(shell)/finance/expense-claims + my-expenses STATUS_COLOURS).
  financeExpenseClaim: {
    draft: "neutral",
    submitted: "accent",
    approved: "success",
    rejected: "danger",
    paid: "success",
  },
  // Finance approval-step lifecycle (was app/(shell)/finance/bills + expense-claims
  // APPROVAL_STATUS_COLOURS raw-hex maps — BI-D25ED55D cohort migration).
  financeApproval: {
    pending: "warning",
    approved: "success",
    rejected: "danger",
  },
  // Finance expense-claim line category (was app/(shell)/finance/expense-claims
  // CATEGORY_COLOURS raw-hex map). Taxonomy tint, same pattern as financeAssetCategory.
  financeExpenseCategory: {
    travel: "info",
    meals: "warning",
    accommodation: "accent",
    supplies: "success",
    mileage: "warning",
    other: "neutral",
  },
  // Finance recurring-schedule lifecycle (was app/(shell)/finance/recurring SCHEDULE_STATUS_COLOURS).
  financeRecurring: {
    active: "success",
    paused: "warning",
    cancelled: "danger",
    completed: "neutral",
  },
  // Finance payment-run lifecycle (was inline ternary in app/(shell)/finance/payment-runs).
  financePaymentRun: {
    pending: "warning",
    processing: "warning",
    completed: "success",
    failed: "danger",
  },
  // Finance fixed-asset lifecycle (was app/(shell)/finance/assets STATUS_COLOURS).
  financeAsset: {
    active: "success",
    disposed: "neutral",
    written_off: "danger",
  },
  // Finance fixed-asset category taxonomy (was app/(shell)/finance/assets CATEGORY_COLOURS).
  financeAssetCategory: {
    equipment: "info",
    vehicle: "warning",
    furniture: "accent",
    IT: "success",
    property: "warning",
    other: "neutral",
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
    retired: "neutral",
  },
  // Canonical Workroom lifecycle. This is distinct from true liveness: status
  // says where the room is in its workflow while liveness says whether its
  // recorded execution evidence is still alive.
  workroom: {
    draft: "neutral",
    ready: "info",
    working: "accent",
    blocked: "danger",
    verifying: "info",
    "ready-for-review": "warning",
    "ready-for-promotion": "warning",
    complete: "success",
    abandoned: "neutral",
    archived: "neutral",
  },
  // Workspace Work Room semantics. These domains are shared by the My Work
  // lens and room detail shell so neither surface carries a private color map.
  workCaseState: {
    intake: "neutral",
    triage: "info",
    active: "accent",
    "waiting-on-person": "warning",
    "waiting-on-system": "danger",
    "awaiting-decision": "warning",
    verifying: "info",
    resolved: "success",
    closed: "neutral",
    cancelled: "neutral",
  },
  workroomOutcomeHealth: {
    "on-track": "success",
    "at-risk": "warning",
    blocked: "danger",
    idle: "neutral",
    unknown: "neutral",
  },
  workroomActivity: {
    message: "neutral",
    ask: "warning",
    "coworker-joined": "accent",
    "coworker-left": "accent",
    "coworker-handoff": "warning",
    "work-started": "accent",
    "work-paused": "accent",
    "work-completed": "success",
    "decision-proposed": "warning",
    "decision-resolved": "success",
    "artifact-added": "info",
    "governed-action": "accent",
    "external-event": "neutral",
    verification: "info",
    receipt: "info",
    "cycle-opened": "accent",
    "cycle-closed": "success",
    "cycle-carried-over": "accent",
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
  // Archetype claim-readiness gate (BI-1A222A7A). Tiers and evidence states
  // are shared by the operator matrix and any future docs/sales claim surfaces.
  archetypeReadinessTier: {
    "template-ready": "info",
    "ops-ready": "accent",
    "connector-ready": "warning",
    "regulated-ready": "warning",
    "sole-platform-ready": "success",
  },
  archetypeReadinessEvidence: {
    planned: "neutral",
    open: "warning",
    "in-progress": "info",
    done: "success",
    merged: "success",
    required: "warning",
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
  // IT4IT functional-criteria coverage (EP-IT4IT-CONFORMANCE). not_started/no-data is
  // neutral (never green); out_of_mvp is an intentional exclusion, also neutral.
  it4itCoverage: {
    implemented: "success",
    partial: "warning",
    planned: "info",
    not_started: "neutral",
    out_of_mvp: "neutral",
  },
  // EP-MSP-FEDERATION · B1 — sovereign-peer link trust state (dual-approval).
  // pending until BOTH sides approve; quarantined is a held/investigate state.
  federationLinkState: {
    pending: "info",
    trusted: "success",
    quarantined: "warning",
    revoked: "neutral",
  },
  // EP-MSP-FEDERATION · A3 — customer service-desk ticket lifecycle.
  serviceTicketStatus: {
    open: "info",
    acknowledged: "accent",
    "in-progress": "accent",
    "waiting-customer": "warning",
    resolved: "success",
    closed: "neutral",
  },
  serviceTicketPriority: {
    low: "neutral",
    normal: "info",
    high: "warning",
    urgent: "danger",
  },
  // EP-MSP-FEDERATION · B4 — cross-org remediation proposal lifecycle.
  federatedProposalStatus: {
    proposed: "warning",
    approved: "success",
    rejected: "neutral",
    executed: "success",
    expired: "neutral",
  },
  // Security case / detection lifecycle (EP-SOVEREIGN-SOC). Open work is info;
  // active investigation/containment is accent; resolved is success, closed neutral.
  security: {
    open: "info",
    new: "info",
    triaging: "warning",
    triaged: "warning",
    investigating: "accent",
    contained: "accent",
    linked: "accent",
    suppressed: "neutral",
    resolved: "success",
    closed: "neutral",
  },
  // Security severity (OCSF-aligned). info/low benign; medium/high warn; critical danger.
  securitySeverity: {
    info: "info",
    low: "success",
    medium: "warning",
    high: "warning",
    critical: "danger",
  },
  // Hive contribution applicability for canonical seeded content.
  seedContributionFit: {
    "global-default": "success",
    "archetype-scoped": "accent",
    "vertical-scoped": "info",
    "parameterize-first": "warning",
    "install-local-only": "neutral",
    "reject-as-seed": "danger",
  },
  // Admin > Hive contribution provenance. These statuses answer plain-language
  // operator questions across four axes: kept here, privacy disposition, sent
  // outside, and community acceptance. Keep them in the shared registry so the
  // provenance report does not carry a private status color map.
  contributionProvenance: {
    accepted: "success",
    "approved-to-share": "accent",
    "blocked-policy": "warning",
    "blocked-private-path": "warning",
    "kept-here": "neutral",
    "needs-attention": "warning",
    "needs-review": "warning",
    "not-queued": "neutral",
    "not-sent": "neutral",
    "private-backup": "accent",
    "private-parts-removed": "success",
    rejected: "warning",
    "saved-locally": "neutral",
    "sent-community": "accent",
    "under-review": "accent",
    "waiting-online": "warning",
    withdrawn: "neutral",
  },
};

/**
 * Resolve a (domain, status) pair to an intent. Unknown domain/status falls
 * back to "neutral" so a surface never crashes on an unmapped value.
 */
export function resolveIntent(domain: string, status: string): Intent {
  return STATUS_INTENT[domain]?.[status] ?? "neutral";
}
