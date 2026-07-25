import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Prisma, PrismaClient } from "../generated/client/client";
import { ARCHETYPE_SEED_DATA } from "@dpf/storefront-templates/seed";
import { COWORKER_AGENT_SEEDS } from "./workforce-seed.js";
import { isKnownBaseAccessProfile, KNOWN_BASE_ACCESS_PROFILES } from "./occupation-access.js";

// EP-EMPLOYEE-OCCUPATION Phase 1 (BI-442E2B42). Seeds the OccupationProfile
// registry from packages/db/data/occupation_registry.json — the "occupation"
// dimension (a customer's in-trench JOB), config/template, not an identity
// Principal. Mirrors seed-storefront-archetypes.ts.
// Spec: docs/superpowers/specs/2026-07-16-employee-occupation-onboarding-and-role-tailored-workspace-design.md §5.1

const DATA_DIR = join(__dirname, "..", "data");

/** Closed enum for how an occupation may reach a rostered coworker (AGENTS.md §3). */
export const OCCUPATION_INTERACTIONS = ["summon", "assigned-only", "read-only"] as const;
export type OccupationInteraction = (typeof OCCUPATION_INTERACTIONS)[number];

export type OccupationCoworkerGrant = {
  agentSlug: string;
  interaction: OccupationInteraction;
  governanceProfileRef?: string | null;
};

export type OccupationFeatureSurface = {
  tileAllowlist: string[];
  navEmphasis: string[];
  workspaceHomeOccupationId?: string | null;
};

export type OccupationSeed = {
  occupationKey: string;
  label: string;
  summary: string;
  archetypeCategories: string[];
  archetypeIds: string[];
  baseAccessProfile: string;
  wsidProfessionFamily?: string | null;
  featureSurface: OccupationFeatureSurface;
  coworkerRoster: OccupationCoworkerGrant[];
  onboardingCurriculumId: string;
  moverCurriculumId?: string | null;
};

type OccupationRegistryFile = {
  version: string;
  occupations: OccupationSeed[];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (v: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

function readJson<T>(filename: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, filename), "utf-8")) as T;
}

/** The set of archetype categories present in the storefront catalog. */
export function knownArchetypeCategories(): ReadonlySet<string> {
  return new Set(ARCHETYPE_SEED_DATA.map((a) => a.category));
}

/** The set of archetype ids present in the storefront catalog. */
export function knownArchetypeIds(): ReadonlySet<string> {
  return new Set(ARCHETYPE_SEED_DATA.map((a) => a.archetypeId));
}

/** The set of seeded coworker slugs an occupation may roster. */
export function knownCoworkerSlugs(): ReadonlySet<string> {
  return new Set(COWORKER_AGENT_SEEDS.map((c) => c.slugId));
}

export type OccupationValidationRefs = {
  categories: ReadonlySet<string>;
  archetypeIds: ReadonlySet<string>;
  coworkerSlugs: ReadonlySet<string>;
};

/**
 * Referential-integrity validation (spec §7). Throws on the first violation so a
 * bad seed fails closed rather than writing a dangling occupation. Exported so the
 * seed test asserts the shipped registry is clean without a live DB.
 */
