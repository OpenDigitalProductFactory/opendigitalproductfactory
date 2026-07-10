// apps/web/lib/governance/severity.ts — EP-8DC217EB BET-12
//
// One canonical severity ladder for the governance findings/evidence plane.
// The four finding streams each carried their own ladder:
//   - wiki lint:      "info" | "warn" | "error"        (LintSeverity)
//   - assurance:      critical|high|medium|low|info     (AssurancePolicySeverity — already this ladder)
//   - security case:  info|low|medium|high|critical     (CaseSeverity + a local SEVERITY_RANK)
//   - detection:      numeric severityId                (a risk-score ladder)
//   - decision review: no severity — postureLabel/riskTier as its ordering axis
//
// This module defines the single ordinal ladder + rank/compare/max helpers and
// the mappers that fold each stream's vocabulary onto it, so a unified findings
// surface can sort and roll up across all four.

/** Canonical governance severity, most severe first. */
export const GOVERNANCE_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type GovernanceSeverity = (typeof GOVERNANCE_SEVERITIES)[number];

/** Ordinal rank — higher is more severe. Unknown strings rank below "info". */
const RANK: Record<GovernanceSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

export function severityRank(severity: GovernanceSeverity): number {
  return RANK[severity];
}

/** Negative when a < b, positive when a > b — for `sort` MOST-severe-first use `compareSeverity(b,a)`. */
export function compareSeverity(a: GovernanceSeverity, b: GovernanceSeverity): number {
  return RANK[a] - RANK[b];
}

/** The more severe of two. */
export function maxSeverity(a: GovernanceSeverity, b: GovernanceSeverity): GovernanceSeverity {
  return RANK[a] >= RANK[b] ? a : b;
}

/** The most severe across a set; `info` when empty. */
export function highestSeverity(severities: GovernanceSeverity[]): GovernanceSeverity {
  return severities.reduce<GovernanceSeverity>((worst, s) => maxSeverity(worst, s), "info");
}

/**
 * Fold a wiki-lint severity ("info"|"warn"|"error") onto the ladder. `error` is
 * the most severe lint level → `high` (security-grade `critical` is reserved for
 * the security/assurance streams); `warn` → `medium`; `info` → `info`.
 */
export function fromLintSeverity(severity: "info" | "warn" | "error"): GovernanceSeverity {
  switch (severity) {
    case "error":
      return "high";
    case "warn":
      return "medium";
    default:
      return "info";
  }
}

/**
 * Fold a security/assurance-style string (info|low|medium|high|critical) onto
 * the ladder. Already the canonical vocabulary; an unrecognized value → `info`.
 */
export function fromLadderString(value: string): GovernanceSeverity {
  return (GOVERNANCE_SEVERITIES as readonly string[]).includes(value)
    ? (value as GovernanceSeverity)
    : "info";
}
