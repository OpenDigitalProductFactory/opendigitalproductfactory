export const CARE_INTAKE_PACKET_STATUSES = [
  "assigned",
  "in-progress",
  "completed",
  "amended",
  "entered-in-error",
  "stopped",
] as const;
export type CareIntakePacketStatus =
  (typeof CARE_INTAKE_PACKET_STATUSES)[number];

export const CARE_INTAKE_RESPONSE_STATUSES = [
  "in-progress",
  "completed",
  "amended",
  "entered-in-error",
  "stopped",
] as const;
export type CareIntakeResponseStatus =
  (typeof CARE_INTAKE_RESPONSE_STATUSES)[number];

export const CARE_INTAKE_SOURCE_MODES = [
  "patient-mobile",
  "patient-web",
  "proxy-mobile",
  "proxy-web",
  "kiosk",
  "staff-assisted",
  "paper-transcribed",
] as const;
export type CareIntakeSourceMode =
  (typeof CARE_INTAKE_SOURCE_MODES)[number];

export const CARE_INTAKE_EXCEPTION_TYPES = [
  "identity-review",
  "proxy-authority",
  "required-answer",
  "consent",
  "coverage",
  "document-quality",
  "reconciliation",
] as const;
export type CareIntakeExceptionType =
  (typeof CARE_INTAKE_EXCEPTION_TYPES)[number];

export type CareIntakeRequirement = {
  dynamicFormId: string;
  dynamicFormVersion: number;
  linkId: string;
  dataCategory: string;
  required: boolean;
};

export function requirementsForPinnedForm(
  requirements: CareIntakeRequirement[],
  form: { dynamicFormId: string; dynamicFormVersion: number },
): CareIntakeRequirement[] {
  const assigned = requirements.filter(
    (requirement) =>
      requirement.dynamicFormId === form.dynamicFormId
      && requirement.dynamicFormVersion === form.dynamicFormVersion,
  );
  if (assigned.length === 0) {
    throw new Error("Dynamic form is not assigned to this intake packet");
  }
  return assigned;
}

export type CareIntakeAnswerDescriptor = {
  linkId: string;
  dataCategory: string;
};

export function validateMinimumNecessaryAnswers(input: {
  requirements: CareIntakeRequirement[];
  allowedDataCategories: string[];
  answers: CareIntakeAnswerDescriptor[];
}): { ok: true } | { ok: false; errors: string[] } {
  const requirementByLinkId = new Map(
    input.requirements.map((requirement) => [requirement.linkId, requirement]),
  );
  const allowedCategories = new Set(input.allowedDataCategories);
  const errors = input.answers.flatMap((answer) => {
    const requirement = requirementByLinkId.get(answer.linkId);
    if (
      !requirement
      || requirement.dataCategory !== answer.dataCategory
      || !allowedCategories.has(answer.dataCategory)
    ) {
      return [`data-category-not-authorized:${answer.linkId}`];
    }
    return [];
  });

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export type CareIntakeReadiness = {
  ready: boolean;
  completionPercent: number;
  missingRequiredLinkIds: string[];
  blockers: string[];
};

export function calculateIntakeReadiness(input: {
  requirements: CareIntakeRequirement[];
  answeredLinkIds: string[];
  unresolvedExceptionCount: number;
  requiredConsentCount: number;
  acceptedConsentCount: number;
  requiredCoverageEvidence: boolean;
  acceptedCoverageEvidenceCount: number;
}): CareIntakeReadiness {
  const answered = new Set(input.answeredLinkIds);
  const required = input.requirements.filter((item) => item.required);
  const missingRequiredLinkIds = required
    .filter((item) => !answered.has(item.linkId))
    .map((item) => item.linkId);
  const consentComplete =
    input.acceptedConsentCount >= input.requiredConsentCount;
  const coverageComplete =
    !input.requiredCoverageEvidence || input.acceptedCoverageEvidenceCount > 0;
  const exceptionsComplete = input.unresolvedExceptionCount === 0;
  const completedRequired = required.length - missingRequiredLinkIds.length;
  const totalChecks =
    required.length
    + (input.requiredConsentCount > 0 ? 1 : 0)
    + (input.requiredCoverageEvidence ? 1 : 0)
    + 1;
  const completedChecks =
    completedRequired
    + (input.requiredConsentCount > 0 && consentComplete ? 1 : 0)
    + (input.requiredCoverageEvidence && coverageComplete ? 1 : 0)
    + (exceptionsComplete ? 1 : 0);
  const blockers: string[] = [];
  if (missingRequiredLinkIds.length > 0) {
    blockers.push("required-answers-missing");
  }
  if (!consentComplete) blockers.push("consent-incomplete");
  if (!coverageComplete) blockers.push("coverage-unverified");
  if (!exceptionsComplete) blockers.push("exceptions-unresolved");

  return {
    ready: blockers.length === 0,
    completionPercent:
      totalChecks === 0 ? 100 : Math.floor((completedChecks / totalChecks) * 100),
    missingRequiredLinkIds,
    blockers,
  };
}

const TRANSITIONS: Readonly<
  Record<CareIntakePacketStatus, readonly CareIntakePacketStatus[]>
> = {
  assigned: ["in-progress", "stopped", "entered-in-error"],
  "in-progress": ["completed", "stopped", "entered-in-error"],
  completed: ["amended", "entered-in-error"],
  amended: ["amended", "entered-in-error"],
  "entered-in-error": [],
  stopped: ["entered-in-error"],
};

export function assertCareIntakeTransition(
  from: CareIntakePacketStatus,
  to: CareIntakePacketStatus,
): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid care intake transition: ${from} -> ${to}`);
  }
}
