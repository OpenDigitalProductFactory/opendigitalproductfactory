/** Shared source-observation contract for bounded operational read models. */
export interface OperationalSourceWatermark {
  source: string;
  observedAt: string;
  sourceVersion?: string;
}

/** A source that could not contribute facts to an otherwise usable snapshot. */
export interface OperationalDegradedSource {
  source: string;
  reason: string;
}
