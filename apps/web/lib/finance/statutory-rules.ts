// lib/finance/statutory-rules.ts — proposing, ratifying and resolving the
// published figures a payroll actually runs on (BI-8E1FD1BD, BI-4EB27955 item 3).
//
// The tax spine could compute long before this existed; what it could not do was
// name a figure and say where the figure came from. So the engine was correct
// and unusable at the same time.
//
// The rule this module exists to enforce: a coworker may research and PROPOSE,
// a human RATIFIES, and only a ratified figure is ever used to compute money.
// That split is what makes it safe to let an agent read an authority's tables
// at all — the agent's output is a citation for review, never an input to a
// filing. Getting a deposit wrong carries a real penalty, so the gate is a
// value in the type, not a convention in a comment.
//
// Pure and DB-free so every rule is unit-testable; callers load rows and hand
// them in.

/** Mirrors the StatutoryRuleStatus Prisma enum. */
export type StatutoryRuleStatus = "proposed" | "ratified" | "rejected" | "superseded";

/** Mirrors the StatutoryRuleKind Prisma enum. */
export type StatutoryRuleKind = "rate" | "wage_base" | "threshold" | "amount";

export interface ResolvableStatutoryRule {
  id: string;
  taxType: string;
  ruleKind: StatutoryRuleKind;
  side?: string | null;
  taxYear: number;
  /** A rate is a decimal fraction (0.062), never a percentage. */
  value: number;
  status: StatutoryRuleStatus;
  effectiveFrom: Date;
  /** NULL means still open. */
  effectiveTo: Date | null;
  sourceUrl?: string | null;
}

/**
 * The figure in force on `on`, or null when none is.
 *
 * ONLY `ratified` rules are eligible. A proposed rule is a research finding
 * awaiting a human; using one would let an agent's reading of a web page decide
 * what an employee is paid and what is remitted. Null is the correct answer for
 * "nobody has confirmed a figure yet" — the caller must surface it rather than
 * reach for the proposal.
 *
 * effectiveTo is EXCLUSIVE, matching the mileage-rate and deposit-schedule
 * windows, so a rule ending on the 1st does not govern the 1st. Among rules of
 * equal standing the latest effectiveFrom wins, so a mid-year correction
 * supersedes cleanly without anyone editing history.
 */
export function resolveStatutoryRule(
  rules: readonly ResolvableStatutoryRule[],
  on: Date,
  selector: { taxType: string; ruleKind: StatutoryRuleKind; side?: string | null },
): ResolvableStatutoryRule | null {
  const side = selector.side ?? null;
  const covering = rules.filter((rule) => {
    if (rule.status !== "ratified") return false;
    if (rule.taxType !== selector.taxType) return false;
    if (rule.ruleKind !== selector.ruleKind) return false;
    if ((rule.side ?? null) !== side) return false;
    if (rule.effectiveFrom.getTime() > on.getTime()) return false;
    if (rule.effectiveTo === null) return true;
    return rule.effectiveTo.getTime() > on.getTime();
  });

  return (
    [...covering].sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0] ?? null
  );
}

/** Why a proposal was refused. Closed set — a coworker must be able to act on it. */
export type StatutoryProposalRefusal =
  | "missing_source_url"
  | "missing_retrieved_at"
  | "invalid_value"
  | "invalid_window";

export interface StatutoryProposalInput {
  jurisdictionRefId: string;
  taxType: string;
  ruleKind: StatutoryRuleKind;
  side?: string | null;
  taxYear: number;
  value: number;
  currency?: string | null;
  qualifiers?: Record<string, unknown>;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  sourceUrl?: string | null;
  sourceExcerpt?: string | null;
  retrievedAt?: Date | null;
  proposedByAgentId?: string | null;
  notes?: string | null;
}

export type StatutoryProposalCheck =
  | { valid: true }
  | { valid: false; refusal: StatutoryProposalRefusal; detail: string };

/**
 * Refuse a proposal that could not be checked by a human.
 *
 * A citation is not paperwork here: it is the whole difference between a
 * researched figure and a guessed one. Without a source URL and the date it was
 * read, a ratifier has nothing to check against, and "the agent said so"
 * silently becomes the authority for a tax filing.
 *
 * Returned as data rather than thrown — a coworker whose proposal is refused
 * needs to be told which part was missing so it can go and find it.
 */
