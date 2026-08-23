import {
  ALL_ARCHETYPES,
  type ArchetypeDefinition,
} from "@dpf/storefront-templates";

import type { OperatingWindow } from "@/lib/storefront/restaurant-capacity";

export function resolveTemplateDefinition(
  archetypeId: string,
): ArchetypeDefinition | undefined {
  return ALL_ARCHETYPES.find((archetype) => archetype.archetypeId === archetypeId);
}

export function templateOperatingWindows(
  definition: ArchetypeDefinition,
): OperatingWindow[] {
  return (definition.schedulingDefaults?.defaultOperatingHours ?? []).map(
    (hours) => ({ day: hours.day, start: hours.start, end: hours.end }),
  );
}
