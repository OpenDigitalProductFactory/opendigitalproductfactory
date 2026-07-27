import type { RoutingEvidenceConformanceProjection } from "@/lib/ai-operations-map/routing-evidence-conformance";
import {
  reconcileConformanceIssues,
  type ConformanceIssueClient,
  type ConformanceIssueReconcileResult,
} from "./conformance-issue-reconciler";

export const AI_ROUTING_CONFORMANCE_ISSUE_TYPES = [
  "ai-routing-evidence-unattributed",
  "ai-routing-evidence-uncorrelated",
  "ai-routing-evidence-missing",
  "ai-routing-design-unproven",
  "ai-routing-design-stale",
  "ai-routing-observed-path-unexpected",
  "ai-routing-blocked-path-dispatched",
] as const;

/**
 * Reconcile aggregate, privacy-safe routing findings into the shared EA issue
 * lifecycle. One stable issue exists per finding class; transactions remain in
 * their canonical ledgers and are never copied into EA.
 */
export async function reconcileRoutingEvidenceConformance(
  db: ConformanceIssueClient,
  projection: RoutingEvidenceConformanceProjection,
): Promise<ConformanceIssueReconcileResult> {
  return reconcileConformanceIssues(db, {
    issueTypes: [...AI_ROUTING_CONFORMANCE_ISSUE_TYPES],
    findings: projection.findings.map((finding) => ({
      issueKey: finding.issueKey,
      issueType: finding.issueType,
      severity: finding.severity,
      message: finding.message,
      detailsJson: {
        architectureStageId: finding.architectureStageId,
        count: finding.count,
        designRevision: projection.designRevision,
        evidenceSchemaVersion: projection.schemaVersion,
        window: projection.window,
      },
    })),
  });
}
