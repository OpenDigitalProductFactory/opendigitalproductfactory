// quality-issue-registry.ts
//
// The lifecycle contract for every PortfolioQualityIssue type.
//
// Why this exists: a detector could previously be added with no declared way to
// CLOSE what it opens. `QUALITY_ISSUE_TYPES` was a bare string union listing 8
// types while the live database held 10 — 8 of them undeclared — because
// `openOrUpdateQualityIssue`'s validation is bypassed by direct
// `prisma.portfolioQualityIssue.upsert` calls in discovery-sync, discovery-runner,
// health-alert-issue and edge-event-correlation. Detectors with no resolver
// accumulated 2,247 open rows over ~2 months before anyone noticed, burying the
// handful of rows that were real signal.
//
// Every type must now declare HOW IT ENDS. `QualityIssueType` is derived from
// this registry, so a detector that emits an unregistered type is a COMPILE
// error rather than a row nobody can close.
//
// This is the mechanism half of the open-issues arc (PRs #3163/#3418/#3424/
// #3437/#3448 fixed the instances; this stops the class recurring).

/** How an open issue of this type is expected to reach `resolved`. */
export type QualityIssueResolver =
  /** A later discovery sweep reconciles it automatically (e.g. the thing came back). */
  | "discovery-sweep-reconcile"
  /** Suppressed at emission — correct outcomes are no longer recorded as issues at all. */
  | "suppressed-at-emission"
  /** A human operator must act (verify, review, decide). */
  | "operator"
  /** An AI coworker owns driving this queue down. */
  | "coworker"
  /** Resolved by the monitoring source that raised it, when the condition clears. */
  | "monitor-clears";

/**
 * Which inventory row an issue of this type is raised ABOUT. This is what makes
 * "the subject went away" machine-checkable: without it, a sweep cannot tell
 * which FK to follow, and issues pinned to rows that no longer exist accumulate
 * forever because nobody can act on them.
 */
export type QualityIssueSubject =
  /** An InventoryEntity, via `PortfolioQualityIssue.inventoryEntityId`. */
  | "entity"
  /** An InventoryRelationship, via `PortfolioQualityIssue.inventoryRelationshipId`. */
  | "relationship"
  /** A portfolio / taxonomy / monitoring scope with no single inventory row. */
  | "scope";

export interface QualityIssueContract {
  /** How this issue reaches `resolved`. */
  resolvedBy: QualityIssueResolver;
  /** Which inventory row this issue is about. */
  subject: QualityIssueSubject;
  /**
   * True when the issue's PREMISE is that its subject is missing — `stale_entity`
   * and `stale_relationship`. For those, the subject coming BACK resolves it.
   *
   * For every other subject-bearing type the premise is the opposite: the subject
   * is present and NEEDS WORK. Those are resolved by the subject GOING AWAY —
   * nobody can review the manufacturer of a device that is no longer on the
   * network. The two directions are duals, and conflating them is what left 179
   * open rows pinned to already-stale entities in the live queue: the recovery
   * backstop only ever looked in the first direction.
   */
  raisedBySubjectAbsence: boolean;
  /**
   * The machine-checkable condition under which the platform closes this WITHOUT
   * human involvement. `null` means nothing auto-closes it — which is only
   * legitimate when `operatorActionable` is true and an `owner` is named,
   * otherwise the type is a permanently-open row generator.
   */
  autoResolveWhen: string | null;
  /** True when a human/coworker can actually do something about it. */
  operatorActionable: boolean;
  /**
   * Open rows expected in a healthy install. 0 means "any open row is drift".
   * A positive number is a budget; exceeding it is the signal to act.
   */
  expectedSteadyState: number;
  /** Who drives this queue down when it exceeds steady state. */
  owner: string;
  /** One line on what the issue means. */
  summary: string;
}