export function checkStatutoryProposal(input: StatutoryProposalInput): StatutoryProposalCheck {
  if (!input.sourceUrl || input.sourceUrl.trim().length === 0) {
    return {
      valid: false,
      refusal: "missing_source_url",
      detail: "a statutory figure needs the authority's own publication URL before it can be reviewed",
    };
  }
  if (!(input.retrievedAt instanceof Date) || Number.isNaN(input.retrievedAt.getTime())) {
    return {
      valid: false,
      refusal: "missing_retrieved_at",
      detail: "record when the source was read; a citation with no date cannot be re-checked",
    };
  }
  if (!Number.isFinite(input.value) || input.value < 0) {
    return {
      valid: false,
      refusal: "invalid_value",
      detail: "a statutory figure must be a finite, non-negative number",
    };
  }
  if (
    input.effectiveTo instanceof Date &&
    input.effectiveTo.getTime() <= input.effectiveFrom.getTime()
  ) {
    return {
      valid: false,
      refusal: "invalid_window",
      detail: "effectiveTo must be after effectiveFrom",
    };
  }
  return { valid: true };
}

/** Why a ratification was refused. */
export type StatutoryRatifyRefusal = "not_proposed" | "missing_source_url" | "agent_cannot_ratify";

export type StatutoryRatifyCheck =
  | { valid: true }
  | { valid: false; refusal: StatutoryRatifyRefusal; detail: string };

/**
 * Refuse a ratification that would defeat the point of the gate.
 *
 * `agent_cannot_ratify` is the load-bearing one. If an agent could ratify its
 * own proposal the split would be decorative, and the platform would be back to
 * an uncited figure computing withholding — just with an audit trail that made
 * it look reviewed.
 */
export function checkStatutoryRatification(
  rule: Pick<ResolvableStatutoryRule, "status" | "sourceUrl">,
  actor: { kind: "human" | "agent" },
): StatutoryRatifyCheck {
  if (actor.kind !== "human") {
    return {
      valid: false,
      refusal: "agent_cannot_ratify",
      detail: "only a person can ratify a statutory figure; an agent proposes and a human confirms",
    };
  }
  if (rule.status !== "proposed") {
    return {
      valid: false,
      refusal: "not_proposed",
      detail: `only a proposed rule can be ratified; this one is "${rule.status}"`,
    };
  }
  if (!rule.sourceUrl || rule.sourceUrl.trim().length === 0) {
    return {
      valid: false,
      refusal: "missing_source_url",
      detail: "nothing to check the figure against — refuse rather than ratify an uncited rate",
    };
  }
  return { valid: true };
}

/**
 * Which earlier rules a newly ratified rule supersedes.
 *
 * Same jurisdiction, tax type, kind and side, ratified, and starting earlier.
 * Superseding rather than deleting keeps a closed period reproducible: the old
 * figure still exists and still governs the dates it governed.
 */
export function rulesSupersededBy(
  incoming: Pick<ResolvableStatutoryRule, "taxType" | "ruleKind" | "side" | "effectiveFrom">,
  existing: readonly ResolvableStatutoryRule[],
): ResolvableStatutoryRule[] {
  const side = incoming.side ?? null;
  return existing.filter(
    (rule) =>
      rule.status === "ratified" &&
      rule.taxType === incoming.taxType &&
      rule.ruleKind === incoming.ruleKind &&
      (rule.side ?? null) === side &&
      rule.effectiveFrom.getTime() < incoming.effectiveFrom.getTime(),
  );
}

/**
 * What a payroll still cannot compute, given the figures actually ratified.
 *
 * The point is to make an absent figure LOUD. Before this, an install with no
 * rates looked exactly like one with fresh rates — both silent — and the
 * difference only showed up as a payroll that produced nothing.
 */
export function missingRatifiedRules(
  rules: readonly ResolvableStatutoryRule[],
  on: Date,
  required: readonly { taxType: string; ruleKind: StatutoryRuleKind; side?: string | null }[],
): { taxType: string; ruleKind: StatutoryRuleKind; side: string | null }[] {
  return required
    .filter((requirement) => resolveStatutoryRule(rules, on, requirement) === null)
    .map((requirement) => ({
      taxType: requirement.taxType,
      ruleKind: requirement.ruleKind,
      side: requirement.side ?? null,
    }));
}
