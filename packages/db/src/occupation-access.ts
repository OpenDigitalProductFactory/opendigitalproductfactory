// EP-EMPLOYEE-OCCUPATION P0.1 (BI-6A79A315). The base RBAC access floor an
// occupation sits on. Kernel-ratified (principle_decide DI-4F72F64B6C5B): a
// customer's in-trench employees get a dedicated HR-600 "Workforce Member" role,
// NOT a reused platform-management role — decoupling them from the HR-000..HR-500
// ladder. Occupation FOCUSES the surface; this profile is the security floor it
// narrows within (spec §5.6, §5.4 non-widening invariant).
//
// Single source of truth for the slug -> platform-role binding: the occupation
// registry references a baseAccessProfile slug (packages/db/data/occupation_registry.json),
// and this map is the only place that slug becomes a concrete RBAC role. Both the
// seed validator (packages/db) and the workspace resolver (apps/web, via @dpf/db)
// consume it so the mapping never forks.

export const BASE_ACCESS_PROFILE_TO_ROLE = {
  "workforce-member": "HR-600",
} as const;

export type BaseAccessProfileSlug = keyof typeof BASE_ACCESS_PROFILE_TO_ROLE;

/** All base-access-profile slugs an occupation may declare. */
export const KNOWN_BASE_ACCESS_PROFILES: readonly BaseAccessProfileSlug[] =
  Object.keys(BASE_ACCESS_PROFILE_TO_ROLE) as BaseAccessProfileSlug[];

export function isKnownBaseAccessProfile(slug: string): slug is BaseAccessProfileSlug {
  return Object.prototype.hasOwnProperty.call(BASE_ACCESS_PROFILE_TO_ROLE, slug);
}

/** Resolve a base-access-profile slug to its platform role id, or null if unknown. */
export function resolveBaseAccessRole(slug: string): string | null {
  return isKnownBaseAccessProfile(slug) ? BASE_ACCESS_PROFILE_TO_ROLE[slug] : null;
}
