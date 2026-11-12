/** Canonical organization-scoped custody reads shared by the rescue cockpit and twin. */
import type { CanonicalAnimalPopulation } from "@dpf/storefront-templates/operations";
export type { CanonicalAnimalPopulation } from "@dpf/storefront-templates/operations";
type Count = (args: unknown) => Promise<number>;
export interface AnimalOperatingFactsClient {
  animalProfile?: { count: Count };
  animalCustodyEpisode?: { count: Count };
}

export async function loadCanonicalAnimalPopulation(
  db: AnimalOperatingFactsClient,
  organizationId: string,
): Promise<CanonicalAnimalPopulation> {
  if (!organizationId || !db.animalProfile?.count || !db.animalCustodyEpisode?.count) {
    throw new Error("Canonical custody sources unavailable");
  }
  const [inCare, intakeReview, legalHold, placementReady] = await Promise.all([
    db.animalProfile.count({ where: { organizationId, lifecycleStatus: { in: ["in_care", "placement_ready"] } } }),
    db.animalCustodyEpisode.count({ where: { organizationId, closedAt: null, currentStage: "intake" } }),
    db.animalCustodyEpisode.count({ where: { organizationId, closedAt: null, legalHoldActive: true } }),
    db.animalProfile.count({ where: { organizationId, lifecycleStatus: "placement_ready" } }),
  ]);
  return { inCare, intakeReview, legalHold, placementReady };
}

/** Historical adoption outcomes survive a return and the next custody episode. */
export async function countCanonicalAdoptions(
  db: AnimalOperatingFactsClient,
  organizationId: string,
  since: Date,
): Promise<number> {
  if (!organizationId || !db.animalCustodyEpisode?.count) throw new Error("Canonical custody source unavailable");
  return db.animalCustodyEpisode.count({ where: { organizationId, outcomeType: "adoption", closedAt: { gte: since } } });
}
