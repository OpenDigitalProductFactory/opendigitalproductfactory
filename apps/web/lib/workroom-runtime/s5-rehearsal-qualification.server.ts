import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { z } from "zod";

const ref = z.string().min(1).max(256).regex(/^\S+$/u);
const instant = z.int().nonnegative();
export const s5SyntheticTarget = z.strictObject({
  environment: z.literal("non-production"), fixtureRef: ref, databaseRef: ref, caseKey: ref, destinationRef: ref,
  recipient: z.strictObject({ authorityRef: ref, destinationRef: ref, reservationRef: ref }),
});
const binding = z.strictObject({
  issuer: ref, workroomId: ref, sessionRef: ref, stageKey: ref, stageAttemptRef: ref,
  subject: z.strictObject({ principalId: ref, gaid: ref.regex(/^gaid:\S+$/u) }),
  syntheticTarget: s5SyntheticTarget,
});
const evidence = z.strictObject({
  record: z.strictObject({
    schemaVersion: z.literal("s5-rehearsal-qualification.v1"),
    status: z.literal("active"), approvalRef: ref, ownerPrincipalId: ref, statusRevision: z.int().positive(),
    binding, issuedAt: instant, validUntil: instant,
  }),
  approval: z.strictObject({
    purpose: z.literal("s5-single-synthetic-rehearsal"), status: z.literal("approved"),
    ref, ownerPrincipalId: ref, revision: z.int().positive(), binding, validUntil: instant,
  }),
});

export const s5RehearsalQualificationRef = z.strictObject({
  kind: z.literal("rehearsal-qualification"), approvalRef: ref, ownerPrincipalId: ref,
  statusRevision: z.int().positive(), approvalRevision: z.int().positive(),
});
type Binding = z.infer<typeof binding>;
export type S5SyntheticTarget = z.infer<typeof s5SyntheticTarget>;
export type S5RehearsalQualification = z.infer<typeof s5RehearsalQualificationRef> & {
  validUntil: number;
  syntheticTarget: S5SyntheticTarget;
};

/** Compare separately read owner approval and persisted rehearsal record against
 * the already admitted binding. Only the registered owner adapter can establish
 * the approver's owning authority and the environment's actual nonprod pins. */
export function verifyS5RehearsalQualification(raw: unknown, expected: Binding, time: number): S5RehearsalQualification | null {
  const candidate = evidence.safeParse(raw);
  const admitted = binding.safeParse(expected);
  if (!candidate.success || !admitted.success || !Number.isSafeInteger(time) || time < 0) return null;
  const { record, approval } = candidate.data;
  const validUntil = Math.min(record.validUntil, approval.validUntil);
  if (!(record.issuedAt <= time && time < validUntil)
    || record.approvalRef !== approval.ref || record.ownerPrincipalId !== approval.ownerPrincipalId) return null;
  const exact = canonicalJson(admitted.data);
  if (canonicalJson(record.binding) !== exact || canonicalJson(approval.binding) !== exact) return null;
  return { kind: "rehearsal-qualification", approvalRef: record.approvalRef, ownerPrincipalId: record.ownerPrincipalId,
    statusRevision: record.statusRevision, approvalRevision: approval.revision, validUntil, syntheticTarget: admitted.data.syntheticTarget };
}
