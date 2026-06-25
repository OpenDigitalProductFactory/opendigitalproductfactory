// EP-SOVEREIGN-SOC P5 — federation projection of detections / cases.
//
// Spec: docs/superpowers/specs/2026-06-24-sovereign-soc-siem-design.md §5 (Topology B).
//
// The sovereignty boundary is the normalized DETECTION, not the raw log. This
// composes the merged EP-MSP-FEDERATION egress gate (projection-serialization.ts):
// only the allow-listed case/detection summary slices cross a FederationLink;
// the investigation timeline + evidence + any raw payload stay in the customer's
// sovereign estate. A FederatedRecordMirror persists the already-minimized
// projection (never raw data). Pure projection + a thin idempotent mirror upsert;
// the cross-deployment HTTP send/receive ride the federation enroll routes.

import {
  assertNoExcludedEgress,
  projectEstatePayload,
  toCloudEvent,
  type CloudEventEnvelope,
  type ProjectionContractSpec,
  type ProjectionResult,
} from "@dpf/db/projection-serialization";

/** Default security projection contract: only the case + detection SUMMARY
 *  slices cross; investigation timeline + evidence are excluded (raw stays home). */
export const SECURITY_PROJECTION_CONTRACT: ProjectionContractSpec = {
  includeSlices: ["case", "detection"],
  excludeSlices: ["timeline", "evidence", "rawEvent"],
  fieldAllowList: {
    case: ["caseKey", "title", "severity", "status", "verdict", "confidence", "openedAt", "resolvedAt"],
    detection: ["detectionKey", "severity", "status", "riskScore", "firstSeenAt", "lastSeenAt"],
  },
  retentionClass: "compliance-hold",
};

export interface SecurityCaseFullView {
  caseKey: string;
  title: string;
  severity: string;
  status: string;
  verdict: string;
  confidence: string;
  openedAt: string;
  resolvedAt?: string | null;
  /** Excluded by the contract — never crosses the link. */
  timeline?: unknown[];
  /** Excluded by the contract — never crosses the link. */
  evidence?: Record<string, unknown>;
}

/** The raw (pre-projection) payload for a case. The contract + forbidden-field
 *  guard then minimize it — this is NOT what crosses. */
export function rawSecurityCasePayload(c: SecurityCaseFullView): Record<string, unknown> {
  return {
    case: {
      caseKey: c.caseKey,
      title: c.title,
      severity: c.severity,
      status: c.status,
      verdict: c.verdict,
      confidence: c.confidence,
      openedAt: c.openedAt,
      resolvedAt: c.resolvedAt ?? null,
    },
    timeline: c.timeline ?? [],
    evidence: c.evidence ?? {},
  };
}

/** Project a security case to exactly what may cross the link. */
export function projectSecurityCase(
  c: SecurityCaseFullView,
  contract: ProjectionContractSpec = SECURITY_PROJECTION_CONTRACT,
): ProjectionResult {
  return projectEstatePayload(contract, rawSecurityCasePayload(c));
}

/** Build the CloudEvent that crosses the link for a case projection. */
export function buildSecurityCaseCloudEvent(
  linkId: string,
  c: SecurityCaseFullView,
  contract: ProjectionContractSpec = SECURITY_PROJECTION_CONTRACT,
): { event: CloudEventEnvelope; result: ProjectionResult; violations: string[] } {
  const result = projectSecurityCase(c, contract);
  const violations = assertNoExcludedEgress(contract, result.projected);
  const event = toCloudEvent({
    id: `security-case:${c.caseKey}`,
    source: "dpf/security",
    type: "dpf.security.case.projected",
    time: c.openedAt,
    linkId,
    data: result.projected,
  });
  return { event, result, violations };
}

export interface SecurityMirrorResult {
  mirrorId: string;
  projected: Record<string, unknown>;
  excluded: ProjectionResult["excluded"];
  violations: string[];
}

/**
 * Persist the minimized case projection as a FederatedRecordMirror (idempotent
 * on link+type+caseKey). Refuses to persist if the negative-egress proof is
 * non-empty (something forbidden leaked) — fail closed, never store raw data.
 */
export async function projectSecurityCaseToMirror(
  linkId: string,
  c: SecurityCaseFullView,
  contract: ProjectionContractSpec = SECURITY_PROJECTION_CONTRACT,
): Promise<SecurityMirrorResult> {
  const { event, result, violations } = buildSecurityCaseCloudEvent(linkId, c, contract);
  if (violations.length > 0) {
    throw new Error(
      `security projection refused — negative-egress violations: ${violations.join(", ")}`,
    );
  }
  const { prisma } = await import("@dpf/db");
  const mirrorId = `mirror:${linkId}:security-case:${c.caseKey}`;
  await prisma.federatedRecordMirror.upsert({
    where: {
      federationLinkId_recordType_localRecordRef: {
        federationLinkId: linkId,
        recordType: "security-case",
        localRecordRef: c.caseKey,
      },
    },
    update: { payload: event.data as object, syncStatus: "pending" },
    create: {
      mirrorId,
      federationLinkId: linkId,
      recordType: "security-case",
      canonicalSide: "local",
      localRecordRef: c.caseKey,
      syncStatus: "pending",
      payload: event.data as object,
    },
  });
  return { mirrorId, projected: result.projected, excluded: result.excluded, violations };
}
