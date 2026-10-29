// Shared review-depth vocabulary; no runtime, authority or database dependency.
/** Review depth, distinct from a damaging action or permission to execute. */
export const STEP_CRITICALITIES = ["routine", "consequential", "critical"] as const;
export type StepCriticality = (typeof STEP_CRITICALITIES)[number];
