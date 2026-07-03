// Phase 4 — regulation version lineage. Iterating a governance requirement must
// produce an immutable NEW version linked to the one it supersedes, not a silent
// in-place edit. This pure helper computes the create-data for the next version
// from the prior row plus operator overrides; the server action persists it and
// retires the prior version. Keeping the field-copy logic here (not in the action)
// makes it unit-testable without a database.

/** The subset of a Regulation row a new version inherits. */
export type VersionableRegulation = {
  id: string;
  name: string;
  shortName: string;
  jurisdiction: string;
  industry: string | null;
  applicability: unknown;
  sourceType: string;
  sourceUrl: string | null;
  notes: string | null;
  version: number;
};

export type RegulationVersionOverrides = Partial<
  Pick<
    VersionableRegulation,
    "name" | "shortName" | "jurisdiction" | "industry" | "applicability" | "sourceType" | "sourceUrl" | "notes"
  >
> & { effectiveDate?: Date | null; reviewDate?: Date | null };

export type NextRegulationVersion = {
  version: number;
  previousVersionId: string;
  name: string;
  shortName: string;
  jurisdiction: string;
  industry: string | null;
  applicability: unknown;
  sourceType: string;
  sourceUrl: string | null;
  notes: string | null;
  effectiveDate: Date | null;
  reviewDate: Date | null;
};

/**
 * Build the next version's field set from the prior regulation + overrides:
 * inherit everything, bump `version`, and link `previousVersionId` to the prior
 * row. Unspecified overrides carry forward from the prior version.
 */
export function buildNextRegulationVersion(
  prev: VersionableRegulation,
  overrides: RegulationVersionOverrides = {},
): NextRegulationVersion {
  return {
    version: prev.version + 1,
    previousVersionId: prev.id,
    name: overrides.name ?? prev.name,
    shortName: overrides.shortName ?? prev.shortName,
    jurisdiction: overrides.jurisdiction ?? prev.jurisdiction,
    industry: overrides.industry !== undefined ? overrides.industry : prev.industry,
    applicability: overrides.applicability !== undefined ? overrides.applicability : prev.applicability,
    sourceType: overrides.sourceType ?? prev.sourceType,
    sourceUrl: overrides.sourceUrl !== undefined ? overrides.sourceUrl : prev.sourceUrl,
    notes: overrides.notes !== undefined ? overrides.notes : prev.notes,
    effectiveDate: overrides.effectiveDate ?? null,
    reviewDate: overrides.reviewDate ?? null,
  };
}
