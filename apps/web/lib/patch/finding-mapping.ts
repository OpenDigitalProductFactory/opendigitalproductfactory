// Translate a patch-domain finding (from the packages/db projector) into the canonical
// NormalizedAssuranceFinding vocabulary before it is persisted to the Assurance Ledger.
//
// The projector speaks patch terms (findingKind patch-gap|vulnerability|end-of-life,
// affectedType DiscoveredSoftwareEvidence). The Assurance Ledger has its own closed
// enums (AGENTS.md §3). This pure mapper is the only place that bridge happens.

import type { PatchFindingUpsert } from "@dpf/db/patch";

import type {
  AssuranceAffectedType,
  AssuranceFindingKind,
  AssurancePolicySeverity,
  NormalizedAssuranceFinding,
} from "../assurance/types";

// patch-domain findingKind -> canonical AssuranceFindingKind.
const FINDING_KIND_MAP: Record<string, AssuranceFindingKind> = {
  vulnerability: "vulnerability",
  "patch-gap": "missing-patch",
  "end-of-life": "unsupported-component",
};

const POLICY_SEVERITIES = new Set<AssurancePolicySeverity>(["critical", "high", "medium", "low", "info"]);

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value ? value : null;
}

function toPolicySeverity(value: string): AssurancePolicySeverity {
  return POLICY_SEVERITIES.has(value as AssurancePolicySeverity) ? (value as AssurancePolicySeverity) : "info";
}

/** A CVE/GHSA-backed identifier is stable; a synthetic `pm:pkg` one is weak. */
function identifierStability(vendorIdentifier: string): "strong" | "weak" {
  return /^(CVE-|GHSA-)/i.test(vendorIdentifier) ? "strong" : "weak";
}

/**
 * Map a projector finding to a NormalizedAssuranceFinding. The affected entity is the
 * host (`inventory-entity`); the specific software + version live in evidence and the
 * stable `findingKey` (`patch:<evidenceKey>`), so multiple software findings per host
 * stay distinct.
 */
export function toNormalizedAssuranceFinding(finding: PatchFindingUpsert): NormalizedAssuranceFinding {
  const findingKind = FINDING_KIND_MAP[finding.findingKind] ?? "missing-patch";
  const affectedId = readString(finding.source, "inventoryEntityId") ?? finding.affectedId;
  const affectedType: AssuranceAffectedType = "inventory-entity";
  return {
    findingKey: finding.findingKey,
    adapterKey: finding.adapterKey,
    findingKind,
    affectedType,
    affectedId,
    vendorIdentifier: finding.vendorIdentifier,
    title: finding.title,
    description: finding.description,
    policySeverity: toPolicySeverity(finding.policySeverity),
    releaseImpact: "track", // estate patch posture informs; it does not gate releases
    reachability: "unknown",
    exposure: "unknown",
    identifierStability: identifierStability(finding.vendorIdentifier),
    evidence: { ...finding.source },
    remediationHint: { ...finding.remediationHint },
  };
}
