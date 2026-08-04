import type { DecisionPerspectiveProfile } from "./types";
import { MARK_DPF_PLATFORM_PROFILE } from "./default-profile";
import professionRegistryData from "../../../../docs/professions/registry.json";

// ─── Registry types ─────────────────────────────────────────────────────────

export type ProfessionSource = {
  name: string;
  url: string;
  licenseClass: "open" | "licensed" | "org-supplied";
};

export type ProfessionFamily = {
  professionKey: string;
  label: string;
  roles: string[];
  contextSlugs: string[];
  sources: ProfessionSource[];
  coverageChecklist: string[];
};

export type ProfessionRegistry = {
  version: string;
  description: string;
  families: ProfessionFamily[];
};

export const PROFESSION_REGISTRY = professionRegistryData as ProfessionRegistry;

export type ProfessionAgentIdentity = {
  agentId?: string | null;
  slugId?: string | null;
  roleSlug?: string | null;
  name?: string | null;
};

// ─── DB client surface ───────────────────────────────────────────────────────

type DbProfessionProfile = {
  profileId: string;
  name: string | null;
  kind: string | null;
  scope: Record<string, unknown> | null;
  fallbackProfileId: string | null;
  defaultResolver: Record<string, unknown> | null;
  autonomyPolicy: Record<string, unknown> | null;
  currentVersion: { versionId: string; versionNumber: number; materialFingerprint: string; changeSummary: string; createdAt: Date } | null;
};

export type ProfessionProfileClient = {
  decisionPerspectiveProfile: {
    findUnique(args: {
      where: { profileId: string };
      select: {
        profileId: boolean;
        name: boolean;
        kind: boolean;
        scope: boolean;
        fallbackProfileId: boolean;
        defaultResolver: boolean;
        autonomyPolicy: boolean;
        currentVersion: { select: { versionId: boolean; versionNumber: boolean; materialFingerprint: boolean; changeSummary: boolean; createdAt: boolean } };
      };
    }): Promise<DbProfessionProfile | null>;
  };
};

// ─── Pure registry helpers ───────────────────────────────────────────────────

/**
 * Find the profession family that claims this agent or role slug. Returns
 * `null` when the identifier is not bound to any registered family.
 */
export function findProfessionFamily(agentIdOrSlug: string): ProfessionFamily | null {
  return PROFESSION_REGISTRY.families.find((f) => f.roles.includes(agentIdOrSlug)) ?? null;
}

/**
 * Find a family by its professionKey rather than by a role binding (BI-52839DEA).
 *
 * The identity-driven lookups above answer "which craft does THIS coworker
 * practise". This one answers "does this named craft exist at all", which is
 * what a declared borrow needs: an external development surface has no agent
 * identity to resolve from, so it names the profession it wants to consult and
 * the registry either recognises the name or the call fails closed. Deliberately
 * NOT a fallback for the identity path — an in-portal coworker still resolves
 * from who it is, never from what it asks for.
 */
export function findProfessionFamilyByKey(professionKey: string): ProfessionFamily | null {
  const key = professionKey.trim();
  if (!key) return null;
  return PROFESSION_REGISTRY.families.find((f) => f.professionKey === key) ?? null;
}

function professionIdentityCandidates(identity: ProfessionAgentIdentity): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const raw of [identity.roleSlug, identity.slugId, identity.agentId, identity.name]) {
    const value = raw?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    candidates.push(value);
  }

  return candidates;
}

/**
 * Resolve a profession family from the Agent identity tuple persisted by the
 * seed. Registry-driven agents use AGT-* as Agent.agentId and their role slug
 * as Agent.name; hardcoded coworkers usually use slugId. Keeping that fallback
 * in one helper prevents roster/detail pages from drifting apart.
 */
export function findProfessionFamilyForAgentIdentity(
  identity: ProfessionAgentIdentity,
): ProfessionFamily | null {
  for (const candidate of professionIdentityCandidates(identity)) {
    const family = findProfessionFamily(candidate);
    if (family) return family;
  }
  return null;
}

/**
 * Return the professionKey for a given agent identifier, or `null` when the
 * agent is not registered in any family. Pure function — no DB access needed.
 */
export function professionKeyFromRole(agentIdOrSlug: string): string | null {
  return findProfessionFamily(agentIdOrSlug)?.professionKey ?? null;
}

/**
 * Compute the deterministic profileId for a profession family. Seeded profiles
 * follow this convention: `wsid-${professionKey}`.
 */
export function professionProfileId(professionKey: string): string {
  return `wsid-${professionKey}`;
}

// ─── DB-driven resolver ──────────────────────────────────────────────────────

/**
 * Resolve a profession profile for a given agent identifier or role slug
 * (WSID Phase 1, BI-3AC81394).
 *
 * Resolution path:
 *   agentId / roleSlug → registry family → professionKey → profileId →
 *   DB lookup → DecisionPerspectiveProfile
 *
 * Returns `null` when:
 *   - the identifier maps to no registered family (unbound role)
 *   - the family's profile does not yet exist in the DB (corpus not yet seeded)
 *
 * Mirror of `resolveProfileMaterialForOrg` (BI-230C9EF7): takes an injected
 * `db` client so callers in tests can pass a structural fake without touching
 * a real database.
 */
export async function resolveProfessionProfile(input: {
  db: ProfessionProfileClient;
  agentId?: string;
  agentName?: string | null;
  roleSlug?: string;
  slugId?: string | null;
}): Promise<DecisionPerspectiveProfile | null> {
  const family = findProfessionFamilyForAgentIdentity({
    agentId: input.agentId,
    name: input.agentName,
    roleSlug: input.roleSlug,
    slugId: input.slugId,
  });
  if (!family) return null;

  const profileId = professionProfileId(family.professionKey);

  const row = await input.db.decisionPerspectiveProfile.findUnique({
    where: { profileId },
    select: {
      profileId: true,
      name: true,
      kind: true,
      scope: true,
      fallbackProfileId: true,
      defaultResolver: true,
      autonomyPolicy: true,
      currentVersion: {
        select: {
          versionId: true,
          versionNumber: true,
          materialFingerprint: true,
          changeSummary: true,
          createdAt: true,
        },
      },
    },
  });

  if (!row || !row.currentVersion) return null;

  return {
    profileId: row.profileId,
    name: row.name ?? family.label,
    kind: (row.kind ?? "profession") as DecisionPerspectiveProfile["kind"],
    scope: (row.scope as DecisionPerspectiveProfile["scope"]) ?? { domains: ["professional-practice"], professionKey: family.professionKey, roles: family.roles },
    fallbackProfileId: row.fallbackProfileId,
    defaultResolver: (row.defaultResolver as DecisionPerspectiveProfile["defaultResolver"]) ?? MARK_DPF_PLATFORM_PROFILE.defaultResolver,
    autonomyPolicy: (row.autonomyPolicy as DecisionPerspectiveProfile["autonomyPolicy"]) ?? MARK_DPF_PLATFORM_PROFILE.autonomyPolicy,
    currentVersion: row.currentVersion,
  };
}
