// apps/web/lib/coworker-record/variant-axes.ts
// EP-AI-WORKFORCE-001 (HRIS surface) — pure WSID variant-axis normalization,
// kept DB-free so it is unit-testable in parity with the seed's
// `tallyVariantCoverage` without importing the Prisma client.

/**
 * Normalize a WikiPage.metadata blob into the WSID variant axes, applying the
 * same defaults the profession-corpus seed uses: omitted jurisdiction = global;
 * omitted competency = practitioner; omitted archetype = universal
 * (variants spec §4 + archetype axis addendum 2026-06-16).
 */
export function normalizeVariantAxes(
  metadata: unknown,
): { jurisdictions: string[]; level: string; archetypes: string[]; basis: string } {
  const meta = (metadata ?? {}) as Record<string, unknown>;
  const rawJur = meta.professionJurisdiction;
  const jurisdictions =
    Array.isArray(rawJur) && rawJur.length > 0
      ? rawJur.filter((j): j is string => typeof j === "string")
      : ["global"];
  const rawLevel = meta.professionCompetencyLevel;
  const level = typeof rawLevel === "string" ? rawLevel : "practitioner";
  const rawArch = meta.professionArchetype;
  const archetypes =
    Array.isArray(rawArch) && rawArch.length > 0
      ? rawArch.filter((a): a is string => typeof a === "string")
      : ["universal"];
  // Basis defaults: region-neutral pages → "global"; jurisdiction-specific pages
  // with no declared basis → "operating" (parity with the seed default).
  const rawBasis = meta.professionJurisdictionBasis;
  const jurisdictionSpecific = !(jurisdictions.length === 1 && jurisdictions[0] === "global");
  const basis =
    typeof rawBasis === "string" ? rawBasis : jurisdictionSpecific ? "operating" : "global";
  return { jurisdictions, level, archetypes, basis };
}
