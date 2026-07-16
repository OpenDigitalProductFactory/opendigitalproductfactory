import { randomUUID } from "node:crypto";

import { prisma, type Prisma } from "@dpf/db";
import {
  evaluatePatientAuthority,
  type EmergencyPatientAccess,
  type PatientAuthorityDecision,
  type PatientAuthorityEvaluationInput,
  type PatientAuthorityStatus,
  type PatientConsentDirectiveView,
  type PatientOperation,
  type PatientProfileStatus,
  type PatientRelationshipType,
} from "@dpf/db/healthcare-patient-authority";

export const PATIENT_AUTHORITY_POLICY_VERSION =
  "healthcare-patient-authority/v1";

type PatientProfileRow = {
  id: string;
  organizationId: string;
  principalId: string;
  status: string;
  minorStatus: string;
  selfAccessAllowed: boolean;
};

type PatientAuthorityRow = {
  id: string;
  authorityId: string;
  organizationId: string;
  patientProfileId: string;
  granteePrincipalId: string;
  relationshipType: string;
  status: string;
  purposesOfUse: string[];
  permittedOperations: string[];
  recordCategories: string[];
  effectiveFrom: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  version: number;
};

type PatientConsentDirectiveRow = {
  id: string;
  directiveId: string;
  organizationId: string;
  patientProfileId: string;
  directiveType: string;
  status: string;
  decision: string;
  purposesOfUse: string[];
  operations: string[];
  recordCategories: string[];
  effectiveFrom: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  emergencyOverrideAllowed: boolean;
  version: number;
};

