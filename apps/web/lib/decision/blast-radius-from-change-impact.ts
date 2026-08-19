// apps/web/lib/decision/blast-radius-from-change-impact.ts
//
// A-POSTERIORI blast radius for the decision-altitude control plane
// (EP-7B169558 / BI-22250BA2, which is the planned BI-CFEB2B22 P3).
//
// The warrant's promote-time blast radius is an INTERIM keyword heuristic
// (deriveDeliverableSensitivity). Once a build has produced a diff, we have a
// real, code-derived measure: analyzeChangeImpact() already parses the diff into
// routes/schema/impacted-roles/riskLevel plus a code-graph coverage summary.
// This maps that report onto the warrant's BlastRadius so the verify-time signal
// can CONFIRM or CORRECT the promote-time altitude — one blast-radius core, not
// two parallel ones.
//
// Pure: no DB, no graph traversal here. The caller supplies the report.

import type { ChangeImpactReport } from "@/lib/build/change-impact";
import type { BlastRadius } from "./work-warrant";

/**
 * Map a ChangeImpactReport onto the warrant's BlastRadius.
 *
 * - `downstreamCount` — graded reach: files the diff touches plus the distinct
 *   platform roles it reaches. (The code-graph summary reports index COVERAGE,
 *   not a dependents count, so it can't supply a reach number today.)
 * - `touchesCoreContract` — a schema change or a DELETED route breaks existing
 *   consumers by definition. New/modified routes are additive and don't qualify
 *   on their own.
 * - `riskLevel` — passed through; ChangeImpactReport and the warrant share the
 *   same low|medium|high|critical union.
 */
export function blastRadiusFromChangeImpact(report: ChangeImpactReport): BlastRadius {
  const b = report.blastRadius;
  return {
    downstreamCount: b.totalFilesChanged + report.impactedRoles.length,
    touchesCoreContract: b.schemaChanges > 0 || b.deletedRoutes > 0,
    riskLevel: report.riskLevel,
  };
}
