import {
  BUSINESS_CAPABILITY_SEED_PREFIX,
  resolveBusinessCapabilityPerspective,
  type BusinessCapabilityPerspectiveSource,
} from "@dpf/db/business-capability-perspectives";

import type { BusinessCapabilityRecord } from "./data";

export type BusinessCapabilityArchetypeContext = {
  archetypeId: string;
  category: string;
  name: string;
};

export type BusinessCapabilityProvenance = {
  activePerspectiveLabel: string;
  sourcePerspectiveIds: string[];
  sources: BusinessCapabilityPerspectiveSource[];
  archetypeId: string | null;
  archetypeLabel: string | null;
  category: string | null;
  projectionStatus: "seed-projected" | "manual-or-empty";
  seedCapabilityCount: number;
};

export function buildCapabilityProvenance({
  archetype,
  records,
}: {
  archetype: BusinessCapabilityArchetypeContext | null;
  records: BusinessCapabilityRecord[];
}): BusinessCapabilityProvenance {
  const resolved = resolveBusinessCapabilityPerspective({
    archetypeId: archetype?.archetypeId ?? null,
    category: archetype?.category ?? null,
  });
  const seedCapabilityCount = records.filter((record) =>
    record.capabilityId.startsWith(BUSINESS_CAPABILITY_SEED_PREFIX),
  ).length;

  return {
    activePerspectiveLabel: resolved.sources.map((source) => source.label).join(" + "),
    sourcePerspectiveIds: resolved.sourcePerspectiveIds,
    sources: resolved.sources,
    archetypeId: archetype?.archetypeId ?? null,
    archetypeLabel: archetype?.name ?? null,
    category: archetype?.category ?? null,
    projectionStatus: seedCapabilityCount > 0 ? "seed-projected" : "manual-or-empty",
    seedCapabilityCount,
  };
}
