export const PATIENT_PROFILE_STATUSES = [
  "active",
  "inactive",
  "identity-review",
  "merged",
  "entered-in-error",
] as const;
export type PatientProfileStatus = (typeof PATIENT_PROFILE_STATUSES)[number];

export const PATIENT_RELATIONSHIP_TYPES = [
  "guardian",
  "caregiver",
  "household-member",
  "emergency-contact",
  "responsible-party",
  "proxy",
] as const;
export type PatientRelationshipType =
  (typeof PATIENT_RELATIONSHIP_TYPES)[number];

export const PATIENT_AUTHORITY_STATUSES = [
  "proposed",
  "active",
  "expired",
  "revoked",
  "entered-in-error",
] as const;
export type PatientAuthorityStatus =
  (typeof PATIENT_AUTHORITY_STATUSES)[number];

export const CONSENT_DIRECTIVE_TYPES = [
  "consent",
  "privacy-restriction",
] as const;
export type ConsentDirectiveType =
  (typeof CONSENT_DIRECTIVE_TYPES)[number];

export const CONSENT_DIRECTIVE_STATUSES = PATIENT_AUTHORITY_STATUSES;
export type ConsentDirectiveStatus = PatientAuthorityStatus;

export const CONSENT_DIRECTIVE_DECISIONS = ["permit", "deny"] as const;
export type ConsentDirectiveDecision =
  (typeof CONSENT_DIRECTIVE_DECISIONS)[number];

export const PATIENT_OPERATIONS = [
  "view",
  "create",
  "amend",
  "release",
  "export",
  "delete",
  "schedule",
  "communicate",
  "pay",
] as const;
export type PatientOperation = (typeof PATIENT_OPERATIONS)[number];

export const PATIENT_AUTHORITY_REASON_CODES = [
  "matched-patient-authority",
  "patient-self-access",
  "emergency-access",
  "cross-tenant",
  "wrong-patient-subject",
  "identity-review-required",
  "patient-profile-merged",
  "patient-profile-unavailable",
  "minor-jurisdiction-review-required",
  "authority-not-found",
  "authority-not-active",
  "authority-not-effective",
  "authority-expired",
  "authority-revoked",
  "purpose-not-authorized",
  "operation-not-authorized",
  "record-category-not-authorized",
  "active-privacy-restriction",
  "patient-authority-human-only",
  "staff-override-not-authorized",
  "emergency-context-mismatch",
  "emergency-human-only",
  "emergency-reason-required",
  "emergency-expired",
  "emergency-operation-not-authorized",
  "emergency-operation-prohibited",
] as const;
export type PatientAuthorityReasonCode =
  (typeof PATIENT_AUTHORITY_REASON_CODES)[number];

export type PatientProfileAuthorityView = {
  patientProfileId: string;
  organizationId: string;
  principalId: string;
  status: PatientProfileStatus;
  isMinor: boolean;
  selfAccessAllowed: boolean;
};

