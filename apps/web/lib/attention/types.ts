// The Attention Surface — projector output types (EP-ATTENTION-SURFACE, BI-D39484E7 + BI-61B9EB88).
// Spec: docs/superpowers/specs/2026-06-23-human-attention-surface-design.md §4.1, §4.4.

import type { EnvelopeDecisionSummary } from "./coworker-envelope-decision";
//
// `AttentionItem` is a READ-MODEL projection, NOT a persisted entity. Each queue's
// truth stays in its owning model (single-source-of-truth); the inbox projects over
// them, exactly as command-center.ts projects WorkspaceAttentionItem[]. There is
// deliberately NO single composite "priority" number on this type — incommensurable
// items are made comparable by the SAME objective factors (triage) + a tiered order,
// never a fabricated score (the #2315 0.000-theater rule, applied to ranking).

/** Which scattered queue an item was projected from. */
export type AttentionSource =
  | "escalation" // PlatformIssueReport awaiting_escalation_ack (build-stall) — re-homed off /ops
  | "ai-decision" // DecisionInteraction outcomeType escalate/defer, humanOutcome null
  | "paused-ai" // TaskRun input-required / auth-required
  | "scheduled-task" // ScheduledAgentTask lastStatus=error with non-quiet proactivity
  | "agent-proposal" // AgentActionProposal status=proposed
  | "approval-outbound" // OutboundDraft pending-review (marketing)
  | "approval-bill" // Bill awaiting_approval (AP — carries a dueDate)
  | "approval-expense" // ExpenseClaim submitted
  | "compliance-submission" // RegulatorySubmission draft (carries a dueDate)
  | "research-proposal" // ResearchProposal pending
  | "coworker-memory" // Newly distilled CoworkerMemoryNote rows for digest visibility
  | "ai-readiness-blocker" // AI Readiness blocked domain requiring operator action
  | "platform-health" // PortfolioQualityIssue issueType=health_alert, status=open (BI-2F778C13)
  | "provider-credential" // an enabled AI provider whose saved sign-in has EXPIRED — reconnect (BI-282C39D5)
  | "reservation-exception" // a public StorefrontBooking awaiting owner action — confirm / reschedule / overlap (BI-3DA1DFDC)
  | "hospitality-capacity" // blocked, quarantined, over-capacity, or idle Food & Hospitality capacity
  | "storefront-inquiry" // a new public StorefrontInquiry awaiting the owner's first response (BI-348766E5)
  | "business-journey" // PortfolioQualityIssue issueType=journey_failure — a critical business journey failed its watchdog run (BI-E105303D)
  | "compliance-source-freshness" // governed AI-provider compliance evidence lapsing or lapsed (BI-68D44727)
  | "coworker-envelope" // CoworkerActionEnvelope status=proposed, bound to the reading user (BI-7CB2CCDE)
  | "skill-proposal" // ImprovementProposal category=skill, status=proposed — a skill change awaiting review (BI-2F9EE2E9)
  | "workroom-stall"; // a Workroom whose drive has refused consecutive wakes — stalled, or unowned (BI-03E94B5B)

/** Risk vocabulary aligned with the paused-work plan (a2aMetadata.riskClass). */
export type AttentionRiskClass = "read" | "bounded-write" | "high-risk" | "unknown";

/** The four canonical Portfolios, keyed for the OUTSIDE-IN operator cockpit
 *  (BI-8C3EB52C). The cockpit organizes attention from the customer inward:
 *  products/services (customer-facing) and workforce (for-employees) are the
 *  PRIMARY perspective; manufacturing-and-delivery and foundational sit deeper
 *  inside and are secondary — an inner item only jumps the primary queue when it
 *  is flagged as blocking a customer/business outcome. Mirrors the canonical
 *  roots in packages/db/data/portfolio_registry.json. */
export type AttentionPortfolio =
  | "products-and-services-sold" // revenue-generating, external customers (PRIMARY, outermost)
  | "for-employees" // the workforce — people + AI coworkers (PRIMARY)
  | "manufacturing-and-delivery" // build/CI/CD/release pipeline (secondary)
  | "foundational"; // infra, platform services, back-office (secondary, deepest inside)

/** The primary, objective triage key. Deadline-bearing sources (bills/expenses/
 *  compliance, BI-AS-4) populate the imminent tiers; the keystone sources have no
 *  hard deadline, so they resolve to "none" and are ordered by risk→blast→age. */
