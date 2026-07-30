export const PRODUCT_OBJECTIVE_STATUSES = [
  "draft",
  "active",
  "closed",
  "archived",
] as const;
export type ProductObjectiveStatus =
  (typeof PRODUCT_OBJECTIVE_STATUSES)[number];

export const PRODUCT_OUTCOME_MEASURE_KINDS = [
  "number",
  "percentage",
  "currency",
  "duration",
  "qualitative",
] as const;
export type ProductOutcomeMeasureKind =
  (typeof PRODUCT_OUTCOME_MEASURE_KINDS)[number];

export const PRODUCT_OBJECTIVE_WORK_CONTRIBUTION_KINDS = [
  "demand",
  "funded-bet",
  "delivery",
  "release",
] as const;
export type ProductObjectiveWorkContributionKind =
  (typeof PRODUCT_OBJECTIVE_WORK_CONTRIBUTION_KINDS)[number];

export const PRODUCT_OUTCOME_SOURCE_KINDS = [
  "manual",
  "product-sold",
  "booking",
  "order",
  "subscription",
  "fulfillment",
  "crm",
  "finance",
  "analytics",
  "delivery",
  "research",
] as const;
export type ProductOutcomeSourceKind =
  (typeof PRODUCT_OUTCOME_SOURCE_KINDS)[number];

export const PRODUCT_OBJECTIVE_REVIEW_CADENCES = [
  "weekly",
  "monthly",
  "quarterly",
  "custom",
] as const;
export type ProductObjectiveReviewCadence =
  (typeof PRODUCT_OBJECTIVE_REVIEW_CADENCES)[number];

type ContractValidation =
  | { ok: true }
  | {
      ok: false;
      code:
        | "qualitative-numeric-value"
        | "quantitative-narrative-value"
        | "unit-required"
        | "percentage-out-of-range"
        | "target-required";
      message: string;
    };

export type ObjectiveMeasureContract = {
  measureKind: ProductOutcomeMeasureKind;
  measureUnit: string | null;
  baselineValue: number | null;
  targetValue: number | null;
  baselineNarrative: string | null;
  targetNarrative: string | null;
};

export function validateObjectiveContract(
  contract: ObjectiveMeasureContract,
): ContractValidation {
  if (contract.measureKind === "qualitative") {
    if (contract.baselineValue !== null || contract.targetValue !== null) {
      return {
        ok: false,
        code: "qualitative-numeric-value",
        message:
          "Qualitative outcomes use narrative expectations, not invented numeric values.",
      };
    }
    if (!contract.targetNarrative?.trim()) {
      return {
        ok: false,
        code: "target-required",
        message: "Describe the qualitative change you hope to observe.",
      };
    }
    return { ok: true };
  }

  if (contract.baselineNarrative || contract.targetNarrative) {
    return {
      ok: false,
      code: "quantitative-narrative-value",
      message:
        "Quantitative outcomes use numeric baseline and target values. Put context in the measure definition.",
    };
  }
  if (contract.targetValue === null) {
    return {
      ok: false,
      code: "target-required",
      message: "A quantitative target is required.",
    };
  }
  if (
    contract.measureKind === "currency" ||
    contract.measureKind === "duration" ||
    contract.measureKind === "number"
  ) {
    if (!contract.measureUnit?.trim()) {
      return {
        ok: false,
        code: "unit-required",
        message: "Name the unit so observations can be compared safely.",
      };
    }
  }
  if (
    contract.measureKind === "percentage" &&
    [contract.baselineValue, contract.targetValue].some(
      (value) => value !== null && (value < 0 || value > 100),
    )
  ) {
    return {
      ok: false,
      code: "percentage-out-of-range",
      message: "Percentage values must be between 0 and 100.",
    };
  }
  return { ok: true };
}

type ObservationMeasure = {
  numericValue: number | null;
  narrative: string | null;
  measureKind: ProductOutcomeMeasureKind;
  measureUnit: string | null;
};

export type ProductObjectivePosture =
  | {
      availability: "available";
      direction: "increase" | "decrease" | "maintain";
      state: "improving" | "regressing" | "unchanged" | "on-target";
      progress: number;
      latestValue: number;
    }
  | {
      availability: "qualitative";
      state: "review-needed";
      latestNarrative: string;
    }
  | {
      availability: "insufficient-evidence";
      state: "unknown";
      reason: "baseline-missing" | "observation-missing" | "target-missing";
    }
  | {
      availability: "incompatible";
      state: "unknown";
      reason: "measure-contract-changed" | "observation-value-missing";
    };