export type PatientAuthorityView = {
  authorityId: string;
  organizationId: string;
  patientProfileId: string;
  granteePrincipalId: string;
  relationshipType: PatientRelationshipType;
  status: PatientAuthorityStatus;
  purposesOfUse: string[];
  permittedOperations: PatientOperation[];
  recordCategories: string[];
  effectiveFrom: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

export type PatientConsentDirectiveView = {
  directiveId: string;
  organizationId: string;
  patientProfileId: string;
  directiveType: ConsentDirectiveType;
  status: ConsentDirectiveStatus;
  decision: ConsentDirectiveDecision;
  purposesOfUse: string[];
  operations: PatientOperation[];
  recordCategories: string[];
  effectiveFrom: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  emergencyOverrideAllowed: boolean;
};

export type EmergencyPatientAccess = {
  emergencyAccessId: string;
  organizationId: string;
  patientProfileId: string;
  actorPrincipalId: string;
  actorType: "human" | "agent" | "service";
  declaredReason: string;
  permittedOperations: PatientOperation[];
  expiresAt: Date;
};

export type PatientAuthorityEvaluationInput = {
  organizationId: string;
  actorPrincipalId: string;
  actorType: "human" | "agent" | "service";
  patient: PatientProfileAuthorityView;
  patientPrincipalId: string;
  purposeOfUse: string;
  operation: PatientOperation;
  recordCategory: string;
  at: Date;
  authorities: PatientAuthorityView[];
  directives: PatientConsentDirectiveView[];
  accessMode: "ordinary" | "staff-override" | "emergency";
  emergencyAccess: EmergencyPatientAccess | null;
};

export type PatientAuthorityDecision = {
  effect: "allow" | "deny";
  reasonCodes: PatientAuthorityReasonCode[];
  matchedAuthorityId: string | null;
  matchedDirectiveIds: string[];
  emergencyAccessId: string | null;
  obligations: string[];
};

function deny(
  reasonCodes: PatientAuthorityReasonCode[],
  options: Partial<
    Pick<
      PatientAuthorityDecision,
      | "matchedAuthorityId"
      | "matchedDirectiveIds"
      | "emergencyAccessId"
      | "obligations"
    >
  > = {},
): PatientAuthorityDecision {
  return {
    effect: "deny",
    reasonCodes,
    matchedAuthorityId: options.matchedAuthorityId ?? null,
    matchedDirectiveIds: options.matchedDirectiveIds ?? [],
    emergencyAccessId: options.emergencyAccessId ?? null,
    obligations: options.obligations ?? [],
  };
}

function isEffective(
  effectiveFrom: Date,
  expiresAt: Date | null,
  at: Date,
): boolean {
  return effectiveFrom.getTime() <= at.getTime()
    && (expiresAt === null || expiresAt.getTime() > at.getTime());
}

function scopeIncludes(values: readonly string[], requested: string): boolean {
  return values.includes("*") || values.includes(requested);
}

function matchingDirective(
  directive: PatientConsentDirectiveView,
  input: PatientAuthorityEvaluationInput,
): boolean {
  return directive.organizationId === input.organizationId
    && directive.patientProfileId === input.patient.patientProfileId
    && directive.status === "active"
    && directive.revokedAt === null
    && isEffective(directive.effectiveFrom, directive.expiresAt, input.at)
    && scopeIncludes(directive.purposesOfUse, input.purposeOfUse)
    && scopeIncludes(directive.operations, input.operation)
    && scopeIncludes(directive.recordCategories, input.recordCategory);
}

function evaluateEmergencyAccess(
  input: PatientAuthorityEvaluationInput,
): PatientAuthorityDecision {
  const emergency = input.emergencyAccess;
  if (
    emergency === null
    || emergency.organizationId !== input.organizationId
    || emergency.patientProfileId !== input.patient.patientProfileId
    || emergency.actorPrincipalId !== input.actorPrincipalId
  ) {
    return deny(["emergency-context-mismatch"]);
  }
  if (input.actorType !== "human" || emergency.actorType !== "human") {
    return deny(["emergency-human-only"], {
      emergencyAccessId: emergency.emergencyAccessId,
    });
  }
  if (emergency.declaredReason.trim().length < 8) {
    return deny(["emergency-reason-required"], {
      emergencyAccessId: emergency.emergencyAccessId,
    });
  }
  if (emergency.expiresAt.getTime() <= input.at.getTime()) {
    return deny(["emergency-expired"], {
      emergencyAccessId: emergency.emergencyAccessId,
    });
  }
  if (input.operation === "delete" || input.operation === "export") {
    return deny(["emergency-operation-prohibited"], {
      emergencyAccessId: emergency.emergencyAccessId,
    });
  }
  if (!scopeIncludes(emergency.permittedOperations, input.operation)) {
    return deny(["emergency-operation-not-authorized"], {
      emergencyAccessId: emergency.emergencyAccessId,
    });
  }

  const blockingRestrictions = input.directives.filter(
    (directive) =>
      matchingDirective(directive, input)
      && directive.decision === "deny"
      && !directive.emergencyOverrideAllowed,
  );
  if (blockingRestrictions.length > 0) {
    return deny(["active-privacy-restriction"], {
      emergencyAccessId: emergency.emergencyAccessId,
      matchedDirectiveIds: blockingRestrictions.map(
        (directive) => directive.directiveId,
      ),
    });
  }

  return {
    effect: "allow",
    reasonCodes: ["emergency-access"],
    matchedAuthorityId: null,
    matchedDirectiveIds: [],
    emergencyAccessId: emergency.emergencyAccessId,
    obligations: [
      "minimum-necessary",
      "notify-privacy",
      "retrospective-review",
    ],
  };
}

function explainAuthorityMismatch(
  authority: PatientAuthorityView,
  input: PatientAuthorityEvaluationInput,
): PatientAuthorityReasonCode {
  if (authority.revokedAt !== null || authority.status === "revoked") {
    return "authority-revoked";
  }
  if (
    authority.status === "expired"
    || (
      authority.expiresAt !== null
      && authority.expiresAt.getTime() <= input.at.getTime()
    )
  ) {
    return "authority-expired";
  }
  if (authority.status !== "active") return "authority-not-active";
  if (authority.effectiveFrom.getTime() > input.at.getTime()) {
    return "authority-not-effective";
  }
  if (!scopeIncludes(authority.purposesOfUse, input.purposeOfUse)) {
    return "purpose-not-authorized";
  }
  if (!scopeIncludes(authority.permittedOperations, input.operation)) {
    return "operation-not-authorized";
  }
  if (!scopeIncludes(authority.recordCategories, input.recordCategory)) {
    return "record-category-not-authorized";
  }
  return "authority-not-found";
}

export function evaluatePatientAuthority(
  input: PatientAuthorityEvaluationInput,
): PatientAuthorityDecision {
  if (
    input.organizationId !== input.patient.organizationId
    || input.authorities.some(
      (authority) =>
        authority.patientProfileId === input.patient.patientProfileId
        && authority.organizationId !== input.organizationId,
    )
  ) {
    return deny(["cross-tenant"]);
  }
  if (input.patientPrincipalId !== input.patient.principalId) {
    return deny(["wrong-patient-subject"]);
  }
  if (input.patient.status === "identity-review") {
    return deny(["identity-review-required"], {
      obligations: ["staff-assisted-recovery"],
    });
  }
  if (input.patient.status === "merged") {
    return deny(["patient-profile-merged"], {
      obligations: ["resolve-surviving-patient"],
    });
  }
  if (input.patient.status !== "active") {
    return deny(["patient-profile-unavailable"]);
  }
  if (input.accessMode === "staff-override") {
    return deny(["staff-override-not-authorized"], {
      obligations: ["staff-assisted-recovery"],
    });
  }
  if (input.accessMode === "emergency") {
    return evaluateEmergencyAccess(input);
  }
  if (input.actorType !== "human") {
    return deny(["patient-authority-human-only"], {
      obligations: ["evaluate-authority-binding"],
    });
  }

  const restrictions = input.directives.filter(
    (directive) =>
      matchingDirective(directive, input)
      && directive.decision === "deny",
  );
  if (restrictions.length > 0) {
    return deny(["active-privacy-restriction"], {
      matchedDirectiveIds: restrictions.map(
        (directive) => directive.directiveId,
      ),
    });
  }

  if (input.actorPrincipalId === input.patient.principalId) {
    if (input.patient.isMinor && !input.patient.selfAccessAllowed) {
      return deny(["minor-jurisdiction-review-required"], {
        obligations: ["staff-assisted-recovery"],
      });
    }
    return {
      effect: "allow",
      reasonCodes: ["patient-self-access"],
      matchedAuthorityId: null,
      matchedDirectiveIds: [],
      emergencyAccessId: null,
      obligations: ["record-access-decision"],
    };
  }

  const actorAuthorities = input.authorities.filter(
    (authority) =>
      authority.organizationId === input.organizationId
      && authority.patientProfileId === input.patient.patientProfileId
      && authority.granteePrincipalId === input.actorPrincipalId,
  );
  const matchedAuthority = actorAuthorities.find(
    (authority) =>
      authority.status === "active"
      && authority.revokedAt === null
      && isEffective(authority.effectiveFrom, authority.expiresAt, input.at)
      && scopeIncludes(authority.purposesOfUse, input.purposeOfUse)
      && scopeIncludes(authority.permittedOperations, input.operation)
      && scopeIncludes(authority.recordCategories, input.recordCategory),
  );
  if (matchedAuthority) {
    return {
      effect: "allow",
      reasonCodes: ["matched-patient-authority"],
      matchedAuthorityId: matchedAuthority.authorityId,
      matchedDirectiveIds: [],
      emergencyAccessId: null,
      obligations: ["record-access-decision"],
    };
  }

  return deny([
    actorAuthorities.length === 0
      ? "authority-not-found"
      : explainAuthorityMismatch(actorAuthorities[0]!, input),
  ]);
}

export type PatientAccessRecovery = {
  selfServiceActions: string[];
  staffAssistedActions: string[];
};

export function resolvePatientAccessRecovery(
  reasonCodes: PatientAuthorityReasonCode[],
): PatientAccessRecovery {
  if (reasonCodes.includes("identity-review-required")) {
    return {
      selfServiceActions: [],
      staffAssistedActions: ["verify-identity", "resolve-duplicate"],
    };
  }
  if (
    reasonCodes.includes("authority-revoked")
    || reasonCodes.includes("authority-expired")
  ) {
    return {
      selfServiceActions: ["request-new-authority"],
      staffAssistedActions: ["review-authority-evidence"],
    };
  }
  if (
    reasonCodes.includes("authority-not-found")
    || reasonCodes.includes("minor-jurisdiction-review-required")
  ) {
    return {
      selfServiceActions: ["request-authority-review"],
      staffAssistedActions: ["verify-identity", "review-authority-evidence"],
    };
  }
  return {
    selfServiceActions: [],
    staffAssistedActions: ["contact-practice"],
  };
}
