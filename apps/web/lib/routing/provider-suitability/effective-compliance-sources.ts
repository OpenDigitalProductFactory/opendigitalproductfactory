import {
  PROVIDER_COMPLIANCE_SOURCE_REGISTRY,
  type ProviderComplianceSourceEntry,
} from "@dpf/db/provider-compliance-source-registry";

type SourceEvidenceRow = {
  sourceKey: string;
  retrievedAt: Date | null;
  locator: unknown;
};

type SourceEvidenceDb = {
  rawSource: {
    findMany(args: {
      where: { sourceKey: { in: string[] } };
      select: { sourceKey: true; retrievedAt: true; locator: true };
    }): Promise<SourceEvidenceRow[]>;
  };
};

export type EffectiveProviderComplianceSourceRegistry = Record<string, ProviderComplianceSourceEntry>;

function reviewDecision(locator: unknown): string | null {
  if (!locator || typeof locator !== "object" || Array.isArray(locator)) return null;
  const review = (locator as Record<string, unknown>).review;
  if (!review || typeof review !== "object" || Array.isArray(review)) return null;
  return typeof (review as Record<string, unknown>).decision === "string"
    ? (review as Record<string, string>).decision
    : null;
}

/** Merge mutable, human-reviewed retrieval evidence onto the governed corpus. */
export function mergeProviderComplianceSourceEvidence(
  rows: SourceEvidenceRow[],
): EffectiveProviderComplianceSourceRegistry {
  const evidence = new Map(rows.map((row) => [row.sourceKey, row]));
  return Object.fromEntries(
    Object.values(PROVIDER_COMPLIANCE_SOURCE_REGISTRY).map((source) => {
      const row = evidence.get(source.sourceKey);
      const confirmedAt = row?.retrievedAt
        && reviewDecision(row.locator) === "confirmed"
        && row.retrievedAt.getTime() > Date.parse(source.retrievedAt)
          ? row.retrievedAt.toISOString()
          : source.retrievedAt;
      return [source.sourceKey, { ...source, retrievedAt: confirmedAt }];
    }),
  );
}

export async function loadEffectiveProviderComplianceSources(
  db: SourceEvidenceDb,
): Promise<EffectiveProviderComplianceSourceRegistry> {
  const rows = await db.rawSource.findMany({
    where: { sourceKey: { in: Object.keys(PROVIDER_COMPLIANCE_SOURCE_REGISTRY) } },
    select: { sourceKey: true, retrievedAt: true, locator: true },
  });
  return mergeProviderComplianceSourceEvidence(rows);
}
