// apps/web/lib/storefront/resource-vocabulary.ts
//
// Resource-axis vocabulary for storefront owner routes — the labels that keep a
// Restaurant from calling its tables "providers" and its resource page a "rental
// class". Derived from the operational-twin FLOOR profile (the noun SSOT) so
// there is exactly one place that decides a restaurant's countable resource is a
// "table". Consumed by /storefront/team (staff vs tables split) and the new
// /storefront/tables surface.
//
// Design: docs/superpowers/specs/2026-07-22-restaurant-capacity-legibility-design.md

import { ALL_ARCHETYPES, deriveTwinProfile } from "@dpf/storefront-templates";

export interface ResourceVocabulary {
  /**
   * True when the archetype has countable physical capacity units the owner
   * seats/turns (FLOOR tables today). Gates the Tables & Capacity surface and
   * the staff-vs-tables split; false archetypes keep the plain staff Team page.
   */
  hasCapacityResources: boolean;
  /** "Tables & Capacity" — the resource page / tab label. */
  resourceLabel: string;
  /** "table" — the singular resource noun. */
  resourceSingular: string;
  /** "tables" — the plural resource noun. */
  resourcePlural: string;
  /** "Add table" — the add-button label (never "Add Provider"). */
  addResourceButtonLabel: string;
  /** "Staff" — the people-only label for the Team page. */
  staffLabel: string;
  /** "Add staff" — the Team add-button label (never "Add Provider"). */
  addStaffButtonLabel: string;
}

function titleCase(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

/**
 * Resolve resource vocabulary for a storefront's primary archetype. `staffLabel`
 * comes from the archetype vocabulary's `teamLabel` (already "Staff" for a
 * restaurant); the resource axis is derived from the twin profile's resource
 * noun. Total and DB-free — an unknown archetype yields a non-capacity fallback.
 */
export function resolveResourceVocabulary(input: {
  archetypeId: string | null | undefined;
  teamLabel: string;
}): ResourceVocabulary {
  const { archetypeId, teamLabel } = input;
  const def = archetypeId ? ALL_ARCHETYPES.find((a) => a.archetypeId === archetypeId) : undefined;
  const profile = def ? deriveTwinProfile(def) : null;

  // Capacity resources are the physical FLOOR template (restaurant tables). Other
  // physical templates (STORE shelves, BAYS bays) are out of scope for this
  // legibility fix and keep the plain Team page.
  const hasCapacityResources = profile?.template === "FLOOR";
  const singular = profile?.resourceNoun.singular ?? "resource";
  const plural = profile?.resourceNoun.plural ?? "resources";

  return {
    hasCapacityResources,
    resourceLabel: hasCapacityResources ? `${titleCase(plural)} & Capacity` : titleCase(plural),
    resourceSingular: singular,
    resourcePlural: plural,
    addResourceButtonLabel: `Add ${singular}`,
    staffLabel: teamLabel,
    addStaffButtonLabel: `Add ${teamLabel.toLowerCase().replace(/s$/, "") || "staff"}`,
  };
}