type PatientDataTransaction = {
  $executeRaw(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<number>;
  patientProfile: {
    findFirst(args: unknown): Promise<PatientProfileRow | null>;
  };
  patientAuthority: {
    findMany(args: unknown): Promise<PatientAuthorityRow[]>;
  };
  patientConsentDirective: {
    findMany(args: unknown): Promise<PatientConsentDirectiveRow[]>;
  };
  authorizationDecisionLog: {
    create(args: unknown): Promise<unknown>;
  };
};

export type PatientDataDatabase = {
  $transaction<T>(
    callback: (transaction: PatientDataTransaction) => Promise<T>,
  ): Promise<T>;
};

export type PatientDataContext = {
  organizationId: string;
  patientPrincipalIds: string[];
};

export type EvaluatePatientAuthorityRequest = {
  organizationId: string;
  actorPrincipalId: string;
  actorType: "human" | "agent" | "service";
  patientPrincipalId: string;
  purposeOfUse: string;
  operation: PatientOperation;
  recordCategory: string;
  at: Date;
  accessMode: "ordinary" | "staff-override" | "emergency";
  emergencyAccess: EmergencyPatientAccess | null;
};

function validContextValue(value: string): boolean {
  return value.trim().length > 0 && !value.includes(",");
}

function assertPatientDataContext(context: PatientDataContext): void {
  if (
    !validContextValue(context.organizationId)
    || context.patientPrincipalIds.length === 0
    || context.patientPrincipalIds.some(
      (principalId) => !validContextValue(principalId),
    )
  ) {
    throw new Error("Invalid patient data context");
  }
}

export async function withPatientDataContext<T>(
  context: PatientDataContext,
  callback: (transaction: PatientDataTransaction) => Promise<T>,
  database: PatientDataDatabase = prisma as unknown as PatientDataDatabase,
): Promise<T> {
  assertPatientDataContext(context);

  return database.$transaction(async (transaction) => {
    await transaction.$executeRaw`
      SELECT
        set_config('app.organization_id', ${context.organizationId}, true),
        set_config(
          'app.patient_principal_ids',
          ${context.patientPrincipalIds.join(",")},
          true
        )
    `;
    return callback(transaction);
  });
}

function unavailableDecision(): PatientAuthorityDecision {
  return {
    effect: "deny",
    reasonCodes: ["patient-profile-unavailable"],
    matchedAuthorityId: null,
    matchedDirectiveIds: [],
    emergencyAccessId: null,
    obligations: ["staff-assisted-recovery"],
  };
}

function toDirectiveView(
  directive: PatientConsentDirectiveRow,
): PatientConsentDirectiveView {
  return {
    directiveId: directive.directiveId,
    organizationId: directive.organizationId,
    patientProfileId: directive.patientProfileId,
    directiveType: directive.directiveType as PatientConsentDirectiveView["directiveType"],
    status: directive.status as PatientConsentDirectiveView["status"],
    decision: directive.decision as PatientConsentDirectiveView["decision"],
    purposesOfUse: directive.purposesOfUse,
    operations: directive.operations as PatientOperation[],
    recordCategories: directive.recordCategories,
    effectiveFrom: directive.effectiveFrom,
    expiresAt: directive.expiresAt,
    revokedAt: directive.revokedAt,
    emergencyOverrideAllowed: directive.emergencyOverrideAllowed,
  };
}

async function writeDecisionEvidence(
  transaction: PatientDataTransaction,
  request: EvaluatePatientAuthorityRequest,
  decision: PatientAuthorityDecision,
  authorities: PatientAuthorityRow[],
  directives: PatientConsentDirectiveRow[],
): Promise<void> {
  const authorityRow =
    authorities.find(
      (authority) => authority.authorityId === decision.matchedAuthorityId,
    ) ?? null;
  const directiveRows = directives.filter((directive) =>
    decision.matchedDirectiveIds.includes(directive.directiveId)
  );

  await transaction.authorizationDecisionLog.create({
    data: {
      decisionId: `patient-decision-${randomUUID()}`,
      actorType: request.actorType,
      actorRef: request.actorPrincipalId,
      organizationId: request.organizationId,
      patientSubjectPrincipalId: request.patientPrincipalId,
      patientAuthorityId: authorityRow?.id ?? null,
      patientConsentDirectiveId: directiveRows[0]?.id ?? null,
      purposeOfUse: request.purposeOfUse,
      policyVersion: PATIENT_AUTHORITY_POLICY_VERSION,
      actionKey: `healthcare.patient.${request.operation}`,
      objectRef:
        `patient:${request.patientPrincipalId}:${request.recordCategory}`,
      decision: decision.effect,
      rationale: {
        reasonCodes: decision.reasonCodes,
        matchedAuthorityId: decision.matchedAuthorityId,
        matchedDirectiveIds: decision.matchedDirectiveIds,
        authorityVersions: authorities.map((authority) => ({
          authorityId: authority.authorityId,
          version: authority.version,
        })),
        directiveVersions: directives.map((directive) => ({
          directiveId: directive.directiveId,
          version: directive.version,
        })),
        emergencyAccessId: decision.emergencyAccessId,
        obligations: decision.obligations,
        recordCategory: request.recordCategory,
        accessMode: request.accessMode,
      } satisfies Prisma.InputJsonValue,
    },
  });
}

export async function evaluateAndRecordPatientAuthority(
  request: EvaluatePatientAuthorityRequest,
  database: PatientDataDatabase = prisma as unknown as PatientDataDatabase,
): Promise<PatientAuthorityDecision> {
  return withPatientDataContext(
    {
      organizationId: request.organizationId,
      patientPrincipalIds: [request.patientPrincipalId],
    },
    async (transaction) => {
      const patient = await transaction.patientProfile.findFirst({
        where: {
          organizationId: request.organizationId,
          principalId: request.patientPrincipalId,
        },
      });

      if (patient === null) {
        const decision = unavailableDecision();
        await writeDecisionEvidence(transaction, request, decision, [], []);
        return decision;
      }

      const effectiveWindow = {
        status: "active",
        effectiveFrom: { lte: request.at },
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: request.at } }],
      };
      const [authorities, directives] = await Promise.all([
        transaction.patientAuthority.findMany({
          where: {
            organizationId: request.organizationId,
            patientProfileId: patient.id,
            ...effectiveWindow,
          },
          orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
        }),
        transaction.patientConsentDirective.findMany({
          where: {
            organizationId: request.organizationId,
            patientProfileId: patient.id,
            ...effectiveWindow,
          },
          orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
        }),
      ]);

      const evaluation: PatientAuthorityEvaluationInput = {
        ...request,
        patient: {
          patientProfileId: patient.id,
          organizationId: patient.organizationId,
          principalId: patient.principalId,
          status: patient.status as PatientProfileStatus,
          isMinor: patient.minorStatus === "minor",
          selfAccessAllowed: patient.selfAccessAllowed,
        },
        authorities: authorities.map((authority) => ({
          authorityId: authority.authorityId,
          organizationId: authority.organizationId,
          patientProfileId: authority.patientProfileId,
          granteePrincipalId: authority.granteePrincipalId,
          relationshipType:
            authority.relationshipType as PatientRelationshipType,
          status: authority.status as PatientAuthorityStatus,
          purposesOfUse: authority.purposesOfUse,
          permittedOperations:
            authority.permittedOperations as PatientOperation[],
          recordCategories: authority.recordCategories,
          effectiveFrom: authority.effectiveFrom,
          expiresAt: authority.expiresAt,
          revokedAt: authority.revokedAt,
        })),
        directives: directives.map(toDirectiveView),
      };
      const decision = evaluatePatientAuthority(evaluation);
      await writeDecisionEvidence(
        transaction,
        request,
        decision,
        authorities,
        directives,
      );
      return decision;
    },
    database,
  );
}
