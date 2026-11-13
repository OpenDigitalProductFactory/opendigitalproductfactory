import { loadBaselineSourceForItem, type BaselineSourceDb } from "./baseline-source";
import { readinessRequirement } from "./readiness-guidance";
import type { InitiativeReadinessDecision, ReadinessRequirementResult } from "./types";

export function owesPlanCoverage(decision: InitiativeReadinessDecision): boolean {
  return decision.verdict === "input-required" && decision.target === "implementation"
    && [...decision.blockers, ...decision.unmet].some(entry => entry.code === "PLAN_REQUIRED" && entry.state === "missing");
}

/** Delivery closure does not supply the baseline needed by unfinished planning.
 * Read complete own/inherited history: the item's recent activity page cannot
 * prove absence. Any retained rows, even malformed or cyclic, are not absence. */
export async function loadPlanBaselinePrerequisite(args: {
  db: BaselineSourceDb;
  item: { id: string; itemId: string };
  decision?: InitiativeReadinessDecision;
  currentDesignState?: string;
}): Promise<ReadinessRequirementResult | null> {
  if (!args.decision || !owesPlanCoverage(args.decision) || !["verified", "not-applicable"].includes(args.currentDesignState ?? "")) return null;
  const source = await loadBaselineSourceForItem(args.db, args.item);
  if (source.origin !== "none" || source.baselineRows.length > 0 || source.inheritedFromItemId !== null) return null;
  return readinessRequirement({ code: "OBJECTIVE_BASELINE_REQUIRED", state: "missing",
    accountableRole: "design-checklist-reviewer" });
}
