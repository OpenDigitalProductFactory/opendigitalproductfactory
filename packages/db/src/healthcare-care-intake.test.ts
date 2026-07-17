import { describe, expect, it } from "vitest";

import {
  CARE_INTAKE_RESPONSE_STATUSES,
  assertCareIntakeTransition,
  calculateIntakeReadiness,
  validateMinimumNecessaryAnswers,
  type CareIntakeRequirement,
} from "./healthcare-care-intake";

const requirements: CareIntakeRequirement[] = [
  {
    linkId: "contact-phone",
    dataCategory: "contact",
    required: true,
  },
  {
    linkId: "visit-reason",
    dataCategory: "visit-reason",
    required: true,
  },
  {
    linkId: "marketing-source",
    dataCategory: "marketing",
    required: false,
  },
];

describe("healthcare care intake contract", () => {
  it("uses the FHIR R4 QuestionnaireResponse lifecycle", () => {
    expect(CARE_INTAKE_RESPONSE_STATUSES).toEqual([
      "in-progress",
      "completed",
      "amended",
      "entered-in-error",
      "stopped",
    ]);
  });

  it("computes operational readiness without returning answer values", () => {
    expect(
      calculateIntakeReadiness({
        requirements,
        answeredLinkIds: ["contact-phone"],
        unresolvedExceptionCount: 1,
        requiredConsentCount: 1,
        acceptedConsentCount: 0,
        requiredCoverageEvidence: true,
        acceptedCoverageEvidenceCount: 0,
      }),
    ).toEqual({
      ready: false,
      completionPercent: 20,
      missingRequiredLinkIds: ["visit-reason"],
      blockers: [
        "required-answers-missing",
        "consent-incomplete",
        "coverage-unverified",
        "exceptions-unresolved",
      ],
    });
  });

  it("rejects answer categories outside the packet's minimum-necessary scope", () => {
    expect(
      validateMinimumNecessaryAnswers({
        requirements,
        allowedDataCategories: ["contact", "visit-reason"],
        answers: [
          { linkId: "contact-phone", dataCategory: "contact" },
          { linkId: "marketing-source", dataCategory: "marketing" },
        ],
      }),
    ).toEqual({
      ok: false,
      errors: ["data-category-not-authorized:marketing-source"],
    });
  });

  it.each([
    ["assigned", "in-progress"],
    ["in-progress", "completed"],
    ["completed", "amended"],
    ["assigned", "stopped"],
    ["in-progress", "entered-in-error"],
  ] as const)("allows %s → %s", (from, to) => {
    expect(() => assertCareIntakeTransition(from, to)).not.toThrow();
  });

  it.each([
    ["assigned", "completed"],
    ["completed", "in-progress"],
    ["stopped", "in-progress"],
    ["entered-in-error", "amended"],
  ] as const)("rejects %s → %s", (from, to) => {
    expect(() => assertCareIntakeTransition(from, to)).toThrow(
      `Invalid care intake transition: ${from} -> ${to}`,
    );
  });
});
