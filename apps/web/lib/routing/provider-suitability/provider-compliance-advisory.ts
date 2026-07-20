import { isRecord } from "@/lib/shared/coerce";
import { PROVIDER_COMPLIANCE_SOURCE_REGISTRY } from "@dpf/db/provider-compliance-source-registry";
import type { ProviderReviewPacket } from "./provider-review-packet";

export const PROVIDER_COMPLIANCE_ADVISORY_VERSION = "provider-compliance-advisory.v1" as const;
export const PROVIDER_COMPLIANCE_COLLABORATION_SUMMARY = "Reviewing provider compliance and sovereignty" as const;

export type ProviderComplianceAdvisory = {
  schemaVersion: typeof PROVIDER_COMPLIANCE_ADVISORY_VERSION;
  decision: "recommended" | "conditional" | "not-suitable" | "insufficient-evidence";
  plainLanguageSummary: string;
  safestNextAction: string;
  workloadRestrictions: string[];
  unknowns: string[];
  humanReviewRequired: boolean;
  citations: Array<{
    title: string;
    reference: string;
    sourceClaimId?: string;
    supports: string;
  }>;
};

type AdvisoryValidation =
  | { success: true; value: ProviderComplianceAdvisory }
  | { success: false; error: string };

function unknownField(value: Record<string, unknown>, allowed: readonly string[], path = ""): string | null {
  const field = Object.keys(value).find((key) => !allowed.includes(key));
  return field ? `advisory_unknown_field:${path}${field}` : null;
}

function validText(value: unknown, max: number): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= max
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}

function validTextList(value: unknown, maxItems: number, maxLength: number): value is string[] {
  return Array.isArray(value)
    && value.length <= maxItems
    && value.every((item) => validText(item, maxLength));
}

export function validateProviderComplianceAdvisory(value: unknown): AdvisoryValidation {
  if (!isRecord(value)) return { success: false, error: "advisory_invalid:root" };
  if (JSON.stringify(value).length > 10_000) return { success: false, error: "advisory_invalid:too_large" };
  const rootUnknown = unknownField(value, [
    "schemaVersion",
    "decision",
    "plainLanguageSummary",
    "safestNextAction",
    "workloadRestrictions",
    "unknowns",
    "humanReviewRequired",
    "citations",
  ]);
  if (rootUnknown) return { success: false, error: rootUnknown };
  if (value.schemaVersion !== PROVIDER_COMPLIANCE_ADVISORY_VERSION) {
    return { success: false, error: "advisory_invalid:schemaVersion" };
  }
  if (!["recommended", "conditional", "not-suitable", "insufficient-evidence"].includes(String(value.decision))) {
    return { success: false, error: "advisory_invalid:decision" };
  }
  if (!validText(value.plainLanguageSummary, 1_200)) return { success: false, error: "advisory_invalid:plainLanguageSummary" };
  if (!validText(value.safestNextAction, 800)) return { success: false, error: "advisory_invalid:safestNextAction" };
  if (!validTextList(value.workloadRestrictions, 12, 500)) return { success: false, error: "advisory_invalid:workloadRestrictions" };
  if (!validTextList(value.unknowns, 12, 500)) return { success: false, error: "advisory_invalid:unknowns" };
  if (typeof value.humanReviewRequired !== "boolean") return { success: false, error: "advisory_invalid:humanReviewRequired" };
  if (!Array.isArray(value.citations) || value.citations.length < 1 || value.citations.length > 12) {
    return { success: false, error: "advisory_invalid:citations" };
  }
  for (const [index, citation] of value.citations.entries()) {
    if (!isRecord(citation)) return { success: false, error: `advisory_invalid:citations.${index}` };
    const citationUnknown = unknownField(citation, ["title", "reference", "sourceClaimId", "supports"], `citations.${index}.`);
    if (citationUnknown) return { success: false, error: citationUnknown };
    if (!validText(citation.title, 200) || !validText(citation.reference, 500) || !validText(citation.supports, 500)) {
      return { success: false, error: `advisory_invalid:citations.${index}` };
    }
    if (citation.sourceClaimId !== undefined && !validText(citation.sourceClaimId, 200)) {
      return { success: false, error: `advisory_invalid:citations.${index}.sourceClaimId` };
    }
  }
  return { success: true, value: value as ProviderComplianceAdvisory };
}

const WORKLOAD_TO_EVIDENCE_SCOPE: Record<string, string> = {
  "payments-finance": "financial-records",
  "health-phi": "health-records",
};

function serviceForConnection(connection: ProviderReviewPacket["providerConnections"][number]): string {
  if (connection.executionChannel === "direct-api") {
    if (connection.providerId === "openai") return "api-platform";
    if (connection.providerId === "anthropic") return "anthropic-api";
  }
  if (connection.executionChannel === "local-runtime") return "local-model";
  return `${connection.providerId}-${connection.executionChannel}`;
}

function allows(values: readonly string[], requested: string): boolean {
  return values.includes("*") || values.includes(requested);
}

