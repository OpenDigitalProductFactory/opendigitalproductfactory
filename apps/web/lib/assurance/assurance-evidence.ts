// EP-8DC217EB BET-12 — supply-chain assurance runs → ComplianceEvidence.
//
// Spec: docs/superpowers/specs/2026-07-09-governance-finding-contract-design.md §
// "case→evidence generalization".
//
// Mirrors lib/security/compliance.ts's securityCaseToEvidenceInput, but for
// AssuranceRun completions (pnpm-audit scans, CycloneDX BOM generation). Each
// completed run leaves continuous ComplianceEvidence that supply-chain assurance
// ran on the build — closing the "ComplianceEvidence only from security" gap.
//
// The projector is pure; persistence delegates to the generic, source-neutral
// recordComplianceEvidence in lib/governance.

import {
  recordComplianceEvidence,
  type ComplianceEvidenceInput,
} from "@/lib/governance/compliance-evidence";

/** The narrow view of a completed AssuranceRun that the evidence projector reads.
 *  Matches the fields returned/available at the run-creation completion point in
 *  scan-job.ts and bom-job.ts. */
export interface AssuranceRunEvidenceView {
  runId: string;
  adapterKey: string;
  status: string;
  scopeType: string;
  scopeId: string;
  /** Optional human/structured summary of the run (e.g. finding/component count). */
  summary?: string;
  startedAt: Date;
  completedAt?: Date | null;
}

/** Project a completed AssuranceRun into a ComplianceEvidence input (pure). The
 *  evidenceId is keyed on the run so re-recording is idempotent. */
export function assuranceRunToEvidenceInput(
  run: AssuranceRunEvidenceView,
): ComplianceEvidenceInput {
  return {
    evidenceId: `assurance-run:${run.runId}`,
    title: `Supply-chain assurance run ${run.runId} (${run.adapterKey})`,
    evidenceType: "supply-chain-assurance",
    description:
      `Adapter ${run.adapterKey} ran on ${run.scopeType} ${run.scopeId} and ${run.status}. ` +
      `Started ${run.startedAt.toISOString()}` +
      (run.completedAt ? `, completed ${run.completedAt.toISOString()}` : "") +
      (run.summary ? `. Summary: ${run.summary}` : "") +
      ". Continuous evidence that supply-chain assurance runs on every build.",
    status: "active",
  };
}

/** Idempotently record the evidence for one assurance run (upsert on evidenceId).
 *  Thin wrapper over the generic recordComplianceEvidence. */
export async function recordAssuranceRunEvidence(
  run: AssuranceRunEvidenceView,
): Promise<{ evidenceId: string }> {
  return recordComplianceEvidence(assuranceRunToEvidenceInput(run));
}
