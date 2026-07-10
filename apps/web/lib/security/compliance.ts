// EP-SOVEREIGN-SOC P6 — security compliance reporting + evidence.
//
// Spec: docs/superpowers/specs/2026-06-24-sovereign-soc-siem-design.md §4.7.
//
// Composes the existing GRC framework (Control / Obligation / ComplianceEvidence):
//   • buildSecurityComplianceReport — maps SOC activity to the Detect/Respond
//     control families of the major frameworks (NIST CSF, PCI-DSS, HIPAA, SOC 2,
//     CMMC, DORA), evidencing "we detect and respond".
//   • securityCaseToEvidenceInput / recordSecurityCaseEvidence — turn a resolved
//     SecurityCase into continuous ComplianceEvidence (the detect-&-respond proof).
// Reporting is pure; persistence delegates to the generic, source-neutral
// recordComplianceEvidence in lib/governance/compliance-evidence.ts (EP-8DC217EB
// BET-12), so ComplianceEvidence is no longer fed from security alone.

import {
  recordComplianceEvidence,
  type ComplianceEvidenceInput,
} from "@/lib/governance/compliance-evidence";

// Re-export so existing importers of ComplianceEvidenceInput from this module
// keep working after the generic contract moved to lib/governance.
export type { ComplianceEvidenceInput };

export type ComplianceFramework =
  | "NIST-CSF"
  | "PCI-DSS"
  | "HIPAA"
  | "SOC2"
  | "CMMC"
  | "DORA";

export interface ComplianceControlRef {
  /** The control family the SOC evidences — "Detect" or "Respond". */
  controlFamily: "Detect" | "Respond";
  /** Framework-specific control reference. */
  reference: string;
  description: string;
}

export const SECURITY_COMPLIANCE_FRAMEWORKS: Record<ComplianceFramework, ComplianceControlRef[]> = {
  "NIST-CSF": [
    { controlFamily: "Detect", reference: "DE.CM / DE.AE", description: "Continuous monitoring + anomaly/event detection." },
    { controlFamily: "Respond", reference: "RS.AN / RS.MI", description: "Incident analysis + mitigation." },
  ],
  "PCI-DSS": [
    { controlFamily: "Detect", reference: "Req 10 / 11.5", description: "Audit logging + change/intrusion detection." },
    { controlFamily: "Respond", reference: "Req 12.10", description: "Incident response plan + execution." },
  ],
  HIPAA: [
    { controlFamily: "Detect", reference: "164.308(a)(1)(ii)(D)", description: "Information system activity review." },
    { controlFamily: "Respond", reference: "164.308(a)(6)", description: "Security incident procedures." },
  ],
  SOC2: [
    { controlFamily: "Detect", reference: "CC7.2", description: "Monitoring for anomalies + security events." },
    { controlFamily: "Respond", reference: "CC7.3 / CC7.4", description: "Evaluate + respond to security incidents." },
  ],
  CMMC: [
    { controlFamily: "Detect", reference: "AU / SI", description: "Audit + system-integrity monitoring." },
    { controlFamily: "Respond", reference: "IR", description: "Incident response." },
  ],
  DORA: [
    { controlFamily: "Detect", reference: "Art. 10", description: "ICT-related incident detection." },
    { controlFamily: "Respond", reference: "Art. 17", description: "ICT-related incident management." },
  ],
};

export interface SecurityPostureMetrics {
  detections: number;
  openCases: number;
  resolvedCases: number;
  connectedSources: number;
  staleSources: number;
  mttrMinutes?: number;
}

export interface SecurityComplianceReport {
  framework: ComplianceFramework;
  controls: Array<ComplianceControlRef & { evidenced: boolean }>;
  evidencedCount: number;
  metrics: SecurityPostureMetrics;
  summary: string;
}

/**
 * Build a security compliance report for a framework. A Detect-family control is
 * evidenced when the SOC is actively monitoring (sources connected) and producing
 * detections; a Respond-family control when cases are being resolved.
 */
export function buildSecurityComplianceReport(
  framework: ComplianceFramework,
  metrics: SecurityPostureMetrics,
): SecurityComplianceReport {
  const controls = SECURITY_COMPLIANCE_FRAMEWORKS[framework].map((c) => ({
    ...c,
    evidenced:
      c.controlFamily === "Detect"
        ? metrics.connectedSources > 0 && metrics.detections > 0
        : metrics.resolvedCases > 0,
  }));
  const evidencedCount = controls.filter((c) => c.evidenced).length;
  return {
    framework,
    controls,
    evidencedCount,
    metrics,
    summary:
      `${framework}: ${evidencedCount}/${controls.length} SOC control families evidenced — ` +
      `${metrics.detections} detections, ${metrics.resolvedCases} resolved cases, ` +
      `${metrics.connectedSources} sources (${metrics.staleSources} stale).`,
  };
}

// ── Continuous evidence from cases ──────────────────────────────────────────

export interface SecurityCaseEvidenceView {
  caseKey: string;
  title: string;
  severity: string;
  verdict: string;
  status: string;
  openedAt: Date;
  resolvedAt?: Date | null;
}

/** Project a SecurityCase into a ComplianceEvidence input (pure). The evidenceId
 *  is keyed on the case so re-recording is idempotent. */
export function securityCaseToEvidenceInput(
  c: SecurityCaseEvidenceView,
): ComplianceEvidenceInput {
  return {
    evidenceId: `security-case:${c.caseKey}`,
    title: `Security case ${c.caseKey}: ${c.title}`,
    evidenceType: "security-operations",
    description:
      `Detected and ${c.status} (verdict: ${c.verdict}, severity: ${c.severity}). ` +
      `Opened ${c.openedAt.toISOString()}` +
      (c.resolvedAt ? `, resolved ${c.resolvedAt.toISOString()}` : "") +
      ". Continuous evidence that the SOC detects and responds to security events.",
    status: "active",
  };
}

/** Idempotently record the evidence for one case (upsert on evidenceId). Thin
 *  wrapper over the generic recordComplianceEvidence — the security projector
 *  supplies the case-specific shape. */
export async function recordSecurityCaseEvidence(
  c: SecurityCaseEvidenceView,
): Promise<{ evidenceId: string }> {
  return recordComplianceEvidence(securityCaseToEvidenceInput(c));
}
