// apps/web/lib/coworker-record/coverage.ts
// EP-AI-WORKFORCE-001 (HRIS surface) — runtime profession-corpus coverage.
//
// Reads the jurisdiction × competency coverage for a profession family from
// WikiPage rows (slug prefix `professions/<key>/`) using the variant axes the
// profession-corpus seed now persists into WikiPage.metadata
// (professionJurisdiction / professionCompetencyLevel). This is the runtime
// parallel of the seed's `tallyVariantCoverage` — same data, queried instead
// of logged. No new column (variants spec §3): metadata is an existing Json
// column. See spec 2026-06-13-ai-coworker-hris-management-surface-design.md §4.

import { prisma } from "@dpf/db";
import {
  PROFESSION_JURISDICTIONS,
  PROFESSION_COMPETENCY_LEVELS,
} from "@dpf/db/wiki-taxonomy";
import { PROFESSION_REGISTRY } from "@/lib/decision-perspective/resolve-profession-profile";
import { normalizeVariantAxes } from "./variant-axes";

export type ProfessionCoverage = {
  professionKey: string;
  label: string;
  pageCount: number;
  /** Count of corpus pages tagged for each jurisdiction (omitted axis = global). */
  jurisdiction: Record<string, number>;
  /** Count of corpus pages at each competency level (omitted = practitioner). */
  competency: Record<string, number>;
  /** Count of corpus pages tagged for each archetype (omitted = universal). */
  archetype: Record<string, number>;
  /** Coverage-checklist knowledge areas declared by the registry for this family. */
  checklist: string[];
  /** True when the family has a registry entry but no published corpus pages. */
  emptyCorpus: boolean;
};

type PageMetaRow = { slug: string; metadata: unknown };

/**
 * Compute the jurisdiction × competency coverage matrix for a profession
 * family from its seeded corpus pages. Returns zeroed axes + emptyCorpus when
 * no pages are seeded yet (the family's profile still participates in the gate
 * via defer — WSID §4.11 rule 2; an empty corpus is the demand signal).
 */
export async function loadProfessionCoverage(
  professionKey: string,
): Promise<ProfessionCoverage> {
  const family = PROFESSION_REGISTRY.families.find((f) => f.professionKey === professionKey);

  const jurisdiction: Record<string, number> = Object.fromEntries(
    PROFESSION_JURISDICTIONS.map((j: string) => [j, 0]),
  );
  const competency: Record<string, number> = Object.fromEntries(
    PROFESSION_COMPETENCY_LEVELS.map((l: string) => [l, 0]),
  );
  // Archetype counts start empty and grow as archetype-specific pages appear —
  // most families are still universal-only, so listing all 20 slugs would be noise.
  const archetype: Record<string, number> = {};

  const pages = (await prisma.wikiPage
    .findMany({
      where: {
        slug: { startsWith: `professions/${professionKey}/` },
        status: "published",
      },
      select: { slug: true, metadata: true },
    })
    .catch(() => [])) as PageMetaRow[];

  for (const page of pages) {
    const { jurisdictions, level, archetypes } = normalizeVariantAxes(page.metadata);
    for (const jur of jurisdictions) {
      jurisdiction[jur] = (jurisdiction[jur] ?? 0) + 1;
    }
    competency[level] = (competency[level] ?? 0) + 1;
    for (const arch of archetypes) {
      archetype[arch] = (archetype[arch] ?? 0) + 1;
    }
  }

  return {
    professionKey,
    label: family?.label ?? professionKey,
    pageCount: pages.length,
    jurisdiction,
    competency,
    archetype,
    checklist: family?.coverageChecklist ?? [],
    emptyCorpus: pages.length === 0,
  };
}
