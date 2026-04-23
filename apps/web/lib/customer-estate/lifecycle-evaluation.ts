export type TechnologySourceType = "commercial" | "open_source" | "hybrid";

export type SupportModel =
  | "vendor_contract"
  | "subscription"
  | "community"
  | "lts"
  | "partner"
  | "unknown";

export type LifecycleStatus =
  | "current"
  | "review"
  | "renew"
  | "upgrade_due"
  | "replace_due"
  | "unknown";

export type SupportStatus =
  | "supported"
  | "approaching_end"
  | "expired"
  | "coverage_gap"
  | "unknown";

export type RecommendedAction =
  | "monitor"
  | "review"
  | "renew"
  | "upgrade"
  | "replace"
  | "research";

export type AttentionLevel = "low" | "medium" | "high";

export type TechnologyLifecycleInput = {
  name: string;
  ciType?: string | null;
  technologySourceType?: TechnologySourceType | null;
  supportModel?: SupportModel | null;
  normalizedVersion?: string | null;
  observedVersion?: string | null;
  warrantyEndAt?: string | Date | null;
  endOfSupportAt?: string | Date | null;
  endOfLifeAt?: string | Date | null;
  renewalDate?: string | Date | null;
  billingCadence?: string | null;
  customerChargeModel?: string | null;
  licenseQuantity?: number | null;
  unitCost?: number | null;
  customerUnitPrice?: number | null;
};

export type TechnologyLifecycleResult = {
  lifecycleStatus: LifecycleStatus;
  supportStatus: SupportStatus;
  recommendedAction: RecommendedAction;
  attentionLevel: AttentionLevel;
  licensingReviewRequired: boolean;
  nextReviewAt: Date | null;
  summary: string;
};

const REVIEW_WINDOW_DAYS = 120;
const RENEWAL_WINDOW_DAYS = 45;

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function daysUntil(target: Date, asOf: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((target.getTime() - asOf.getTime()) / msPerDay);
}

function hasRecurringCommercialBilling(input: TechnologyLifecycleInput): boolean {
  return Boolean(
    input.billingCadence &&
      input.customerChargeModel &&
      input.customerChargeModel !== "included" &&
      input.technologySourceType === "commercial",
  );
}

function pickNearestFutureDate(asOf: Date, dates: Array<Date | null>): Date | null {
  return dates
    .filter((date): date is Date => date !== null && date.getTime() >= asOf.getTime())
    .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
}

export function evaluateTechnologyLifecycle(
  input: TechnologyLifecycleInput,
  asOf: Date = new Date(),
): TechnologyLifecycleResult {
  const technologySourceType = input.technologySourceType ?? "commercial";
  const warrantyEndAt = toDate(input.warrantyEndAt);
  const endOfSupportAt = toDate(input.endOfSupportAt);
  const endOfLifeAt = toDate(input.endOfLifeAt);
  const renewalDate = toDate(input.renewalDate);
  const recurringBilling = hasRecurringCommercialBilling(input);
  const nextReviewAt = pickNearestFutureDate(asOf, [
    renewalDate,
    endOfSupportAt,
    endOfLifeAt,
    warrantyEndAt,
  ]);

  if (endOfLifeAt && endOfLifeAt.getTime() <= asOf.getTime()) {
    return {
      lifecycleStatus: "replace_due",
      supportStatus: "expired",
      recommendedAction: "replace",
      attentionLevel: "high",
      licensingReviewRequired: recurringBilling,
      nextReviewAt,
      summary: `${input.name} is past end of life and should be replaced.`,
    };
  }

  if (endOfSupportAt && endOfSupportAt.getTime() <= asOf.getTime()) {
    return {
      lifecycleStatus: "upgrade_due",
      supportStatus: "expired",
      recommendedAction: "upgrade",
      attentionLevel: "high",
      licensingReviewRequired: recurringBilling,
      nextReviewAt,
      summary: `${input.name} is past end of support and should be upgraded.`,
    };
  }

  if (renewalDate && daysUntil(renewalDate, asOf) <= RENEWAL_WINDOW_DAYS) {
    return {
      lifecycleStatus: "renew",
      supportStatus: "supported",
      recommendedAction: "renew",
      attentionLevel: "medium",
      licensingReviewRequired: true,
      nextReviewAt,
      summary: `${input.name} is nearing renewal and should be reviewed for recurring billing.`,
    };
  }

  if (endOfSupportAt && daysUntil(endOfSupportAt, asOf) <= REVIEW_WINDOW_DAYS) {
    return {
      lifecycleStatus: "review",
      supportStatus: "approaching_end",
      recommendedAction: "upgrade",
      attentionLevel: "medium",
      licensingReviewRequired: recurringBilling,
      nextReviewAt,
      summary:
        technologySourceType === "open_source"
          ? `${input.name} is nearing end of community/LTS support and should be upgraded.`
          : `${input.name} is nearing end of support and should be upgraded.`,
    };
  }

  if (warrantyEndAt && warrantyEndAt.getTime() <= asOf.getTime()) {
    return {
      lifecycleStatus: "review",
      supportStatus: "coverage_gap",
      recommendedAction: recurringBilling ? "renew" : "review",
      attentionLevel: "medium",
      licensingReviewRequired: recurringBilling,
      nextReviewAt,
      summary: `${input.name} is out of warranty and should be reviewed for support coverage.`,
    };
  }

  if (warrantyEndAt && daysUntil(warrantyEndAt, asOf) <= REVIEW_WINDOW_DAYS) {
    return {
      lifecycleStatus: "review",
      supportStatus: "approaching_end",
      recommendedAction: recurringBilling ? "renew" : "review",
      attentionLevel: "medium",
      licensingReviewRequired: recurringBilling,
      nextReviewAt,
      summary: `${input.name} warranty coverage should be reviewed soon.`,
    };
  }

  if (!nextReviewAt && !input.supportModel && !input.normalizedVersion && !input.observedVersion) {
    return {
      lifecycleStatus: "unknown",
      supportStatus: "unknown",
      recommendedAction: "research",
      attentionLevel: "low",
      licensingReviewRequired: recurringBilling,
      nextReviewAt: null,
      summary: `${input.name} needs more lifecycle evidence before support status can be determined.`,
    };
  }

  return {
    lifecycleStatus: "current",
    supportStatus: "supported",
    recommendedAction: "monitor",
    attentionLevel: "low",
    licensingReviewRequired: false,
    nextReviewAt,
    summary: `${input.name} is currently within expected support coverage.`,
  };
}
