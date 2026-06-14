// apps/web/lib/coworker-record/variant-axes.ts
// EP-AI-WORKFORCE-001 (HRIS surface) — pure WSID variant-axis normalization,
// kept DB-free so it is unit-testable in parity with the seed's
// `tallyVariantCoverage` without importing the Prisma client.

/**
 * Normalize a WikiPage.metadata blob into the WSID variant axes, applying the
 * same defaults the profession-corpus seed uses: omitted jurisdiction = global;
 * omitted competency = practitioner (variants spec §4).
 */
export function normalizeVariantAxes(metadata: unknown): { jurisdictions: string[]; level: string } {
  const meta = (metadata ?? {}) as Record<string, unknown>;
  const rawJur = meta.professionJurisdiction;
  const jurisdictions =
    Array.isArray(rawJur) && rawJur.length > 0
      ? rawJur.filter((j): j is string => typeof j === "string")
      : ["global"];
  const rawLevel = meta.professionCompetencyLevel;
  const level = typeof rawLevel === "string" ? rawLevel : "practitioner";
  return { jurisdictions, level };
}
