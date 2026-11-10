// BI-FD40397B AC-1 — the typed commission reference on the existing
// `ecosystem-inbound-issue-triage` ScheduledJob (spec 2026-09-16 §6.1).
//
// The metadata POINTS at authority; it does not hold it. The runner re-resolves
// the referenced Workroom, its owners, the explicit repository and the
// installation identity before every run (lib/ecosystem/intake-controller-authority.ts).
// Absence means "not commissioned". Pure: no I/O.

export const INTAKE_CONTROLLER_JOB_ID = "ecosystem-inbound-issue-triage";
export const INTAKE_CONTROLLER_WORK_SHAPE = "issue-triage-watch@1.0.0";
/** The one metadata key this module owns; every other key is preserved. */
export const INTAKE_CONTROLLER_COMMISSION_KEY = "intakeControllerCommission";

export interface IntakeControllerCommission {
  workroomCapsuleId: string;
  /** `owner/name` as commissioned; must still match the workroom and explicit upstream URL. */
  repositoryFullName: string;
  workShape: typeof INTAKE_CONTROLLER_WORK_SHAPE;
  /** Relational Principal.id of the owner who commissioned it. */
  commissionedByPrincipalId: string;
  commissionedAt: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export function parseIntakeControllerCommission(metadata: unknown): IntakeControllerCommission | null {
  const raw = asRecord(asRecord(metadata)?.[INTAKE_CONTROLLER_COMMISSION_KEY]);
  if (!raw) return null;
  const { workroomCapsuleId, repositoryFullName, workShape, commissionedByPrincipalId, commissionedAt } = raw;
  if (!nonEmpty(workroomCapsuleId) || !nonEmpty(commissionedByPrincipalId)) return null;
  if (!nonEmpty(repositoryFullName) || !/^[^/\s]+\/[^/\s]+$/.test(repositoryFullName)) return null;
  if (workShape !== INTAKE_CONTROLLER_WORK_SHAPE) return null;
  if (!nonEmpty(commissionedAt) || Number.isNaN(Date.parse(commissionedAt))) return null;
  return { workroomCapsuleId, repositoryFullName, workShape, commissionedByPrincipalId, commissionedAt };
}

/** Write the commission into existing metadata without dropping any other key. */
export function mergeIntakeControllerCommission(
  existingMetadata: unknown,
  commission: IntakeControllerCommission,
): Record<string, unknown> {
  return { ...(asRecord(existingMetadata) ?? {}), [INTAKE_CONTROLLER_COMMISSION_KEY]: { ...commission } };
}

/** Existing metadata as a record to spread into, or an empty one. Shared with control.ts. */
export function existingMetadataRecord(metadata: unknown): Record<string, unknown> {
  return { ...(asRecord(metadata) ?? {}) };
}
