import type {
  ActivationProfile,
  ArchetypeModule,
  ArchetypeProcessProfile,
} from "./types";

const INERT_PROCESS_PROFILE: ArchetypeProcessProfile = {
  catalogModes: [],
  subjectTypes: [],
  housesSubjects: false,
  schedulesSubjects: false,
  resourceKinds: [],
};

/**
 * Merge a sequence of activation profiles (primary first) into one composite
 * profile. Primary drives all scalar fields; secondaries contribute their
 * modules and seeded catalogue entries additively.
 *
 * Monotonic union rules (per spec §8.2):
 *   - billingReadinessMode: "prepared-not-prescribed" wins if any profile requires it
 *   - customerGraph: "separate-customer-projection" wins if any profile requires it
 *   - estateSeparation: "strict" wins if any profile requires it
 *
 * capabilityOverrides: primary wins on any conflicting capabilityKey; secondary
 * overrides for keys not in primary are included unchanged.
 *
 * Pure — no Prisma, no side effects.
 */
export function mergeActivationProfiles(
  profiles: ActivationProfile[],
): ActivationProfile {
  if (profiles.length === 0) throw new Error("mergeActivationProfiles: empty");
  const [primary, ...secondaries] = profiles as [ActivationProfile, ...ActivationProfile[]];
  if (secondaries.length === 0) return primary;

  const allModules = Array.from(
    new Set<ArchetypeModule>([
      ...primary.modules,
      ...secondaries.flatMap((s) => s.modules),
    ]),
  );

  const allServiceCategories = Array.from(
    new Set([
      ...(primary.seededServiceCategories ?? []),
      ...secondaries.flatMap((s) => s.seededServiceCategories ?? []),
    ]),
  );

  const mergeByKey = <T extends { key: string }>(values: T[]): T[] => {
    const byKey = new Map<string, T>();
    for (const value of values) {
      if (!byKey.has(value.key)) byKey.set(value.key, value);
    }
    return Array.from(byKey.values());
  };

  const secondaryOverrides = secondaries.flatMap((s) => s.capabilityOverrides ?? []);
  const primaryKeys = new Set((primary.capabilityOverrides ?? []).map((o) => o.capabilityKey));
  const mergedOverrides = [
    ...(primary.capabilityOverrides ?? []),
    ...secondaryOverrides.filter((o) => !primaryKeys.has(o.capabilityKey)),
  ];

  const processProfiles = profiles.map(
    (profile) => profile.processProfile ?? INERT_PROCESS_PROFILE,
  );
  const processResourceKindsBySlug = new Map<
    string,
    ArchetypeProcessProfile["resourceKinds"][number]
  >();
  for (const processProfile of processProfiles) {
    for (const resourceKind of processProfile.resourceKinds) {
      if (!processResourceKindsBySlug.has(resourceKind.kindSlug)) {
        processResourceKindsBySlug.set(resourceKind.kindSlug, resourceKind);
      }
    }
  }
  const processProfile: ArchetypeProcessProfile = {
    catalogModes: Array.from(
      new Set(processProfiles.flatMap((profile) => profile.catalogModes)),
    ),
    subjectTypes: Array.from(
      new Set(processProfiles.flatMap((profile) => profile.subjectTypes)),
    ),
    housesSubjects: processProfiles.some((profile) => profile.housesSubjects),
    schedulesSubjects: processProfiles.some((profile) => profile.schedulesSubjects),
    resourceKinds: Array.from(processResourceKindsBySlug.values()),
  };

  return {
    ...primary,
    modules: allModules,
    // Monotonic unions: if any profile requires the stricter mode, composite uses it.
    billingReadinessMode: profiles.some((p) => p.billingReadinessMode === "prepared-not-prescribed")
      ? "prepared-not-prescribed"
      : primary.billingReadinessMode,
    customerGraph: profiles.some((p) => p.customerGraph === "separate-customer-projection")
      ? "separate-customer-projection"
      : primary.customerGraph,
    estateSeparation: profiles.some((p) => p.estateSeparation === "strict")
      ? "strict"
      : primary.estateSeparation,
    seededServiceCategories: allServiceCategories,
    seededConfigurationItemTypes: mergeByKey([
      ...(primary.seededConfigurationItemTypes ?? []),
      ...secondaries.flatMap((s) => s.seededConfigurationItemTypes ?? []),
    ]),
    seededBillingUnitTypes: mergeByKey([
      ...(primary.seededBillingUnitTypes ?? []),
      ...secondaries.flatMap((s) => s.seededBillingUnitTypes ?? []),
    ]),
    seededChargeModels: mergeByKey([
      ...(primary.seededChargeModels ?? []),
      ...secondaries.flatMap((s) => s.seededChargeModels ?? []),
    ]),
    capabilityOverrides: mergedOverrides.length > 0 ? mergedOverrides : undefined,
    ...(profiles.some((profile) => profile.processProfile !== undefined)
      ? { processProfile }
      : {}),
  };
}
