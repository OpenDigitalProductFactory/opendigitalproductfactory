import { ALL_ARCHETYPES } from "./archetypes";
import { deriveOperationalValueStream } from "./operational-value-stream";

/**
 * Static-site-safe projection of leaf-authored process models. The public site
 * commits the JSON output, but this function remains the sole derivation path;
 * its drift test prevents the generated artifact becoming a second definition.
 */
export function buildPublicArchetypeProcessProjection() {
  const archetypes = ALL_ARCHETYPES
    .filter((archetype) => archetype.activationProfile?.processProfile?.valueStreams?.length)
    .sort((left, right) => left.archetypeId.localeCompare(right.archetypeId))
    .map((archetype) => {
      const model = deriveOperationalValueStream(archetype);
      return [
        archetype.archetypeId,
        {
          archetypeId: model.archetypeId,
          name: model.archetypeName,
          category: model.category,
          capacityUnit: model.capacityUnit,
          streams: model.streams,
          supportingCapabilities: model.supportingCapabilities,
        },
      ] as const;
    });

  return {
    schemaVersion: 1,
    archetypes: Object.fromEntries(archetypes),
  };
}

export type PublicArchetypeProcessProjection = ReturnType<
  typeof buildPublicArchetypeProcessProjection
>;
