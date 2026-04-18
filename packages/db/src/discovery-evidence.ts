import type { NormalizedSoftwareEvidence } from "./discovery-normalize";

export type InventoryEvidenceSnapshot = {
  manufacturer: string | null;
  productModel: string | null;
  observedVersion: string | null;
  normalizedVersion: string | null;
  normalizationStatus: string | null;
  hasSoftwareEvidence: boolean;
  supportStatus: "unknown";
};

function scoreIdentityEvidence(evidence: NormalizedSoftwareEvidence): number {
  return (
    (evidence.normalizationStatus === "normalized" ? 100 : 0)
    + ((evidence.normalizationConfidence ?? 0) * 10)
    + (evidence.normalizedVendor ? 5 : 0)
    + (evidence.normalizedProductName ? 5 : 0)
    + (evidence.rawVendor ? 2 : 0)
    + ((evidence.rawProductName || evidence.rawPackageName) ? 2 : 0)
  );
}

function scoreVersionEvidence(evidence: NormalizedSoftwareEvidence): number {
  return (
    (evidence.canonicalVersion ? 100 : 0)
    + (evidence.rawVersion ? 10 : 0)
    + ((evidence.normalizationConfidence ?? 0) * 10)
  );
}

function pickBestEvidence(
  evidence: NormalizedSoftwareEvidence[],
  scorer: (entry: NormalizedSoftwareEvidence) => number,
): NormalizedSoftwareEvidence | null {
  if (evidence.length === 0) {
    return null;
  }

  return [...evidence]
    .sort((left, right) => scoreVersionTieBreak(right) - scoreVersionTieBreak(left) || scorer(right) - scorer(left))[0] ?? null;
}

function scoreVersionTieBreak(evidence: NormalizedSoftwareEvidence): number {
  return evidence.normalizationStatus === "normalized" ? 1 : 0;
}

export function deriveInventoryEvidenceSnapshot(
  evidence: NormalizedSoftwareEvidence[],
): InventoryEvidenceSnapshot {
  const bestIdentity = pickBestEvidence(evidence, scoreIdentityEvidence);
  const bestVersion = pickBestEvidence(evidence, scoreVersionEvidence);

  return {
    manufacturer: bestIdentity?.normalizedVendor ?? bestIdentity?.rawVendor ?? null,
    productModel: bestIdentity?.normalizedProductName
      ?? bestIdentity?.rawProductName
      ?? bestIdentity?.rawPackageName
      ?? null,
    observedVersion: bestVersion?.rawVersion ?? bestIdentity?.rawVersion ?? null,
    normalizedVersion: bestVersion?.canonicalVersion
      ?? (bestVersion?.normalizationStatus === "normalized" ? bestVersion.rawVersion ?? null : null),
    normalizationStatus: bestIdentity?.normalizationStatus ?? bestVersion?.normalizationStatus ?? null,
    hasSoftwareEvidence: evidence.length > 0,
    supportStatus: "unknown",
  };
}