export function validateOccupationRegistry(
  occupations: readonly OccupationSeed[],
  refs: OccupationValidationRefs,
): void {
  const seenKeys = new Set<string>();
  for (const occ of occupations) {
    const where = `occupation "${occ.occupationKey}"`;

    if (!occ.occupationKey || !/^[a-z0-9-]+$/.test(occ.occupationKey)) {
      throw new Error(`${where}: occupationKey must be a non-empty kebab-case slug.`);
    }
    if (seenKeys.has(occ.occupationKey)) {
      throw new Error(`${where}: duplicate occupationKey.`);
    }
    seenKeys.add(occ.occupationKey);

    for (const field of ["label", "summary", "baseAccessProfile", "onboardingCurriculumId"] as const) {
      if (typeof occ[field] !== "string" || occ[field].trim().length === 0) {
        throw new Error(`${where}: ${field} must be a non-empty string.`);
      }
    }

    // baseAccessProfile must resolve to a known RBAC floor (P0.1, occupation-access.ts).
    // Fail closed so an occupation can never seed with a dangling security floor the
    // narrowing gate (spec §5.4) would have nothing to narrow within.
    if (!isKnownBaseAccessProfile(occ.baseAccessProfile)) {
      throw new Error(
        `${where}: unknown baseAccessProfile "${occ.baseAccessProfile}" (known: ${KNOWN_BASE_ACCESS_PROFILES.join(", ")}).`,
      );
    }

    if (!Array.isArray(occ.archetypeCategories) || occ.archetypeCategories.length === 0) {
      throw new Error(`${where}: archetypeCategories must be a non-empty array.`);
    }
    for (const cat of occ.archetypeCategories) {
      if (!refs.categories.has(cat)) {
        throw new Error(`${where}: unknown archetype category "${cat}".`);
      }
    }
    for (const id of occ.archetypeIds ?? []) {
      if (!refs.archetypeIds.has(id)) {
        throw new Error(`${where}: unknown archetypeId "${id}".`);
      }
    }

    if (!occ.featureSurface || !Array.isArray(occ.featureSurface.tileAllowlist) || occ.featureSurface.tileAllowlist.length === 0) {
      throw new Error(`${where}: featureSurface.tileAllowlist must be a non-empty array.`);
    }
    if (!Array.isArray(occ.featureSurface.navEmphasis)) {
      throw new Error(`${where}: featureSurface.navEmphasis must be an array.`);
    }

    if (!Array.isArray(occ.coworkerRoster) || occ.coworkerRoster.length === 0) {
      throw new Error(`${where}: coworkerRoster must be a non-empty array.`);
    }
    const seenAgents = new Set<string>();
    for (const grant of occ.coworkerRoster) {
      if (!refs.coworkerSlugs.has(grant.agentSlug)) {
        throw new Error(`${where}: rosters unknown coworker slug "${grant.agentSlug}".`);
      }
      if (seenAgents.has(grant.agentSlug)) {
        throw new Error(`${where}: duplicate coworker "${grant.agentSlug}" in roster.`);
      }
      seenAgents.add(grant.agentSlug);
      if (!OCCUPATION_INTERACTIONS.includes(grant.interaction)) {
        throw new Error(`${where}: coworker "${grant.agentSlug}" has invalid interaction "${grant.interaction}".`);
      }
    }
  }
}

/** Loads and validates the shipped occupation registry. */
export function loadOccupationRegistry(): OccupationSeed[] {
  const registry = readJson<OccupationRegistryFile>("occupation_registry.json");
  validateOccupationRegistry(registry.occupations, {
    categories: knownArchetypeCategories(),
    archetypeIds: knownArchetypeIds(),
    coworkerSlugs: knownCoworkerSlugs(),
  });
  return registry.occupations;
}

export const OCCUPATION_SEED_DATA: readonly OccupationSeed[] = loadOccupationRegistry();

export async function seedOccupations(prisma: PrismaClient): Promise<void> {
  console.log(`[seed] upserting ${OCCUPATION_SEED_DATA.length} occupation profiles…`);

  for (const occ of OCCUPATION_SEED_DATA) {
    await prisma.occupationProfile.upsert({
      where: { occupationKey: occ.occupationKey },
      create: {
        occupationKey: occ.occupationKey,
        label: occ.label,
        summary: occ.summary,
        archetypeCategories: occ.archetypeCategories,
        archetypeIds: occ.archetypeIds ?? [],
        baseAccessProfile: occ.baseAccessProfile,
        wsidProfessionFamily: occ.wsidProfessionFamily ?? null,
        featureSurface: json(occ.featureSurface),
        coworkerRoster: json(occ.coworkerRoster),
        onboardingCurriculumId: occ.onboardingCurriculumId,
        moverCurriculumId: occ.moverCurriculumId ?? null,
        isActive: true,
      },
      update: {
        // isActive intentionally excluded: re-seeding must not reactivate an
        // occupation an operator has soft-deleted (mirrors seed-storefront-archetypes).
        label: occ.label,
        summary: occ.summary,
        archetypeCategories: occ.archetypeCategories,
        archetypeIds: occ.archetypeIds ?? [],
        baseAccessProfile: occ.baseAccessProfile,
        wsidProfessionFamily: occ.wsidProfessionFamily ?? null,
        featureSurface: json(occ.featureSurface),
        coworkerRoster: json(occ.coworkerRoster),
        onboardingCurriculumId: occ.onboardingCurriculumId,
        moverCurriculumId: occ.moverCurriculumId ?? null,
      },
    });
  }

  console.log(`[seed] occupation profiles done`);
}
