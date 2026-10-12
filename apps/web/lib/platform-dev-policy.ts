export type PlatformDevPolicyState = "policy_pending" | "private" | "contributing";

/** Planning targets belong to the funding owner and purpose, never the host or token tier. */
export function resolveDevelopmentInvestmentTarget(scope: {
  budgetOwner: "founder" | "organization" | null;
  workPurpose: "shared-platform" | "archetype" | null;
}): { refactorPercent: number; newWorkPercent: number } | null {
  if (!scope.budgetOwner || !scope.workPurpose) return null;
  return scope.budgetOwner === "founder" && scope.workPurpose === "shared-platform"
    ? { refactorPercent: 80, newWorkPercent: 20 }
    : { refactorPercent: 20, newWorkPercent: 80 };
}

const founderTarget = resolveDevelopmentInvestmentTarget({ budgetOwner: "founder", workPurpose: "shared-platform" })!;
const organizationTarget = resolveDevelopmentInvestmentTarget({ budgetOwner: "organization", workPurpose: "archetype" })!;
export const DEVELOPMENT_INVESTMENT_GUIDANCE = `Development investment: founder-funded shared platform work prioritizes ${founderTarget.refactorPercent}% refactoring, integration and reliability repair, ${founderTarget.newWorkPercent}% new capability. Organization/archetype work retains its owning scope's policy (default ${organizationTarget.refactorPercent}% refactoring, ${organizationTarget.newWorkPercent}% new capability). Establish the funding owner and work purpose from recorded authority; never infer them from the installation, executor or admin grant. These are cumulative planning targets, not per-task token quotas. Repair broken tools, retries and duplicated processes before expanding capability. Keep the founder's reliability priority until an explicit maturity review changes it. If instructions conflict, use the current explicit owner direction within its scope and record the superseded guidance and overlapping work for reconciliation; do not silently combine contradictory plans.`;

export function getPlatformDevPolicyState(
  config: { contributionMode: string | null } | null | undefined,
): PlatformDevPolicyState {
  if (!config) return "policy_pending";
  // 2-state model (EP-1A78BAE1): contributionMode is "private" | "contributing".
  // Legacy values ("fork_only" | "selective" | "contribute_all") are mapped for
  // back-compat in case a row predates the collapse migration.
  const mode = config.contributionMode;
  if (mode === "private" || mode === "fork_only") return "private";
  return "contributing";
}