/**
 * Evidence gate for specialist output. A citation is accepted only when it
 * names a canonical claim, the source is current, and that claim applies to
 * at least one provider/jurisdiction/workload tuple in the minimized packet.
 * Unknown account/service facts deliberately do not satisfy provider-specific
 * claims; the coworker must keep those as unknowns instead of guessing.
 */
export function validateProviderComplianceAdvisoryGrounding(
  advisory: ProviderComplianceAdvisory,
  packet: ProviderReviewPacket,
  now = new Date(),
): { success: boolean; errors: string[] } {
  const errors: string[] = [];
  const jurisdictions = [
    ...packet.businessContext.jurisdictionBasis.operatesIn,
    ...packet.businessContext.jurisdictionBasis.sellsTo,
    ...packet.businessContext.jurisdictionBasis.employsIn,
  ];
  const workloads = packet.recommendation.workloadClasses.map(
    (workload) => WORKLOAD_TO_EVIDENCE_SCOPE[workload] ?? workload,
  );
  const conflictPositions = new Map<string, Set<string>>();

  for (const citation of advisory.citations) {
    const source = PROVIDER_COMPLIANCE_SOURCE_REGISTRY[citation.reference as keyof typeof PROVIDER_COMPLIANCE_SOURCE_REGISTRY];
    if (!source || !citation.sourceClaimId) {
      errors.push(`ungoverned-citation:${citation.reference}`);
      continue;
    }
    const ageDays = (now.getTime() - Date.parse(source.retrievedAt)) / 86_400_000;
    if (ageDays > source.maxAgeDays) {
      errors.push(`stale-source:${citation.reference}`);
      continue;
    }
    const claim = source.claims.find((candidate) => candidate.claimId === citation.sourceClaimId);
    if (!claim) {
      errors.push(`citation-mismatch:${citation.reference}:${citation.sourceClaimId}`);
      continue;
    }
    const applies = packet.providerConnections.some((connection) =>
      allows(claim.appliesTo.providerIds, connection.providerId)
      && allows(claim.appliesTo.services, serviceForConnection(connection))
      && allows(claim.appliesTo.accountClasses, connection.accountClass)
    )
      && jurisdictions.some((jurisdiction) => allows(claim.appliesTo.jurisdictions, jurisdiction))
      && workloads.some((workload) => allows(claim.appliesTo.workloads, workload))
      ;
    if (!applies) errors.push(`scope-mismatch:${citation.reference}:${citation.sourceClaimId}`);
    if (applies && "conflictKey" in claim && "position" in claim && claim.conflictKey && claim.position) {
      const positions = conflictPositions.get(claim.conflictKey) ?? new Set<string>();
      positions.add(claim.position);
      conflictPositions.set(claim.conflictKey, positions);
    }
  }
  if ([...conflictPositions.values()].some((positions) => positions.size > 1)) {
    errors.push("conflicting-evidence:current-authoritative-sources");
  }
  return { success: errors.length === 0, errors };
}

export function parseProviderComplianceAdvisory(content: string): AdvisoryValidation {
  if (content.length > 20_000) return { success: false, error: "advisory_invalid:too_large" };
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = (fenced?.[1] ?? content).trim();
  try {
    return validateProviderComplianceAdvisory(JSON.parse(candidate));
  } catch {
    return { success: false, error: "advisory_invalid:json" };
  }
}

function bullets(values: readonly string[], empty: string): string {
  return values.length > 0 ? values.map((value) => `- ${value}`).join("\n") : `- ${empty}`;
}

/** Deterministic COO rendering: the specialist supplies evidence, but the owner's primary coworker remains the speaker. */
export function formatProviderComplianceAdvisoryForOwner(advisory: ProviderComplianceAdvisory): string {
  const validation = validateProviderComplianceAdvisory(advisory);
  if (!validation.success) throw new Error(validation.error);
  const value = validation.value;
  const references = value.citations.map((citation) => {
    const governed = PROVIDER_COMPLIANCE_SOURCE_REGISTRY[citation.reference as keyof typeof PROVIDER_COMPLIANCE_SOURCE_REGISTRY];
    const label = governed ? `[${governed.title}](${governed.url})`
      : citation.reference.startsWith("/") ? `[${citation.title}](${citation.reference})`
        : `${citation.title} — ${citation.reference}`;
    return `- ${label}\n  Supports: ${citation.supports}`;
  }
  ).join("\n");
  const directAnswer = value.decision === "recommended" ? "Yes."
    : value.decision === "not-suitable" ? "No."
      : value.decision === "conditional" ? "Only if the stated conditions are verified."
        : "Cannot confirm this yet.";
  return [
    directAnswer,
    `My recommendation: ${value.decision}`,
    value.plainLanguageSummary,
    "Workload guardrails",
    bullets(value.workloadRestrictions, "No additional restriction was substantiated."),
    "What we still need to verify",
    bullets(value.unknowns, "No material unknown was reported."),
    `Human review: ${value.humanReviewRequired ? "required before relying on this decision" : "not indicated by the evidence reviewed"}`,
    `Safest next action: ${value.safestNextAction}`,
    "References",
    references,
    "This is decision support, not legal advice. DPF has not changed provider activation or routing eligibility.",
  ].join("\n\n");
}
