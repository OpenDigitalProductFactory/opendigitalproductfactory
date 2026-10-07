// WWMD autonomy baseline for platform-development work (BI-E30C0F4F).
//
// Spec: docs/superpowers/specs/2026-10-07-autonomy-policy-sources-design.md.
//
// RegulatoryAutonomyPolicy had no writer, so every Build Studio build resolved
// to the no-match default (propose + human control), which cites no regulation,
// and no work-pattern binding could activate. Platform development on any
// install now resolves against this baseline: autopilot, meaning every gate,
// CI and an independent AI review still run, and only human approval is
// removed (operator decision 2026-10-07). Each development coworker's WSID
// grants still bound what it may do inside the ceiling.

/**
 * Every activity class the autonomy code asks about for platform-development
 * work. A new development class must be added here, or it falls to the policy
 * gap rule instead of the baseline.
 */
export const PLATFORM_DEVELOPMENT_ACTIVITY_CLASSES = Object.freeze(["build.implement"] as const);

export type AutonomyPolicySeedRow = {
  policyKey: string;
  industry: string | null;
  jurisdiction: string;
  jurisdictionBasis: string;
  activityClass: string;
  maxAutonomyLevel: string;
  humanControlRequired: boolean;
  requiredEvidence: string[];
  regulationId: string | null;
  rationale: string;
  sourceKind: string;
  status: "active";
};

export function buildWwmdBaselinePolicies(): AutonomyPolicySeedRow[] {
  return PLATFORM_DEVELOPMENT_ACTIVITY_CLASSES.map((activityClass) => ({
    policyKey: `wwmd-baseline:platform-development:${activityClass}`,
    industry: null,
    jurisdiction: "global",
    jurisdictionBasis: "global",
    activityClass,
    maxAutonomyLevel: "autopilot",
    humanControlRequired: false,
    requiredEvidence: ["independent-review", "ci-gate"],
    regulationId: null,
    rationale:
      "WWMD platform-development baseline (operator decision 2026-10-07): every gate, CI and an independent AI review run; human approval is not required.",
    sourceKind: "wwmd-baseline",
    status: "active",
  }));
}

/**
 * A policy may route work to a person only when it names the regulation or the
 * written policy that requires it (operator rule, 2026-10-07). A rationale
 * names a policy with a `policy:` reference.
 */
export function assertHumanControlHasBasis(row: {
  policyKey: string;
  humanControlRequired: boolean;
  regulationId: string | null;
  rationale: string | null;
}): void {
  if (!row.humanControlRequired) return;
  if (row.regulationId && row.regulationId.trim().length > 0) return;
  if (row.rationale && /\bpolicy:\s*\S+/i.test(row.rationale)) return;
  throw new Error(`human_control_without_basis: ${row.policyKey} requires human control but names no regulation or policy`);
}