// `satisfies` (not `as const`) so the KEYS stay literal — giving us the
// QualityIssueType union — while each VALUE keeps the uniform
// QualityIssueContract shape. With `as const` the values become literal types and
// indexing by the full key union collapses to `never` on property access.
const REGISTRY = {
  // ── Discovery → portfolio promotion gates ────────────────────────────────
  type_not_promotable: {
    resolvedBy: "suppressed-at-emission",
    subject: "entity",
    raisedBySubjectAbsence: false,
    autoResolveWhen:
      "terminal structural skips (structural-type-gate) are no longer emitted; actionable legacy-list/node-policy cases resolve when a governance.promotion policy is added",
    operatorActionable: true,
    expectedSteadyState: 0,
    owner: "platform:discovery",
    summary: "Entity type is not promotable into the product portfolio.",
  },
  name_not_promotable: {
    resolvedBy: "suppressed-at-emission",
    subject: "entity",
    raisedBySubjectAbsence: false,
    autoResolveWhen:
      "terminal structural skips (name-gate) are no longer emitted — a runtime-shaped name is a correct classification, not a gap",
    operatorActionable: false,
    expectedSteadyState: 0,
    owner: "platform:discovery",
    summary: "Entity name looks like a runtime instance, not a product.",
  },
  no_taxonomy: {
    resolvedBy: "discovery-sweep-reconcile",
    subject: "entity",
    raisedBySubjectAbsence: false,
    autoResolveWhen: "the entity gains a taxonomy attribution on a later sweep",
    operatorActionable: true,
    expectedSteadyState: 0,
    owner: "coworker:inventory-specialist",
    summary: "Entity has no resolvable taxonomy node.",
  },
  no_portfolio_root: {
    resolvedBy: "operator",
    subject: "scope",
    raisedBySubjectAbsence: false,
    autoResolveWhen: "the taxonomy root gains a matching Portfolio row",
    operatorActionable: true,
    expectedSteadyState: 0,
    owner: "platform:discovery",
    summary: "Taxonomy root does not map to a known portfolio.",
  },
  low_confidence_promotion: {
    resolvedBy: "discovery-sweep-reconcile",
    subject: "entity",
    raisedBySubjectAbsence: false,
    autoResolveWhen: "attribution confidence rises above the auto-promote threshold",
    operatorActionable: true,
    expectedSteadyState: 0,
    owner: "coworker:inventory-specialist",
    summary: "Attribution confidence below the auto-promote threshold.",
  },

  // ── Estate freshness ─────────────────────────────────────────────────────
  stale_entity: {
    resolvedBy: "discovery-sweep-reconcile",
    subject: "entity",
    raisedBySubjectAbsence: true,
    autoResolveWhen:
      "the entity is observed active again in a later sweep (reconcile-on-recovery); only MANAGED estate raises at all",
    operatorActionable: true,
    expectedSteadyState: 0,
    owner: "coworker:inventory-specialist",
    summary: "Managed entity was not confirmed in the latest discovery run.",
  },
  stale_relationship: {
    resolvedBy: "discovery-sweep-reconcile",
    subject: "relationship",
    raisedBySubjectAbsence: true,
    autoResolveWhen:
      "the relationship is observed active again in a later sweep (reconcile-on-recovery); only MANAGED topology raises at all",
    operatorActionable: true,
    expectedSteadyState: 0,
    owner: "coworker:inventory-specialist",
    summary: "Managed relationship was not confirmed in the latest discovery run.",
  },

  // ── Identity / enrichment quality ────────────────────────────────────────
  attribution_missing: {
    resolvedBy: "coworker",
    subject: "entity",
    raisedBySubjectAbsence: false,
    autoResolveWhen: "the entity gains a taxonomy or product attribution",
    operatorActionable: true,
    expectedSteadyState: 0,
    owner: "coworker:inventory-specialist",
    summary: "Entity requires taxonomy or product attribution review.",
  },
  taxonomy_attribution_low_confidence: {
    resolvedBy: "coworker",
    subject: "entity",
    raisedBySubjectAbsence: false,
    autoResolveWhen: "attribution confidence rises above the low-confidence threshold",
    operatorActionable: true,
    expectedSteadyState: 0,
    owner: "coworker:inventory-specialist",
    summary: "Entity has low-confidence taxonomy attribution candidates.",
  },
  catalog_match_ambiguous: {
    resolvedBy: "coworker",
    subject: "entity",
    raisedBySubjectAbsence: false,
    autoResolveWhen:
      "identity evidence resolves (manufacturer + normalized version + catalog match), or the subject is observed rather than managed estate",
    operatorActionable: true,
    expectedSteadyState: 0,
    owner: "coworker:inventory-specialist",
    summary: "Entity needs identity review (manufacturer / version / catalog match).",
  },
  lifecycle_unverified: {
    resolvedBy: "coworker",
    subject: "entity",
    raisedBySubjectAbsence: false,
    autoResolveWhen:
      "support lifecycle (supportStatus) becomes known for the entity, or the subject is observed rather than managed estate",
    operatorActionable: true,
    expectedSteadyState: 0,
    owner: "coworker:inventory-specialist",
    summary: "Entity still needs support-lifecycle verification.",
  },
  taxonomy_gap_proposal: {
    resolvedBy: "operator",
    subject: "scope",
    raisedBySubjectAbsence: false,
    autoResolveWhen: "the proposed taxonomy node is accepted or rejected",
    operatorActionable: true,
    expectedSteadyState: 0,
    owner: "operator",
    summary: "A taxonomy gap has been proposed for review.",
  },
  incomplete_detail: {
    resolvedBy: "coworker",
    subject: "entity",
    raisedBySubjectAbsence: false,
    autoResolveWhen: "the missing required fields are populated",
    operatorActionable: true,
    expectedSteadyState: 0,
    owner: "coworker:inventory-specialist",
    summary: "Required detail is missing from the record.",
  },
  enrichment_failed: {
    resolvedBy: "discovery-sweep-reconcile",
    subject: "entity",
    raisedBySubjectAbsence: false,
    autoResolveWhen: "a later enrichment pass succeeds",
    operatorActionable: false,
    expectedSteadyState: 0,
    owner: "platform:discovery",
    summary: "An enrichment pass failed for this record.",
  },

  // ── Operational / monitoring ─────────────────────────────────────────────
  health_alert: {
    resolvedBy: "monitor-clears",
    subject: "scope",
    raisedBySubjectAbsence: false,
    autoResolveWhen: "the underlying health alert clears at the monitoring source",
    operatorActionable: true,
    expectedSteadyState: 0,
    owner: "operator",
    summary: "A monitored health alert is firing against this scope.",
  },
  gateway_connection_needed: {
    resolvedBy: "operator",
    subject: "entity",
    raisedBySubjectAbsence: false,
    autoResolveWhen: "the operator configures the gateway connection",
    operatorActionable: true,
    expectedSteadyState: 0,
    owner: "operator",
    summary: "A discovered gateway needs its connection configured.",
  },
  edge_correlated_incident: {
    resolvedBy: "monitor-clears",
    subject: "scope",
    raisedBySubjectAbsence: false,
    autoResolveWhen: "the correlated edge incident clears",
    operatorActionable: true,
    expectedSteadyState: 0,
    owner: "operator",
    summary: "Correlated incident detected across edge telemetry.",
  },
  journey_failure: {
    resolvedBy: "monitor-clears",
    subject: "scope",
    raisedBySubjectAbsence: false,
    autoResolveWhen:
      "the next watchdog run of the SAME journey passes — the run that raised it is the run that clears it, so a fixed journey closes its own row without operator bookkeeping",
    operatorActionable: true,
    expectedSteadyState: 0,
    owner: "operator",
    summary: "A critical business journey failed its scheduled watchdog run.",
  },
} satisfies Record<string, QualityIssueContract>;

