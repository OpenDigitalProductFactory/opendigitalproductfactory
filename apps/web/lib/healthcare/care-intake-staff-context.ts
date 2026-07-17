import { randomUUID } from "node:crypto";

export type CareIntakeStaffContextTransaction = {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  authorizationDecisionLog: { create(args: unknown): Promise<unknown> };
};

export async function setCareIntakeStaffContext(
  tx: CareIntakeStaffContextTransaction,
  input: { organizationId: string; actorPrincipalId: string; patientProfileId?: string },
) {
  await tx.$executeRaw`SELECT set_config('app.organization_id', ${input.organizationId}, true), set_config('app.care_intake_staff_principal_id', ${input.actorPrincipalId}, true), set_config('app.care_intake_access_purpose', 'intake-review', true)`;
  if (input.patientProfileId) {
    await tx.$executeRaw`SELECT set_config('app.patient_profile_ids', ${input.patientProfileId}, true)`;
  }
}

export async function recordCareIntakeStaffDecision(
  tx: CareIntakeStaffContextTransaction,
  input: {
    organizationId: string;
    actorPrincipalId: string;
    actionKey: string;
    objectRef: string;
    routeContext: string;
    rationale: Record<string, unknown>;
  },
) {
  await tx.authorizationDecisionLog.create({
    data: {
      decisionId: `intake-staff-decision-${randomUUID()}`,
      actorType: "user",
      actorRef: input.actorPrincipalId,
      organizationId: input.organizationId,
      purposeOfUse: "intake-review",
      policyVersion: "healthcare-intake-staff-review/v1",
      actionKey: input.actionKey,
      objectRef: input.objectRef,
      decision: "allow",
      rationale: input.rationale,
      routeContext: input.routeContext,
      sensitivityLevel: "restricted",
    },
  });
}
