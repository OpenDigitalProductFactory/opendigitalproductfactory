// Whether an industry reference model belongs to this install (BI-C44EAEE6).
//
// This rule has TWO consumers and they must not drift:
//
//   1. The seed (`seed-ea-reference-models.ts`) uses it to decide whether to
//      import a model's element hierarchy at all.
//   2. The read path (`apps/web/lib/explore/ea-data.ts`) uses it to decide how
//      to present a model the catalogue deliberately keeps everywhere.
//
// Splitting the rule out is the whole point. Seeding was scoped in #4870 and the
// read was not, so a pet rescue's Enterprise Architecture page advertised "BIAN
// Service Landscape — ACTIVE — 0 criteria". The catalogue row is kept on every
// install on purpose, so an operator can see the standard exists; what was
// missing is the other half of that bargain, which is scoping it at consumption.
// One exported rule, imported by both sides, is what stops the halves diverging
// again.
//
// Deliberately free of Prisma and of any clock: resolving WHICH archetype an
// install is belongs to the caller, because the seed reads it with its own
// client and the web app reads it with its own.

/**
 * Which archetypes an industry-specific reference model serves.
 *
 * Entries may be archetype CATEGORY slugs (`banking-financial-services`) or
 * specific archetype ids (`credit-union`), matching either — the same contract
 * `RegulationApplicability.archetypes` already uses, so an operator reads one
 * rule for "is this vertical content mine?", not two.
 *
 * An empty/absent list means universal: IT4IT describes IT management for any
 * organisation that runs IT, which is every install.
 */
export const REFERENCE_MODEL_ARCHETYPES: Readonly<Record<string, readonly string[]>> = {
  bian_service_landscape_v14_0_0: ["banking-financial-services"],
};

/** The install's declared archetype, as category slug + specific archetype id. */
export interface InstallArchetype {
  category: string | null;
  archetypeId: string | null;
}

/**
 * Does this install need the element hierarchy for `modelSlug`?
 *
 * Universal models (no declared archetypes) always apply. An industry model
 * applies only when the install's category or archetype id is in its list.
 */
export function referenceModelAppliesToInstall(
  modelSlug: string,
  install: InstallArchetype,
  archetypesBySlug: Readonly<Record<string, readonly string[]>> = REFERENCE_MODEL_ARCHETYPES,
): boolean {
  const archetypes = archetypesBySlug[modelSlug];
  if (!archetypes || archetypes.length === 0) return true;
  return archetypes.some(
    (a) => a === install.category || a === install.archetypeId,
  );
}

/**
 * Why a model is or is not this install's, in one operator-readable sentence.
 *
 * The read path needs the reason, not just the boolean: a card that says only
 * "not applicable" invites the question this answers. Mirrors the shape
 * `regulationApplies` already returns for regulations.
 */
export function describeReferenceModelApplicability(
  modelSlug: string,
  install: InstallArchetype,
  archetypesBySlug: Readonly<Record<string, readonly string[]>> = REFERENCE_MODEL_ARCHETYPES,
): { applies: boolean; reason: string } {
  const archetypes = archetypesBySlug[modelSlug];
  if (!archetypes || archetypes.length === 0) {
    return { applies: true, reason: "Applies to every install." };
  }
  if (referenceModelAppliesToInstall(modelSlug, install, archetypesBySlug)) {
    return {
      applies: true,
      reason: `Applies because this install is ${install.archetypeId ?? install.category}.`,
    };
  }
  // Naming the install's own archetype matters more than naming the model's:
  // the operator knows what they run, and the question they are answering is
  // "why is a banking standard on my screen".
  const declared = install.archetypeId ?? install.category;
  return {
    applies: false,
    reason: declared
      ? `Serves ${archetypes.join(", ")}, and this install is ${declared}.`
      : `Serves ${archetypes.join(", ")}, and this install has not chosen an archetype yet.`,
  };
}