export type TimeToAct = "overdue" | "due-today" | "due-soon" | "none";

/** WHY the governed scopes couldn't resolve it — the honest "why it's here" line.
 *  An inclusive, source-honest superset of the §4.4 illustrative list. */
export type ResidueReason =
  | "coverage-gap" // kernel had no applicable material (DecisionInteraction defer)
  | "principle-conflict" // kernel torn (DecisionInteraction principleConflict)
  | "high-risk-gate" // policy requires a human for this risk (DecisionInteraction escalate)
  | "self-fix-exhausted" // Build Studio could not self-repair (escalation)
  | "input-required" // a coworker needs human input to continue (TaskRun)
  | "needs-credential" // missing credential / authority, NOT judgment (TaskRun auth-required)
  | "policy-approval" // an agent action awaits approval (AgentActionProposal)
  | "new-memory-note" // a coworker's role-local memory gained a new distilled note
  | "no-self-heal" // a platform service is degraded and has no automated repair path (health_alert)
  | "room-stalled"; // a Workroom's drive keeps refusing to advance — typically no accountable owner

/** How much the human must do. The human_cognitive_load cost axis. */
export type DecideEffort = "one-tap" | "review" | "judgment";

/** A bounded, source-specific action. Rendered as a control on the card; the
 *  actual mutation is owned by the source's surface (deep-link) until the decision
 *  modules land (BI-AS-5/6). `open` and `dismiss`/`snooze` are safe in the keystone. */
export type AttentionActionKind =
  | "open-in-context"
  | "dismiss"
  | "snooze"
  | "approve"
  | "reject"
  | "request-changes"
  | "answer";

export type AttentionAction = {
  kind: AttentionActionKind;
  label: string;
  /** Present for navigations; absent for in-place mutations wired in later slices. */
  href?: string;
};

/** The SAME comparable factors on every item, surfaced AS context. No composite score. */
export type AttentionTriage = {
  timeToAct: TimeToAct;
  /** ISO deadline when a hard one exists (bill due, filing deadline, SLA breach). */
  deadlineIso?: string;
  residueReason: ResidueReason;
  /** What/who is blocked until decided — the "if you don't act…" line. */
  blastRadius?: string;
  decideEffort: DecideEffort;
  /** True for actions that cannot be undone — feeds the irreversible-high-risk override. */
  irreversible: boolean;
};

export type AttentionAudience = {
  /** Visible to operators (founder/admin) — the full residue. */
  operator: boolean;
  /** When set, also visible to this principal as their own/role item (worker scope). */
  assigneePrincipalId?: string;
};

/** Optional source facts used by the owner projection. This is still read-model
 * metadata: source rows remain canonical and no parallel attention record is
 * persisted. A source should populate only facts it genuinely owns. */
export type AttentionTechnicalMetadata = {
  workType?: string;
  effort?: string;
  epic?: string;
  ownershipDomain?: string;
  backlogItemId?: string;
  featureBuildId?: string;
  detectedBy?: string;
};

/** Proactivity evidence carried by a coworker-owned source. The existing closed
 * level union remains canonical; owner-facing labels come from
 * PROACTIVITY_LEVEL_COPY (`quiet` renders as “Quiet”). */
export type AttentionProactivity = {
  level: import("@/lib/proactivity/proactivity-types").ProactivityLevel;
  actorId?: string;
  policyId?: string;
};

/** Honest attribution for an agent-authored item (BI-AB12B3D3, ratified contract
 * BI-7D29937E). The byline attributes to the accountable (human × client × session)
 * identity, presented via a thin ROLE label — NEVER a persona name, and never
 * implying a human accountable party the attribution spine can't produce. Always
 * AI-labeled at render (see formatAttentionByline in ./attribution). */
export type AttentionAuthor = {
  /** Role-based presentation label (via resolveAgentRoleLabel), never a persona name. */
  roleLabel: string;
  /** The AI client that produced the work (Claude / Codex / Grok), when known. */
  aiClient?: string;
  /** Trust level (L0–L3) at which it was produced, when known. */
  trustLevel?: string;
};

/** The immutable artifact a governed reviewer was bound to, when the envelope's
 * TaskRun carries one. Read from `TaskRun.a2aMetadata.initiativeReviewBinding`
 * via the canonical parser — the envelope row itself deliberately stores only the
 * approval binding, never raw tool arguments. Flattened for rendering; the
 * nested locator stays canonical in `InitiativeReviewBinding`. */