function sameMeasureContract(
  objective: Pick<ObjectiveMeasureContract, "measureKind" | "measureUnit">,
  observation: Pick<ObservationMeasure, "measureKind" | "measureUnit">,
): boolean {
  return (
    objective.measureKind === observation.measureKind &&
    (objective.measureUnit ?? "").toLocaleLowerCase() ===
      (observation.measureUnit ?? "").toLocaleLowerCase()
  );
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function deriveObjectivePosture(input: Pick<
  ObjectiveMeasureContract,
  "measureKind" | "measureUnit" | "baselineValue" | "targetValue" | "targetNarrative"
> & {
  latestObservation: ObservationMeasure | null;
}): ProductObjectivePosture {
  if (!input.latestObservation) {
    return {
      availability: "insufficient-evidence",
      state: "unknown",
      reason: "observation-missing",
    };
  }
  if (!sameMeasureContract(input, input.latestObservation)) {
    return {
      availability: "incompatible",
      state: "unknown",
      reason: "measure-contract-changed",
    };
  }
  if (input.measureKind === "qualitative") {
    if (!input.latestObservation.narrative?.trim()) {
      return {
        availability: "incompatible",
        state: "unknown",
        reason: "observation-value-missing",
      };
    }
    return {
      availability: "qualitative",
      state: "review-needed",
      latestNarrative: input.latestObservation.narrative.trim(),
    };
  }
  if (input.baselineValue === null) {
    return {
      availability: "insufficient-evidence",
      state: "unknown",
      reason: "baseline-missing",
    };
  }
  if (input.targetValue === null) {
    return {
      availability: "insufficient-evidence",
      state: "unknown",
      reason: "target-missing",
    };
  }
  if (input.latestObservation.numericValue === null) {
    return {
      availability: "incompatible",
      state: "unknown",
      reason: "observation-value-missing",
    };
  }

  const baseline = input.baselineValue;
  const target = input.targetValue;
  const latest = input.latestObservation.numericValue;
  if (target === baseline) {
    return {
      availability: "available",
      direction: "maintain",
      state:
        latest === target
          ? "on-target"
          : latest === baseline
            ? "unchanged"
            : "regressing",
      progress: latest === target ? 1 : 0,
      latestValue: latest,
    };
  }

  const direction = target > baseline ? "increase" : "decrease";
  const progress = clampProgress((latest - baseline) / (target - baseline));
  const onTarget = direction === "increase" ? latest >= target : latest <= target;
  const improving =
    direction === "increase" ? latest > baseline : latest < baseline;
  return {
    availability: "available",
    direction,
    state: onTarget
      ? "on-target"
      : latest === baseline
        ? "unchanged"
        : improving
          ? "improving"
          : "regressing",
    progress,
    latestValue: latest,
  };
}

export function isObjectiveReviewDue(
  objective: { status: string; reviewAt: Date | null },
  requestedAt: Date,
): boolean {
  return (
    objective.status === "active" &&
    objective.reviewAt !== null &&
    objective.reviewAt.getTime() <= requestedAt.getTime()
  );
}

const LEGAL_OBJECTIVE_TRANSITIONS: Record<
  ProductObjectiveStatus,
  readonly ProductObjectiveStatus[]
> = {
  draft: ["active", "archived"],
  active: ["closed", "archived"],
  closed: ["archived"],
  archived: [],
};

export function validateObjectiveStatusTransition(
  from: ProductObjectiveStatus,
  to: ProductObjectiveStatus,
):
  | { ok: true }
  | {
      ok: false;
      code: "illegal-status-transition";
      message: string;
    } {
  if (LEGAL_OBJECTIVE_TRANSITIONS[from].includes(to)) return { ok: true };
  return {
    ok: false,
    code: "illegal-status-transition",
    message: `A product objective cannot move from ${from} to ${to}.`,
  };
}

export type ProductOutcomeObservationView = {
  observationId: string;
  observedAt: Date;
  numericValue: number | null;
  narrative: string | null;
  sourceKind: string;
  sourceRef: string | null;
  confidence: number | null;
  recordedBy: { principalId: string; displayName: string } | null;
  supersedesObservationId: string | null;
  supersededByObservationId: string | null;
  createdAt: Date;
};

export type ProductObjectiveView = {
  objectiveId: string;
  title: string;
  problemStatement: string | null;
  outcomeHypothesis: string;
  status: ProductObjectiveStatus;
  owner: { principalId: string; displayName: string } | null;
  measureKind: ProductOutcomeMeasureKind;
  measureDefinition: string;
  measureUnit: string | null;
  baselineValue: number | null;
  targetValue: number | null;
  baselineNarrative: string | null;
  targetNarrative: string | null;
  reviewCadence: string | null;
  reviewAt: Date | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  observations: ProductOutcomeObservationView[];
  contributingWork: Array<{
    itemId: string;
    title: string;
    status: string;
    contributionKind: string;
  }>;
  posture: ProductObjectivePosture;
  reviewDue: boolean;
  postureChanged: boolean;
};

function postureFingerprint(posture: ProductObjectivePosture): string {
  return `${posture.availability}:${posture.state}`;
}

export function projectProductObjective(input: Omit<
  ProductObjectiveView,
  "posture" | "reviewDue" | "postureChanged"
> & {
  observationMeasures: ObservationMeasure[];
}, requestedAt: Date): ProductObjectiveView {
  const [latest, previous] = input.observationMeasures;
  const posture = deriveObjectivePosture({
    measureKind: input.measureKind,
    measureUnit: input.measureUnit,
    baselineValue: input.baselineValue,
    targetValue: input.targetValue,
    targetNarrative: input.targetNarrative,
    latestObservation: latest ?? null,
  });
  const previousPosture = previous
    ? deriveObjectivePosture({
        measureKind: input.measureKind,
        measureUnit: input.measureUnit,
        baselineValue: input.baselineValue,
        targetValue: input.targetValue,
        targetNarrative: input.targetNarrative,
        latestObservation: previous,
      })
    : null;
  const { observationMeasures: _observationMeasures, ...view } = input;
  return {
    ...view,
    posture,
    reviewDue: isObjectiveReviewDue(input, requestedAt),
    postureChanged:
      previousPosture !== null &&
      postureFingerprint(previousPosture) !== postureFingerprint(posture),
  };
}
