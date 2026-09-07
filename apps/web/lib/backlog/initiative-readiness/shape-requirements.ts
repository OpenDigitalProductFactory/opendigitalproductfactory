/**
 * initiative-readiness.v3 — requirements keyed by (delivery shape, sensitivity,
 * target). Design: docs/superpowers/specs/2026-09-02-work-shape-taxonomy-and-
 * proportional-gates-design.md §4 (gate table) and §5 (kernel rulings 1, 3, 4, 5).
 *
 * The v2 profile tables stay exactly as they were for an item that carries no
 * shape (ruling 5: pre-taxonomy items keep today's behaviour and a done item is
 * never re-blocked). A shaped item is gated by the table below; sensitivity
 * raises the shape (ruling 4: a small fix at high sensitivity owes the large
 * gates) and never lowers it.
 *
 * Principle encoded: no artifact is produced solely to satisfy a gate. A small
 * fix owes a reproduction, the PR gate, a merged SHA and a runtime check —
 * nothing it would not produce anyway.
 */

import type {
  InitiativeReadinessFacts,
  ReadinessCode,
  ReadinessEvidenceState,
  ReadinessSensitivity,
  ReadinessShape,
  ReadinessTarget,
} from "./types";

export type ShapeRequirement = {
  code: ReadinessCode;
  state: ReadinessEvidenceState;
  accountableRole: string;
  failCode?: ReadinessCode;
  allowNotApplicable?: boolean;
};

const RANK: Record<ReadinessShape, number> = { "break-fix": 0, small: 1, medium: 2, large: 3, xlarge: 4 };
const BY_RANK: ReadinessShape[] = ["break-fix", "small", "medium", "large", "xlarge"];

/**
 * Sensitivity raises, never lowers (design §3.2). `high` takes small and medium
 * to the large gates; `elevated` raises one step. break-fix is the expedite lane
 * and is not reshaped by sensitivity: its gate differs in kind (post-hoc
 * review), and a high-sensitivity emergency is still an emergency. xlarge is
 * already the ceiling.
 */
export function effectiveShape(shape: ReadinessShape, sensitivity: ReadinessSensitivity | null | undefined): ReadinessShape {
  if (shape === "break-fix" || shape === "xlarge") return shape;
  if (sensitivity === "high") return RANK[shape] < RANK.large ? "large" : shape;
  if (sensitivity === "elevated") return BY_RANK[Math.min(RANK[shape] + 1, RANK.large)]!;
  return shape;
}

function req(
  code: ReadinessCode,
  state: ReadinessEvidenceState,
  accountableRole: string,
  failCode?: ReadinessCode,
  allowNotApplicable = false,
): ShapeRequirement {
  return { code, state, accountableRole, failCode, allowNotApplicable };
}

/** The design-target requirements every shape shares. */
function common(facts: InitiativeReadinessFacts): ShapeRequirement[] {
  return [
    req("CLASSIFICATION_REQUIRED", facts.classification, "product-owner"),
    req("AUTHORIZATION_DENIED", facts.authorization, "platform-governance"),
  ];
}

function breakFix(facts: InitiativeReadinessFacts, target: ReadinessTarget): ShapeRequirement[] {
  const rows = common(facts);
  if (target === "design" || target === "plan") return rows;
  rows.push(req("CAPSULE_IDENTITY_MISMATCH", facts.capsuleIdentity, "delivery-coordinator"));
  if (target === "implementation") return rows;
  rows.push(
    req("DELIVERY_EVIDENCE_REQUIRED", facts.deliveryEvidence, "delivery-coordinator"),
    // Ruling 1: the expedite lane skips pre-authorisation and owes a
    // post-implementation review within 48 hours by someone other than the declarer.
    req("POST_IMPLEMENTATION_REVIEW_REQUIRED", facts.postImplementationReview ?? "missing", "post-implementation-reviewer", "REVIEW_FAILED"),
  );
  return rows;
}

function small(facts: InitiativeReadinessFacts, target: ReadinessTarget): ShapeRequirement[] {
  const rows = common(facts);
  if (target === "design") return rows;
  rows.push(req("RESEARCH_REQUIRED", facts.research, "design-author"));
  if (target === "plan") return rows;
  rows.push(req("CAPSULE_IDENTITY_MISMATCH", facts.capsuleIdentity, "delivery-coordinator"));
  if (target === "implementation") return rows;
  rows.push(
    req("DELIVERY_EVIDENCE_REQUIRED", facts.deliveryEvidence, "delivery-coordinator"),
    // The runtime check on the live install, or the failing-to-passing test, is
    // the acceptance. No spec, no plan, no reconciliation receipt.
    req("ACCEPTANCE_EVIDENCE_REQUIRED", facts.acceptanceEvidence, "delivery-coordinator"),
  );
  return rows;
}

function medium(facts: InitiativeReadinessFacts, target: ReadinessTarget): ShapeRequirement[] {
  const rows = common(facts);
  if (target === "design") return rows;
  rows.push(
    req("RESEARCH_REQUIRED", facts.research, "design-author"),
    // The item body is the design: acceptance criteria in the body mint the
    // baseline (design §4, "baseline from item, not from spec").
    req("OBJECTIVE_BASELINE_REQUIRED", facts.objectiveBaseline, "product-owner"),
  );
  if (target === "plan") return rows;
  rows.push(
    req("DEPENDENCY_UNRESOLVED", facts.dependencies, "portfolio-management", undefined, true),
    req("CAPSULE_IDENTITY_MISMATCH", facts.capsuleIdentity, "delivery-coordinator"),
  );
  if (target === "implementation") return rows;
  rows.push(
    req("DELIVERY_EVIDENCE_REQUIRED", facts.deliveryEvidence, "delivery-coordinator"),
    // Ruling 3: medium owes an independent acceptance receipt; a coworker qualifies.
    req("ACCEPTANCE_EVIDENCE_REQUIRED", facts.acceptanceEvidence, "acceptance-reviewer"),
  );
  return rows;
}

/**
 * Requirements for a shaped item. `v2` is the profile-keyed table: large keeps
 * every gate the feature/cross-domain/archetype profile owes today (the design
 * changes nothing for large except that reconciliation is scoped to it), and
 * xlarge owes the same at plan but never enters implementation (ruling: the
 * only legal transition is decomposition).
 */
export function shapeRequirements(
  facts: InitiativeReadinessFacts,
  target: ReadinessTarget,
  v2: (facts: InitiativeReadinessFacts, target: ReadinessTarget) => ShapeRequirement[],
): ShapeRequirement[] {
  const shape = effectiveShape(facts.shape!, facts.sensitivity);
  if (shape === "break-fix") return breakFix(facts, target);
  if (shape === "small") return small(facts, target);
  if (shape === "medium") return medium(facts, target);
  if (shape === "large") return v2(facts, target);
  // xlarge
  if (target === "design" || target === "plan") return v2(facts, target);
  return [
    ...v2(facts, "plan"),
    req("DECOMPOSITION_REQUIRED", "fail", "portfolio-owner"),
  ];
}
