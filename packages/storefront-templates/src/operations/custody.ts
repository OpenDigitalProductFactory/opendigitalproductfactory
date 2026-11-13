/** These are independent canonical counts; legal-hold and readiness are not disjoint buckets. */
export interface CanonicalAnimalPopulation { inCare: number; intakeReview: number; legalHold: number; placementReady: number; }
export interface AnimalsInCare {
  total: number;
  onHold: number;
  /** Compatibility fields for callers that possess an independent availability source. */
  available: number;
  pending: number;
  placementReady?: number;
  intakeReview?: number;
}

export function summarizeCanonicalAnimalPopulation(population: CanonicalAnimalPopulation | null): AnimalsInCare | null {
  if (population == null || ![population.inCare, population.intakeReview, population.legalHold, population.placementReady].every((n) => Number.isSafeInteger(n) && n >= 0)) return null;
  return { total: population.inCare, onHold: population.legalHold, available: 0, pending: 0, placementReady: population.placementReady, intakeReview: population.intakeReview };
}
