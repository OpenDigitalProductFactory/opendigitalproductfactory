// Legal-hold awareness for the data-retention engine (BI-90A8D153, GAP 2).
//
// THE DEFECT
// Models with a `legalHold Boolean` column exist in the schema (including
// PatientProfile, CareIntakePacket, CareIntakeResponse, and CareRecord), but the retention engine must read
// them: execute.ts built its purge WHERE clause purely from the policy's
// timestamp field + extraWhere, and no policy set an extraWhere on legalHold.
// A row under legal hold on a purge-enrolled model would therefore be deleted
// by the nightly sweep — a correctness/compliance trap. It is latent today only
// while those models are not purge-enrolled; it becomes
// live the moment a regulated tenant's held model is enrolled.
//
// THE FIX
// Make the engine honour a hold before purging, by construction: any purge over
// a model that carries a `legalHold` column excludes held rows
// (`legalHold: { not: true }` — matches false and null, so only an explicit
// hold is spared). Drift is prevented by legal-hold.schema.test.ts, which parses
// schema.prisma and fails if LEGAL_HOLD_MODELS ever disagrees with the actual
// set of models carrying a `legalHold Boolean` column — so enrolling a new
// held model can never silently reintroduce the gap.
//
// This is the minimal, urgent half of BI-90A8D153. A full legal-hold substrate
// (a hold model with scope / custodian / matter / release workflow) and the
// jurisdiction axis + per-run disposition evidence are the larger, separable
// parts of that BI.

/**
 * Prisma delegate accessors (camelCase model names) for every model that
 * carries a `legalHold` boolean column. Guarded against schema drift by
 * legal-hold.schema.test.ts. When a purge policy targets one of these models,
 * the engine excludes held rows.
 */
export const LEGAL_HOLD_MODELS: ReadonlySet<string> = new Set([
  "patientProfile",
  "careIntakePacket",
  "careIntakeResponse",
  "careRecord",
]);

/** The column that flags an active legal hold. Single source of truth for both
 *  the engine's WHERE injection and the schema-drift guard. */
export const LEGAL_HOLD_FIELD = "legalHold";

/**
 * Given a purge policy's target model, return the extra WHERE fragment that
 * excludes rows under legal hold — or an empty object when the model has no
 * hold column. `{ not: true }` spares only an explicit hold (true); false and
 * null both remain eligible for purge.
 */
export function legalHoldExclusion(model: string): Record<string, unknown> {
  return LEGAL_HOLD_MODELS.has(model) ? { [LEGAL_HOLD_FIELD]: { not: true } } : {};
}