/**
 * The canonical set of quality issue types. Derived from the registry so a type
 * cannot exist without a declared lifecycle — emitting an unregistered type is a
 * compile error, not a permanently-open row.
 */
export type QualityIssueType = keyof typeof REGISTRY;

export const QUALITY_ISSUE_REGISTRY: Record<QualityIssueType, QualityIssueContract> = REGISTRY;

export const QUALITY_ISSUE_TYPES = Object.keys(
  QUALITY_ISSUE_REGISTRY,
) as readonly QualityIssueType[];

export function isKnownQualityIssueType(value: string): value is QualityIssueType {
  return Object.prototype.hasOwnProperty.call(QUALITY_ISSUE_REGISTRY, value);
}

export function qualityIssueContract(type: QualityIssueType): QualityIssueContract {
  return QUALITY_ISSUE_REGISTRY[type];
}

/**
 * Types whose open count should be driven to `expectedSteadyState` by a human or
 * coworker rather than by the platform. These are the queues a proactive owner
 * is accountable for; everything else should self-heal.
 */
export function operatorActionableTypes(): QualityIssueType[] {
  return QUALITY_ISSUE_TYPES.filter((type) => QUALITY_ISSUE_REGISTRY[type].operatorActionable);
}

/**
 * Types raised ABOUT a given inventory row kind, split by which direction of
 * subject change resolves them.
 *
 * `raisedBySubjectAbsence: true`  → the subject coming BACK resolves it.
 * `raisedBySubjectAbsence: false` → the subject GOING AWAY resolves it.
 *
 * Both are derived from the registry rather than listed at the call site, so a
 * new detector inherits the correct self-healing behaviour by declaring its
 * contract — which is the whole point of the registry existing.
 */
export function subjectBearingTypes(
  subject: Exclude<QualityIssueSubject, "scope">,
  raisedBySubjectAbsence: boolean,
): QualityIssueType[] {
  return QUALITY_ISSUE_TYPES.filter(
    (type) =>
      QUALITY_ISSUE_REGISTRY[type].subject === subject
      && QUALITY_ISSUE_REGISTRY[type].raisedBySubjectAbsence === raisedBySubjectAbsence,
  );
}

/**
 * Open-count drift for a live queue snapshot: any type over its declared
 * steady-state budget, worst overrun first. This is the input a proactive sweep
 * (or the weekly token budget allocator) uses to decide what to work on — the
 * platform surfaces its own drift instead of waiting to be noticed.
 */
export function qualityIssueDrift(
  openCountsByType: Readonly<Record<string, number>>,
): Array<{ type: QualityIssueType; open: number; budget: number; over: number; owner: string }> {
  const drift: Array<{
    type: QualityIssueType;
    open: number;
    budget: number;
    over: number;
    owner: string;
  }> = [];
  for (const [rawType, open] of Object.entries(openCountsByType)) {
    if (!isKnownQualityIssueType(rawType)) continue;
    const contract = QUALITY_ISSUE_REGISTRY[rawType];
    const over = open - contract.expectedSteadyState;
    if (over > 0) {
      drift.push({
        type: rawType,
        open,
        budget: contract.expectedSteadyState,
        over,
        owner: contract.owner,
      });
    }
  }
  return drift.sort((a, b) => b.over - a.over);
}
