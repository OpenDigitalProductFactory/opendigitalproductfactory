import { describe, expect, it } from "vitest";

import {
  CONSENT_DIRECTIVE_DECISIONS,
  CONSENT_DIRECTIVE_STATUSES,
  CONSENT_DIRECTIVE_TYPES,
  PATIENT_AUTHORITY_STATUSES,
  PATIENT_OPERATIONS,
  PATIENT_PROFILE_STATUSES,
  PATIENT_RELATIONSHIP_TYPES,
  evaluatePatientAuthority,
  resolvePatientAccessRecovery,
  type PatientAuthorityEvaluationInput,
} from "./healthcare-patient-authority";

const NOW = new Date("2026-07-16T12:00:00.000Z");

function baseInput(
  overrides: Partial<PatientAuthorityEvaluationInput> = {},
): PatientAuthorityEvaluationInput {
  return {
    organizationId: "org-a",
    actorPrincipalId: "principal-proxy",
    actorType: "human",
    patient: {
      patientProfileId: "patient-profile-a",
      organizationId: "org-a",
      principalId: "principal-patient",
      status: "active",
      isMinor: false,
      selfAccessAllowed: true,
    },
    patientPrincipalId: "principal-patient",
    purposeOfUse: "patient-support",
    operation: "view",
    recordCategory: "appointments",
    at: NOW,
    authorities: [
      {
        authorityId: "authority-a",
        organizationId: "org-a",
        patientProfileId: "patient-profile-a",
        granteePrincipalId: "principal-proxy",
        relationshipType: "proxy",
        status: "active",
        purposesOfUse: ["patient-support"],
        permittedOperations: ["view", "schedule"],
        recordCategories: ["appointments"],
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        expiresAt: new Date("2026-12-31T23:59:59.000Z"),
        revokedAt: null,
      },
    ],
    directives: [],
    accessMode: "ordinary",
    emergencyAccess: null,
    ...overrides,
  };
}

describe("healthcare patient authority vocabularies", () => {
  it("keeps fixed values closed and hyphenated", () => {
    expect(PATIENT_PROFILE_STATUSES).toEqual([
      "active",
      "inactive",
      "identity-review",
      "merged",
      "entered-in-error",
    ]);
    expect(PATIENT_RELATIONSHIP_TYPES).toContain("responsible-party");
    expect(PATIENT_AUTHORITY_STATUSES).toEqual([
      "proposed",
      "active",
      "expired",
      "revoked",
      "entered-in-error",
    ]);
    expect(CONSENT_DIRECTIVE_TYPES).toEqual(["consent", "privacy-restriction"]);
    expect(CONSENT_DIRECTIVE_STATUSES).toEqual(PATIENT_AUTHORITY_STATUSES);
    expect(CONSENT_DIRECTIVE_DECISIONS).toEqual(["permit", "deny"]);
    expect(PATIENT_OPERATIONS).toContain("release");
  });
});

