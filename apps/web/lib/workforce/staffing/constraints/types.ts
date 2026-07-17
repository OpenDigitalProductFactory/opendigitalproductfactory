/**
 * Workforce staffing — deterministic constraint model (EP-WORKFORCE-OPS /
 * BI-4AD09A35 Phase 2). Spec §8 (constraint & objective model) + §9.8 (variable
 * families). These types are the normalized, versioned problem the constraint
 * engine evaluates and, later, the solver adapter (Phase 3) consumes. Evaluation
 * is pure and side-effect-free: it reads a snapshot and returns violations +
 * priced premiums, never touching the database.
 *
 * The engine is deterministic and independent of any solver: a solver may
 * PROPOSE assignments, but hard-rule feasibility is always validated here, in
 * DPF, after the solve (spec §7.3).
 */

/** Instant + the timezone the scheduling decision is anchored in (spec §5.3). */
export type ZonedInstant = {
  /** UTC instant. */
  at: string;
  /** IANA timezone the local-clock rules apply in, e.g. "America/Los_Angeles". */
  timezone: string;
};

/** Where the work happens — drives jurisdiction resolution (spec §6). */
export type JurisdictionContext = {
  country: string | null;
  /** State/province/region subdivision code, e.g. "US-CA". */
  region: string | null;
  /** True once the deploying org's employsIn + work location resolve a pack. */
  resolved: boolean;
};

export type EmployeeInput = {
  employeeProfileId: string;
  /** Credential keys the employee currently holds, with expiry (spec §9.3). */
  credentials: Array<{ key: string; expiresAt: string | null }>;
  /** Capability keys the employee is authorized for (e.g. "dea_keyholder"). */
  capabilities: string[];
  /** Role key used by pairing-ratio rules (e.g. "journeyman", "apprentice"). */
  roleKey: string | null;
  employmentType: string | null;
};

export type ShiftInput = {
  shiftId: string;
  interval: { start: ZonedInstant; end: ZonedInstant };
  workLocationId: string | null;
  /** Credentials the shift's role requires of every assignee. */
  requiredCredentials: string[];
};

export type AssignmentInput = {
  assignmentId: string;
  shiftId: string;
  employeeProfileId: string;
  /** Only confirmed/published assignments bind hard rules like non-overlap. */
  lifecycle: string;
};

/**
 * A rule instance drawn from a StaffingConstraintRule row (or a starter pack).
 * `predicateType` selects the evaluator; `parameters` is the typed payload for
 * that predicate; `applicability` scopes it (spec §6).
 */
export type ConstraintRuleInput = {
  ruleId: string;
  predicateType: string;
  severity: "hard" | "soft";
  legallyWaivable: boolean;
  parameters: Record<string, unknown>;
  applicability?: {
    jurisdictionRegion?: string | null;
    employmentType?: string | null;
  };
  sourcePolicyUrl?: string | null;
};

export type NormalizedStaffingProblem = {
  organizationId: string;
  jurisdiction: JurisdictionContext;
  employees: EmployeeInput[];
  shifts: ShiftInput[];
  assignments: AssignmentInput[];
  rules: ConstraintRuleInput[];
};

/** A hard-rule breach. `waivable` gates whether an exception request is allowed. */
export type ConstraintViolation = {
  ruleId: string;
  predicateType: string;
  subjectRef: string;
  message: string;
  waivable: boolean;
  sourcePolicyUrl?: string | null;
};

/**
 * A priced schedule-shape cost (spec §9.4): a feasible schedule can still be an
 * expensive one. Premiums never make a schedule infeasible; they surface in the
 * objective decomposition in currency-neutral units the caller monetizes.
 */
export type PremiumLine = {
  ruleId: string;
  predicateType: string;
  subjectRef: string;
  /** Abstract cost units (e.g. premium-hours) the caller prices per §8.2. */
  units: number;
  message: string;
};

export type EvaluationResult = {
  feasible: boolean;
  violations: ConstraintViolation[];
  premiums: PremiumLine[];
  /**
   * True when a safety-critical rule could not be evaluated because the
   * jurisdiction/policy is unresolved. The caller must withhold a publishable
   * proposal and return "requires policy review" (spec §6, §8.1) — unknown data
   * is not automatically false for safety-critical eligibility.
   */
  requiresPolicyReview: boolean;
};

/** Pure evaluator for one predicate family. Returns violations and/or premiums. */
export type PredicateEvaluator = (
  rule: ConstraintRuleInput,
  problem: NormalizedStaffingProblem,
) => { violations?: ConstraintViolation[]; premiums?: PremiumLine[] };