export type AttentionEnvelopeReviewBinding = {
  /** Readiness gate the receipt would satisfy, e.g. "research". */
  gate: string;
  /** The backlog item under review — the review SUBJECT. */
  itemId: string;
  repositoryFullName: string;
  commitSha: string;
  path: string;
  /** Provider blob id — the bytes the reviewer was allowed to read. */
  providerBlobId: string;
};

/** A proposed CoworkerActionEnvelope, projected for the delegating user who must
 * decide it (BI-7CB2CCDE). Present ONLY on `coworker-envelope` items: an
 * AgentActionProposal item never carries one, so no surface can hand a proposal
 * id to the envelope state machine.
 *
 * Read-model only — `CoworkerActionEnvelope` stays canonical. */
export type AttentionEnvelopeApproval = {
  envelopeId: string;
  /** Agent.agentId of the coworker that proposed the action. */
  coworkerAgentId: string;
  /** The only user who may decide this envelope. */
  delegatingUserId: string;
  manifestActionId: string;
  rationale: string;
  /** Raw stored status. Kept as-is so an unrecognised value renders honestly
   *  rather than being coerced into a known one. */
  status: string;
  taskRunId: string | null;
  expiresAtIso: string | null;
  /** True only while the envelope is `proposed` AND unexpired at the projected
   *  moment. False hides every decision control. */
  actionable: boolean;
  reviewBinding?: AttentionEnvelopeReviewBinding;
  /** Decision-first owner summary (BI-F95B0795). Always present; unknown shapes fail closed. */
  decision: EnvelopeDecisionSummary;
  /** The authenticated envelope state-machine routes (lib/coworker/envelope-routes). */
  approveHref: string;
  declineHref: string;
};

export type AttentionItem = {
  /** Stable per source row, e.g. "escalation:PIR-…", "ai-decision:DI-…". */
  id: string;
  source: AttentionSource;
  title: string;
  /** The honest one-liner: top blocker / question / what + why-paused. */
  context: string;
  /** Scorability governs rendering: kernel-scorable → ledger; unscorable → honest
   *  facts (never a 0.000 verdict). All keystone sources are residue the kernel
   *  already could not decide, so they are "unscorable" by construction. */
  decisionClass: { scorability: "kernel-scorable" | "unscorable" | "org-business" };
  riskClass: AttentionRiskClass;
  triage: AttentionTriage;
  /** ISO creation time — drives the age tie-break and the relative-age label. */
  createdAtIso: string;
  /** The Portfolio this item is classified under, for the OUTSIDE-IN cockpit
   *  (BI-8C3EB52C). Optional: when absent, the cockpit derives a default from the
   *  item's source (see portfolioForSource). A source may set it explicitly when it
   *  knows better than the source-level default. */
  portfolio?: AttentionPortfolio;
  actions: AttentionAction[];
  /** To the owning surface for heavy context; never reimplemented in the inbox. */
  deepLink: string;
  audience: AttentionAudience;
  /** Per-coworker policy when the source resolved one; otherwise the owner
   * projection uses its balanced fallback. */
  proactivity?: AttentionProactivity;
  /** Builder-grade facts preserved for progressive disclosure. */
  technical?: AttentionTechnicalMetadata;
  /** Honest attribution when an AI coworker produced this item (BI-AB12B3D3).
   * Absent for items with no single AI author (e.g. a bill awaiting approval). */
  author?: AttentionAuthor;
  /** The governed coworker action awaiting this reader's decision. Set only by
   * the `coworker-envelope` source (BI-7CB2CCDE). */
  envelope?: AttentionEnvelopeApproval;
};

/**
 * Blast-radius strings that name nothing concrete (BI-79E207B9).
 *
 * A source that cannot say what is actually blocked writes one of these. They
 * read as vague in owner copy, and they are the evidence that a decision has no
 * owner-facing consequence yet — so both the copy layer and the routing layer
 * read this one set rather than each keeping its own list.
 */
export const GENERIC_BLAST_RADIUS: ReadonlySet<string> = new Set([
  "a coworker task",
  "a coworker waiting on approval",
]);

/** True when an item names no concrete consequence. Pure. */
export function namesNoConcreteConsequence(blastRadius: string | null | undefined): boolean {
  const value = (blastRadius ?? "").trim().toLowerCase();
  return value.length === 0 || GENERIC_BLAST_RADIUS.has(value);
}