describe("evaluatePatientAuthority", () => {
  it("allows an effective proxy only for its explicit patient, purpose, operation, category, and tenant", () => {
    expect(evaluatePatientAuthority(baseInput())).toMatchObject({
      effect: "allow",
      reasonCodes: ["matched-patient-authority"],
      matchedAuthorityId: "authority-a",
    });
  });

  it("denies a cross-tenant request before considering authority", () => {
    const result = evaluatePatientAuthority(
      baseInput({ organizationId: "org-b" }),
    );
    expect(result).toMatchObject({
      effect: "deny",
      reasonCodes: ["cross-tenant"],
      matchedAuthorityId: null,
    });
  });

  it("denies the wrong patient subject", () => {
    const result = evaluatePatientAuthority(
      baseInput({ patientPrincipalId: "principal-other-patient" }),
    );
    expect(result.effect).toBe("deny");
    expect(result.reasonCodes).toContain("wrong-patient-subject");
  });

  it.each([
    ["identity-review", "identity-review-required"],
    ["merged", "patient-profile-merged"],
    ["entered-in-error", "patient-profile-unavailable"],
    ["inactive", "patient-profile-unavailable"],
  ] as const)("denies patient status %s", (status, reason) => {
    const input = baseInput({
      patient: { ...baseInput().patient, status },
    });
    expect(evaluatePatientAuthority(input)).toMatchObject({
      effect: "deny",
      reasonCodes: [reason],
    });
  });

  it.each([
    {
      title: "expired",
      authority: { expiresAt: new Date("2026-07-15T00:00:00.000Z") },
      reason: "authority-expired",
    },
    {
      title: "revoked",
      authority: { status: "revoked" as const, revokedAt: NOW },
      reason: "authority-revoked",
    },
    {
      title: "wrong purpose",
      input: { purposeOfUse: "treatment" },
      reason: "purpose-not-authorized",
    },
    {
      title: "wrong operation",
      input: { operation: "release" as const },
      reason: "operation-not-authorized",
    },
    {
      title: "wrong record category",
      input: { recordCategory: "sensitive-result" },
      reason: "record-category-not-authorized",
    },
  ])("denies $title proxy authority", ({ authority, input, reason }) => {
    const original = baseInput();
    const result = evaluatePatientAuthority(
      baseInput({
        ...input,
        authorities: [
          {
            ...original.authorities[0]!,
            ...authority,
          },
        ],
      }),
    );
    expect(result.effect).toBe("deny");
    expect(result.reasonCodes).toContain(reason);
  });

  it("lets an adult patient access their own subject without inventing a proxy relationship", () => {
    const result = evaluatePatientAuthority(
      baseInput({
        actorPrincipalId: "principal-patient",
        authorities: [],
      }),
    );
    expect(result).toMatchObject({
      effect: "allow",
      reasonCodes: ["patient-self-access"],
      matchedAuthorityId: null,
    });
  });

  it("denies minor self-access until the jurisdiction profile permits it", () => {
    const input = baseInput({
      actorPrincipalId: "principal-patient",
      authorities: [],
      patient: {
        ...baseInput().patient,
        isMinor: true,
        selfAccessAllowed: false,
      },
    });
    expect(evaluatePatientAuthority(input)).toMatchObject({
      effect: "deny",
      reasonCodes: ["minor-jurisdiction-review-required"],
    });
  });

  it("applies an active privacy restriction before ordinary proxy access", () => {
    const input = baseInput({
      directives: [
        {
          directiveId: "restriction-a",
          organizationId: "org-a",
          patientProfileId: "patient-profile-a",
          directiveType: "privacy-restriction",
          status: "active",
          decision: "deny",
          purposesOfUse: ["patient-support"],
          operations: ["view"],
          recordCategories: ["appointments"],
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          expiresAt: null,
          revokedAt: null,
          emergencyOverrideAllowed: false,
        },
      ],
    });
    expect(evaluatePatientAuthority(input)).toMatchObject({
      effect: "deny",
      reasonCodes: ["active-privacy-restriction"],
      matchedDirectiveIds: ["restriction-a"],
    });
  });

  it("never treats a generic staff override as patient authority", () => {
    const result = evaluatePatientAuthority(
      baseInput({ accessMode: "staff-override", authorities: [] }),
    );
    expect(result).toMatchObject({
      effect: "deny",
      reasonCodes: ["staff-override-not-authorized"],
      obligations: ["staff-assisted-recovery"],
    });
  });

  it.each(["agent", "service"] as const)(
    "does not let a %s principal inherit human proxy authority",
    (actorType) => {
      const result = evaluatePatientAuthority(
        baseInput({ actorType }),
      );
      expect(result).toMatchObject({
        effect: "deny",
        reasonCodes: ["patient-authority-human-only"],
      });
    },
  );

  it("allows patient-specific, human-only, declared and unexpired emergency access", () => {
    const result = evaluatePatientAuthority(
      baseInput({
        actorPrincipalId: "principal-clinician",
        authorities: [],
        accessMode: "emergency",
        purposeOfUse: "emergency-treatment",
        recordCategory: "allergies",
        emergencyAccess: {
          emergencyAccessId: "emergency-a",
          organizationId: "org-a",
          patientProfileId: "patient-profile-a",
          actorPrincipalId: "principal-clinician",
          actorType: "human",
          declaredReason: "Patient is unconscious and allergy status is required.",
          permittedOperations: ["view"],
          expiresAt: new Date("2026-07-16T12:15:00.000Z"),
        },
      }),
    );
    expect(result).toMatchObject({
      effect: "allow",
      reasonCodes: ["emergency-access"],
      obligations: ["minimum-necessary", "notify-privacy", "retrospective-review"],
    });
  });

  it.each(["agent", "service"] as const)(
    "denies emergency access to %s actors",
    (actorType) => {
      const result = evaluatePatientAuthority(
        baseInput({
          actorPrincipalId: "non-human-actor",
          actorType,
          authorities: [],
          accessMode: "emergency",
          emergencyAccess: {
            emergencyAccessId: "emergency-a",
            organizationId: "org-a",
            patientProfileId: "patient-profile-a",
            actorPrincipalId: "non-human-actor",
            actorType,
            declaredReason: "urgent",
            permittedOperations: ["view"],
            expiresAt: new Date("2026-07-16T12:15:00.000Z"),
          },
        }),
      );
      expect(result.effect).toBe("deny");
      expect(result.reasonCodes).toContain("emergency-human-only");
    },
  );

  it("does not let emergency access delete or export patient data", () => {
    const input = baseInput({
      actorPrincipalId: "principal-clinician",
      authorities: [],
      accessMode: "emergency",
      operation: "delete",
      emergencyAccess: {
        emergencyAccessId: "emergency-a",
        organizationId: "org-a",
        patientProfileId: "patient-profile-a",
        actorPrincipalId: "principal-clinician",
        actorType: "human",
        declaredReason: "Patient safety requires immediate clinical access.",
        permittedOperations: ["delete"],
        expiresAt: new Date("2026-07-16T12:15:00.000Z"),
      },
    });
    expect(evaluatePatientAuthority(input)).toMatchObject({
      effect: "deny",
      reasonCodes: ["emergency-operation-prohibited"],
    });
  });
});

describe("resolvePatientAccessRecovery", () => {
  it("defines staff-assisted and self-service paths without overriding authority", () => {
    expect(resolvePatientAccessRecovery(["identity-review-required"])).toEqual({
      selfServiceActions: [],
      staffAssistedActions: ["verify-identity", "resolve-duplicate"],
    });
    expect(resolvePatientAccessRecovery(["authority-revoked"])).toEqual({
      selfServiceActions: ["request-new-authority"],
      staffAssistedActions: ["review-authority-evidence"],
    });
  });
});
