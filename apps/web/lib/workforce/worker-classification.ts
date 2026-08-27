import type { RecordLifecycle, WorkerClassification } from "@dpf/db";

/**
 * What a worker classification MEANS, as typed values rather than prose
 * (BI-C61CEEA9).
 *
 * The point of the classification axis is that downstream code can ask a
 * question and get an answer. A label cannot be asked anything — reading
 * `EmploymentType.name` and matching on "Contractor" is how a system ends up
 * directing a contingent worker exactly like an employee, which is the
 * behavioural-control factor behind joint-employer and misclassification
 * findings.
 *
 * These consequences are the UNIVERSAL spine. Where a jurisdiction narrows one
 * further, that is policy data resolved through `RegulatoryAutonomyPolicy`
 * (BI-B506AD2E), not a second copy of this table. Nothing here is a legal
 * determination: the platform never decides a worker's classification, it only
 * makes a recorded determination consequential.
 */
export interface WorkerClassificationConsequences {
  /** Payroll withholding applies to payments for this engagement. */
  readonly payrollWithholding: boolean;
  /**
   * The organisation may direct HOW and WHEN the work is done — assign shifts,
   * mandate training, set working hours. The single most load-bearing flag
   * here: it is the behavioural-control test in nearly every jurisdiction.
   */
  readonly directable: boolean;
  /** The worker accrues leave and benefit entitlements from this engagement. */
  readonly accruesLeaveAndBenefits: boolean;
  /** The worker enters the organisation's performance review cycles. */
  readonly entersReviewCycles: boolean;
  /**
   * How the worker appears in the org chart. A `reporting-line` worker hangs
   * off a manager; an `engaged-party` is shown as connected to the work without
   * implying the organisation directs them.
   */
  readonly orgChartPlacement: "reporting-line" | "engaged-party";
  /**
   * The engagement is expected to carry a definite term (`WorkerEngagementTerm`).
   * Duration is itself a reclassification factor, so an open-ended engagement in
   * a class that expects a term is a drift signal, not a convenience.
   */
  readonly expectsDefiniteTerm: boolean;
  /**
   * Another legal entity is the employer of record. Where true, actions that
   * assert this organisation as employer are the ones most likely to create
   * joint-employer exposure.
   */
  readonly employedByThirdParty: boolean;
}

const CONSEQUENCES: Readonly<Record<WorkerClassification, WorkerClassificationConsequences>> = {
  employee: {
    payrollWithholding: true,
    directable: true,
    accruesLeaveAndBenefits: true,
    entersReviewCycles: true,
    orgChartPlacement: "reporting-line",
    expectsDefiniteTerm: false,
    employedByThirdParty: false,
  },
  contractor_direct: {
    payrollWithholding: false,
    directable: false,
    accruesLeaveAndBenefits: false,
    entersReviewCycles: false,
    orgChartPlacement: "engaged-party",
    expectsDefiniteTerm: true,
    employedByThirdParty: false,
  },
  contractor_agency: {
    payrollWithholding: false,
    directable: false,
    accruesLeaveAndBenefits: false,
    entersReviewCycles: false,
    orgChartPlacement: "engaged-party",
    expectsDefiniteTerm: true,
    employedByThirdParty: true,
  },
  temp_agency_worker: {
    payrollWithholding: false,
    directable: false,
    accruesLeaveAndBenefits: false,
    entersReviewCycles: false,
    orgChartPlacement: "engaged-party",
    expectsDefiniteTerm: true,
    employedByThirdParty: true,
  },
  eor_employee: {
    // The EOR withholds, not this organisation.
    payrollWithholding: false,
    // An EOR arrangement exists precisely so the client CAN direct day-to-day
    // work while the EOR carries employer obligations.
    directable: true,
    accruesLeaveAndBenefits: false,
    entersReviewCycles: true,
    orgChartPlacement: "reporting-line",
    expectsDefiniteTerm: false,
    employedByThirdParty: true,
  },
  volunteer: {
    payrollWithholding: false,
    // The sharpest constraint in the set. An unpaid worker directed like an
    // employee is a wage claim, and for nonprofit and community archetypes this
    // is the MAJORITY classification rather than an edge case.
    directable: false,
    accruesLeaveAndBenefits: false,
    entersReviewCycles: false,
    orgChartPlacement: "engaged-party",
    expectsDefiniteTerm: false,
    employedByThirdParty: false,
  },
  intern: {
    // Whether an internship may lawfully be unpaid is jurisdictional, so the
    // universal spine assumes the paid, directable shape and lets a jurisdiction
    // policy narrow it rather than assuming the permissive case.
    payrollWithholding: true,
    directable: true,
    accruesLeaveAndBenefits: false,
    entersReviewCycles: false,
    orgChartPlacement: "reporting-line",
    expectsDefiniteTerm: true,
    employedByThirdParty: false,
  },
  board_member: {
    payrollWithholding: false,
    directable: false,
    accruesLeaveAndBenefits: false,
    entersReviewCycles: false,
    orgChartPlacement: "engaged-party",
    expectsDefiniteTerm: false,
    employedByThirdParty: false,
  },
};

/** Typed consequences for a recorded classification. */
export function consequencesFor(
  classification: WorkerClassification,
): WorkerClassificationConsequences {
  return CONSEQUENCES[classification];
}

/** Why a worker's classification could not be resolved. */
export type UnresolvedClassificationReason =
  /** The worker has no employment type recorded at all. */
  | "no-employment-type"
  /**
   * The employment type exists but its legal axis was never determined — the
   * migration could not read its label confidently and refused to guess.
   */
  | "employment-type-unclassified";

export type ClassificationResolution =
  | { readonly resolved: true; readonly classification: WorkerClassification }
  | { readonly resolved: false; readonly reason: UnresolvedClassificationReason };

/**
 * Resolve a worker's classification from their employment type.
 *
 * Fails LOUDLY, in the same posture as `approval-routing.ts` and the employment
 * jurisdiction resolver: an unresolved classification is operator work naming
 * its reason, never a silent default to `employee`. A silent default here would
 * be a confidently wrong legal claim, which is worse than no answer — and it is
 * the permissive answer in every case, so guessing always errs toward directing
 * someone the organisation may not direct.
 */
export function resolveClassification(worker: {
  employmentType?: { classification: WorkerClassification | null } | null;
}): ClassificationResolution {
  const employmentType = worker.employmentType;
  if (!employmentType) return { resolved: false, reason: "no-employment-type" };
  if (!employmentType.classification) {
    return { resolved: false, reason: "employment-type-unclassified" };
  }
  return { resolved: true, classification: employmentType.classification };
}

/**
 * Whether an engagement's recorded term has drifted past what its classification
 * expects, which is a re-determination trigger rather than an error.
 *
 * Duration is one of the factors that turns a contractor into an employee, so an
 * engagement that expects a definite term and has none — or whose term has
 * lapsed while the engagement continues — is exactly the drift the standing
 * `worker-classification-review` room exists to surface.
 */
export function engagementTermDrift(
  classification: WorkerClassification,
  term: { endsOn: Date; lifecycle: RecordLifecycle } | null,
  now: Date,
): { readonly drifted: boolean; readonly reason?: "missing-term" | "term-lapsed" } {
  if (!consequencesFor(classification).expectsDefiniteTerm) return { drifted: false };
  if (!term) return { drifted: true, reason: "missing-term" };
  if (term.lifecycle !== "active") return { drifted: false };
  return term.endsOn.getTime() < now.getTime()
    ? { drifted: true, reason: "term-lapsed" }
    : { drifted: false };
}
