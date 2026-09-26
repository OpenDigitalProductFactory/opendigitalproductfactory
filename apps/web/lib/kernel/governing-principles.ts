// A refusing gate names the principle that governs it (BI-DEDAC950).
//
// Design: docs/superpowers/specs/2026-09-25-refusals-cite-governing-principle-design.md
//
// Each table maps a gate's refusal code to the `WikiPage.slug` of the page that
// states the rule the code enforces — the same string `wiki_query` returns and
// the same field name the runtime gate already uses (`principleSlug`,
// runtime-gate.ts). A slug is the frontmatter `slug:` when the page has one,
// else `principles/<basename>`; profession pages are `professions/<p>/<name>`.
//
// `null` is a decision, not a gap: it means no page states the rule the code
// enforces. governing-principles.test.ts resolves every non-null slug to its
// page by the seeders' own slug rule, and ratchets the count of nulls so the
// inventory of enforced-but-unwritten rules can only shrink.
//
// Citations travel BESIDE a readiness decision, never inside it: persisted
// decisions are compared by deep equality on replay (evaluate.ts), so a new key
// on a decision or requirement would invalidate every one of them.

import type {
  InitiativeReadinessDecision,
  ReadinessCode,
  ReadinessProfile,
  ReadinessShape,
  ReadinessTarget,
} from "@/lib/backlog/initiative-readiness/types";
import type { GovernedExecuteRejection } from "@/lib/mcp-governed-execute";

const GATES_PROPORTIONAL_TO_SHAPE = "gates-proportional-to-shape";
const DESIGN_RESEARCH_REQUIRED = "principles/design-research-required";
const CONSULT_SCOPES_BEFORE_ASKING = "principles/consult-scopes-before-asking";

/**
 * Total over READINESS_CODES, like GENERIC_REMEDIES in readiness-guidance.ts:
 * a new readiness code must be decided here. Each row was checked against the
 * page's `## Rule` section; a row whose page does not state the rule is null.
 */
export const READINESS_GOVERNING_PRINCIPLE: Record<ReadinessCode, string | null> = {
  // "classify the request before acting ... until the work type is clear enough to route".
  CLASSIFICATION_REQUIRED: "principles/classify-ambiguous-requests-before-acting",
  // Profile- and shape-aware: see researchPrinciple(). This is the feature default.
  RESEARCH_REQUIRED: DESIGN_RESEARCH_REQUIRED,
  // The rule names what each shape owes: "an approved spec, a plan with live
  // backlog coverage", "an independent acceptance receipt", "only ever
  // decomposes", "a post-implementation review within 48 hours".
  SPEC_APPROVAL_REQUIRED: GATES_PROPORTIONAL_TO_SHAPE,
  PLAN_REQUIRED: GATES_PROPORTIONAL_TO_SHAPE,
  PLAN_COVERAGE_REQUIRED: GATES_PROPORTIONAL_TO_SHAPE,
  ACCEPTANCE_EVIDENCE_REQUIRED: GATES_PROPORTIONAL_TO_SHAPE,
  DECOMPOSITION_REQUIRED: GATES_PROPORTIONAL_TO_SHAPE,
  POST_IMPLEMENTATION_REVIEW_REQUIRED: GATES_PROPORTIONAL_TO_SHAPE,
  // "Work is not complete until all four checks pass".
  DELIVERY_EVIDENCE_REQUIRED: "principles/build-gate-mandatory",
  // "Every commit carries a Signed-off-by: trailer".
  ARTIFACT_AUTHOR_REQUIRED: "principles/dco-sign-off-required",
  // "Claim one before you work" — the claim must match the room it names.
  CAPSULE_IDENTITY_MISMATCH: "claim-a-workroom-before-you-work",

  // No page states these rules. governance-approves-evidence-not-provenance
  // governs HOW a gate judges evidence (evidence, not producer), not that a
  // design, review or plan review is owed, so it is not cited for them.
  CANONICAL_DESIGN_REQUIRED: null,
  CANONICAL_DESIGN_AMBIGUOUS: null,
  // gates-proportional-to-shape names only "architecture review" for a large
  // item; the code owes up to six specialist lanes by profile.
  REVIEW_REQUIRED: null,
  REVIEW_FAILED: null,
  BLOCKING_FINDINGS_OPEN: null,
  PLAN_REVIEW_REQUIRED: null,
  TRACEABILITY_INCOMPLETE: null,
  DEPENDENCY_UNRESOLVED: null,
  AUTHORIZATION_DENIED: null,
  OBJECTIVE_RECONCILIATION_REQUIRED: null,
  OBJECTIVE_BASELINE_REQUIRED: null,
  OBJECTIVE_BASELINE_CONFLICT: null,
  ARCHETYPE_PROVISIONING_INCOMPLETE: null,
  ARCHETYPE_COMPLETENESS_FAILED: null,
  // make-silent-failures-observable fits, but has no `## Rule` section.
  READINESS_PROJECTION_FAILED: null,
  STALE_EVIDENCE: null,
};

/**
 * RESEARCH_REQUIRED means different work by profile, like requirementNextAction.
 * A fix's research is the reproduction (small) or design note (medium), which
 * gates-proportional-to-shape states; a fix is never raised past medium.
 * `research-before-implementing` is about verifying external APIs, not this.
 */
export const RESEARCH_PRINCIPLE_BY_PROFILE: Partial<Record<ReadinessProfile, string | null>> = {
  fix: GATES_PROPORTIONAL_TO_SHAPE,
};

const SHAPES_OWING_A_BODY_NOTE: readonly ReadinessShape[] = ["small", "medium"];

