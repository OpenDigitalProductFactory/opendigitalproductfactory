import { resolveCanonicalAgentId } from "@dpf/db/agent-identity";

/**
 * Platform-universal orchestrators every install must cover. They are not
 * standing-room specialists and must not be authored onto leaf archetypes.
 * `coo-orchestrator` aliases `coo` / AGT-ORCH-000 in coverage identity.
 */
export const PLATFORM_ORCHESTRATOR_SLUGS = [
  "coo-orchestrator",
  "evaluate-orchestrator",
  "explore-orchestrator",
  "integrate-orchestrator",
  "deploy-orchestrator",
  "release-orchestrator",
  "consume-orchestrator",
  "operate-orchestrator",
  "governance-orchestrator",
] as const;

export type RosterCoverage = {
  archetypeId: string | null;
  required: string[];
  staffed: string[];
  missing: string[];
  staffedCount: number;
  requiredCount: number;
};

/**
 * `coo-orchestrator` is the registry / Phase H name; identity maps `coo` to
 * AGT-ORCH-000 and leaves `coo-orchestrator` as a passthrough. Coverage must
 * treat those three as one role.
 */
function resolveCoverageId(id: string): string {
  const slug = id === "coo-orchestrator" ? "coo" : id;
  return resolveCanonicalAgentId(slug);
}

function uniqueByCanonical(slugs: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const slug of slugs) {
    const canonical = resolveCoverageId(slug);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(slug);
  }
  return out;
}

/** Archetype roster ∪ the nine orchestrators, unique by canonical agent id. */
export function requiredCoverageSlugs(archetypeRosterSlugs: readonly string[]): string[] {
  return uniqueByCanonical([...archetypeRosterSlugs, ...PLATFORM_ORCHESTRATOR_SLUGS]);
}

/**
 * Compare required coworker slugs to live staffed agent ids/slugs.
 * Staffed count is how many required roles are filled, not how many coworkers exist.
 */
export function measureRosterCoverage(input: {
  required: readonly string[];
  staffed: readonly string[];
}): Pick<RosterCoverage, "required" | "staffed" | "missing" | "staffedCount" | "requiredCount"> {
  const required = uniqueByCanonical(input.required);
  const staffedCanonical = new Set(input.staffed.map((id) => resolveCoverageId(id)));
  const staffed = required.filter((slug) => staffedCanonical.has(resolveCoverageId(slug)));
  const missing = required.filter((slug) => !staffedCanonical.has(resolveCoverageId(slug)));
  return {
    required,
    staffed,
    missing,
    staffedCount: staffed.length,
    requiredCount: required.length,
  };
}
