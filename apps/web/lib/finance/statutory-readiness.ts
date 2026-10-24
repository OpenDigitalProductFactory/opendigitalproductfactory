// lib/finance/statutory-readiness.ts — can this install actually run payroll,
// and if not, exactly what is missing (BI-8E1FD1BD).
//
// The defect this closes is silence. An install with no statutory figures
// looked identical to one with fresh, confirmed figures: both said nothing.
// The only symptom was a payroll that produced no liabilities, which reads as
// "nothing was owed" rather than "I could not compute". An absent rate has to
// be louder than a present one.
//
// It also puts the freshness discipline to work. packages/db/src/reference-freshness
// has carried a 90-day ceiling and a deliberate unverified-vs-stale distinction
// since 2026-08-25 with zero consumers anywhere in the codebase — the clock the
// module was written to stop being decorative was decorative again. This is a
// consumer.
//
// Pure and DB-free; callers load rows and hand them in.

// Subpath, not the barrel: the barrel pulls in the Prisma client, and this
// module is pure. The freshness rules are pure too.
import {
  referenceFreshness,
  type ReferenceFreshnessState,
} from "@dpf/db/reference-freshness";
import {
  missingRatifiedRules,
  type ResolvableStatutoryRule,
  type StatutoryRuleKind,
} from "./statutory-rules";

export interface StatutoryRequirement {
  taxType: string;
  ruleKind: StatutoryRuleKind;
  side?: string | null;
  /** Shown to an operator, so name the thing rather than the column. */
  label: string;
}

export interface JurisdictionFreshnessInput {
  jurisdictionRefId: string;
  authorityName: string;
  lastVerifiedAt?: Date | string | null;
  lastResearchedAt?: Date | string | null;
  staleAfterDays?: number | null;
}

export type StatutoryBlocker =
  | { kind: "missing-figure"; label: string; taxType: string; ruleKind: StatutoryRuleKind; side: string | null }
  | { kind: "awaiting-ratification"; label: string; taxType: string; ruleKind: StatutoryRuleKind; side: string | null }
  | { kind: "reference-unverified"; authorityName: string; jurisdictionRefId: string }
  | { kind: "reference-stale"; authorityName: string; jurisdictionRefId: string; ageDays: number | null };

export interface StatutoryReadiness {
  /** True only when nothing blocks a real payroll for this date. */
  canComputePayroll: boolean;
  blockers: StatutoryBlocker[];
  /** Freshness of the authority record itself, for the operator's benefit. */
  referenceState: ReferenceFreshnessState;
}

/**
 * Assess whether a jurisdiction can price a payroll on `on`.
 *
 * Two distinct failures are reported separately, because they need different
 * actions from a person:
 *
 *  - `missing-figure` — nobody has even proposed this yet. Someone must go and
 *    research it.
 *  - `awaiting-ratification` — a coworker proposed it and it is sitting in a
 *    queue. Someone must check the citation and confirm.
 *
 * Collapsing those into "not ready" would hide the fact that the work is
 * already done and only needs a human minute.
 *
 * A stale or never-verified AUTHORITY record blocks too. A figure confirmed
 * against a page nobody has re-read in over the budget is not a figure anyone
 * should be filing on, even though it is technically ratified.
 */
export function assessStatutoryReadiness(
  args: {
    jurisdiction: JurisdictionFreshnessInput;
    rules: readonly ResolvableStatutoryRule[];
    required: readonly StatutoryRequirement[];
    on: Date;
  },
  now: Date = new Date(),
): StatutoryReadiness {
  const blockers: StatutoryBlocker[] = [];

  const missing = missingRatifiedRules(args.rules, args.on, args.required);
  for (const gap of missing) {
    const requirement = args.required.find(
      (candidate) =>
        candidate.taxType === gap.taxType &&
        candidate.ruleKind === gap.ruleKind &&
        (candidate.side ?? null) === gap.side,
    );
    const label = requirement?.label ?? `${gap.taxType} ${gap.ruleKind}`;

    // Is the gap "nobody researched it" or "it is waiting on a human"? A
    // proposal covering the same date means the research is already done.
    const hasProposal = args.rules.some(
      (rule) =>
        rule.status === "proposed" &&
        rule.taxType === gap.taxType &&
        rule.ruleKind === gap.ruleKind &&
        (rule.side ?? null) === gap.side &&
        rule.effectiveFrom.getTime() <= args.on.getTime() &&
        (rule.effectiveTo === null || rule.effectiveTo.getTime() > args.on.getTime()),
    );

    blockers.push({
      kind: hasProposal ? "awaiting-ratification" : "missing-figure",
      label,
      taxType: gap.taxType,
      ruleKind: gap.ruleKind,
      side: gap.side,
    });
  }

  const freshness = referenceFreshness(
    {
      lastVerifiedAt: args.jurisdiction.lastVerifiedAt ?? null,
      lastResearchedAt: args.jurisdiction.lastResearchedAt ?? null,
      staleAfterDays: args.jurisdiction.staleAfterDays ?? null,
    },
    now,
  );

  if (freshness.state === "unverified") {
    blockers.push({
      kind: "reference-unverified",
      authorityName: args.jurisdiction.authorityName,
      jurisdictionRefId: args.jurisdiction.jurisdictionRefId,
    });
  } else if (freshness.state === "stale") {
    blockers.push({
      kind: "reference-stale",
      authorityName: args.jurisdiction.authorityName,
      jurisdictionRefId: args.jurisdiction.jurisdictionRefId,
      ageDays: freshness.ageDays,
    });
  }

  return {
    canComputePayroll: blockers.length === 0,
    blockers,
    referenceState: freshness.state,
  };
}

/**
 * One plain sentence an operator can act on.
 *
 * Deliberately concrete about the count and the next action. "Payroll is not
 * ready" tells a person nothing they can do; "3 figures have never been
 * researched" tells them what to ask for.
 */
export function describeStatutoryReadiness(readiness: StatutoryReadiness): string {
  if (readiness.canComputePayroll) return "Every figure this payroll needs is confirmed and current.";

  const missing = readiness.blockers.filter((b) => b.kind === "missing-figure").length;
  const waiting = readiness.blockers.filter((b) => b.kind === "awaiting-ratification").length;
  const parts: string[] = [];

  if (missing > 0) {
    parts.push(
      missing === 1
        ? "1 figure has not been researched yet"
        : `${missing} figures have not been researched yet`,
    );
  }
  if (waiting > 0) {
    parts.push(
      waiting === 1
        ? "1 researched figure is waiting for someone to confirm it"
        : `${waiting} researched figures are waiting for someone to confirm them`,
    );
  }
  if (readiness.referenceState === "unverified") {
    parts.push("this authority's details have never been checked against its own website");
  } else if (readiness.referenceState === "stale") {
    parts.push("this authority's details are past their re-check date");
  }

  return `This payroll cannot be calculated yet: ${parts.join("; ")}.`;
}