function researchPrinciple(profile: ReadinessProfile, shape: ReadinessShape | undefined): string | null {
  // A small or medium item of any profile owes a reproduction or design note, not a spec's research section.
  if (shape && SHAPES_OWING_A_BODY_NOTE.includes(shape)) return GATES_PROPORTIONAL_TO_SHAPE;
  const byProfile = RESEARCH_PRINCIPLE_BY_PROFILE[profile];
  return byProfile === undefined ? READINESS_GOVERNING_PRINCIPLE.RESEARCH_REQUIRED : byProfile;
}

/** The escalate branches of the WWWD directional ladder (decision-perspective/directional-outcome.ts). */
export const DIRECTIONAL_ESCALATION_REASONS = [
  "lexical-fallback",
  "mixed-stance",
  "critical-risk",
  "below-confidence",
  "aligned-not-settled",
  "high-risk",
] as const;
export type DirectionalEscalationReason = (typeof DIRECTIONAL_ESCALATION_REASONS)[number];

export const DIRECTIONAL_ESCALATION_PRINCIPLE: Record<DirectionalEscalationReason, string | null> = {
  // "Escalate only the material decision the applicable doctrine cannot answer."
  // A stance that does not speak to the decision, or points both ways, cannot answer it.
  "below-confidence": CONSULT_SCOPES_BEFORE_ASKING,
  "mixed-stance": CONSULT_SCOPES_BEFORE_ASKING,
  // Unwritten: no page states that a coarse relevance signal must not decide,
  // that critical or high risk goes to the owner regardless of stance, or that
  // matching doctrine is not a prior ruling. BI-74B2A8CD owns the ladder's doctrine.
  "lexical-fallback": null,
  "critical-risk": null,
  "aligned-not-settled": null,
  "high-risk": null,
};

/** The alignment gate's refusal codes (tak/preexecution-control.ts). */
export type AlignmentRefusalCode = Extract<GovernedExecuteRejection, "alignment_denied" | "alignment_escalation_required">;

export const ALIGNMENT_REFUSAL_PRINCIPLE: Record<AlignmentRefusalCode, string | null> = {
  // "the organization's business decisions in WWWD ... no scope's doctrine binds another".
  alignment_denied: "principles/decisions-belong-to-their-scope",
  // "Escalate only the material decision the applicable doctrine cannot answer."
  alignment_escalation_required: CONSULT_SCOPES_BEFORE_ASKING,
};

export type GoverningPrinciples = Partial<Record<ReadinessCode, string>>;

/** `{ code: slug }` for every unmet or blocking code whose rule a page states. */
export function governingPrinciplesFor(decision: InitiativeReadinessDecision): GoverningPrinciples {
  const out: GoverningPrinciples = {};
  // Tolerate a partial decision (a read of a legacy persisted row): a citation is advisory.
  for (const entry of [...(decision.blockers ?? []), ...(decision.unmet ?? [])]) {
    const slug = entry.code === "RESEARCH_REQUIRED"
      ? researchPrinciple(decision.profile, decision.shapeDecision?.effective)
      : READINESS_GOVERNING_PRINCIPLE[entry.code];
    if (slug) out[entry.code] = slug;
  }
  return out;
}

/** Citations for each target of a read projection's `readiness.decisions`. */
export function governingPrinciplesByTarget(
  decisions: Partial<Record<ReadinessTarget, InitiativeReadinessDecision>> | undefined,
): Partial<Record<ReadinessTarget, GoverningPrinciples>> {
  const out: Partial<Record<ReadinessTarget, GoverningPrinciples>> = {};
  for (const [target, decision] of Object.entries(decisions ?? {}) as Array<[ReadinessTarget, InitiativeReadinessDecision]>) {
    if (decision) out[target] = governingPrinciplesFor(decision);
  }
  return out;
}

/**
 * A read projection's readiness summary with `governingPrinciples` keyed by
 * target, BESIDE `decisions` (never inside one).
 */
export function withReadinessGoverningPrinciples<
  T extends { decisions?: Partial<Record<ReadinessTarget, InitiativeReadinessDecision>> },
>(summary: T): T & { governingPrinciples: Partial<Record<ReadinessTarget, GoverningPrinciples>> } {
  return { ...summary, governingPrinciples: governingPrinciplesByTarget(summary?.decisions) };
}

/** The one refusal-message line; null when nothing is cited. */
export function governingRulesLine(principles: GoverningPrinciples): string | null {
  const entries = Object.entries(principles);
  if (entries.length === 0) return null;
  return `Governing rules: ${entries.map(([code, slug]) => `${code} → ${slug}`).join(", ")} (look up with wiki_query).`;
}

/** Append the governing-rules line to a refusal message when there is one. */
export function withGoverningRules(message: string, principles: GoverningPrinciples): string {
  const line = governingRulesLine(principles);
  return line ? `${message} ${line}` : message;
}

/** The escalate branch's citation, spread onto the result only when a page governs it. */
export function directionalEscalationPrinciple(reason: DirectionalEscalationReason): { principleSlug?: string } {
  const slug = DIRECTIONAL_ESCALATION_PRINCIPLE[reason];
  return slug ? { principleSlug: slug } : {};
}

/** Every gate code that cites nothing: the inventory of enforced-but-unwritten rules. */
export function unwrittenRuleInventory(): string[] {
  const nulls = (family: string, table: Record<string, string | null | undefined>) =>
    Object.entries(table).filter(([, slug]) => slug === null).map(([code]) => `${family} ${code}`);
  return [
    ...nulls("readiness", READINESS_GOVERNING_PRINCIPLE),
    ...nulls("research", RESEARCH_PRINCIPLE_BY_PROFILE),
    ...nulls("directional", DIRECTIONAL_ESCALATION_PRINCIPLE),
    ...nulls("alignment", ALIGNMENT_REFUSAL_PRINCIPLE),
  ];
}
