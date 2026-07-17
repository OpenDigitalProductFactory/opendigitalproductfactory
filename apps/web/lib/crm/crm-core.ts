// apps/web/lib/crm/crm-core.ts
//
// Pure (no prisma / auth / Next.js) domain helpers for CRM: string/date
// coercion, lifecycle-confidence derivation, configuration-item lifecycle-state
// assembly, required-field validation, and quote line-total computation.
// Extracted verbatim from lib/actions/crm.ts (BI-OPT-FAT-ACTIONS, CRM slice) so
// the deterministic domain logic lives in the CRM domain layer and is
// unit-testable on its own. Behavior-preserving relocation — identical bodies.

import { evaluateTechnologyLifecycle } from "@/lib/customer-estate/lifecycle-evaluation";

export type CustomerConfigurationItemInput = {
  siteId?: string;
  name: string;
  ciType: string;
  technologySourceType?: "commercial" | "open_source" | "hybrid";
  supportModel?: string;
  manufacturer?: string;
  normalizedVersion?: string;
  observedVersion?: string;
  billingCadence?: string;
  customerChargeModel?: string;
  renewalDate?: string | Date | null;
  endOfSupportAt?: string | Date | null;
  endOfLifeAt?: string | Date | null;
  warrantyEndAt?: string | Date | null;
  reviewCadenceDays?: number;
  licenseQuantity?: number | null;
  status?: string;
  evidenceSource?: string;
  evidenceNotes?: string;
};

export function trimOrNull(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function toDateOrNull(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function readLifecycleEvidenceField(
  value: unknown,
  key: "source" | "notes",
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  return typeof record[key] === "string" ? record[key] : undefined;
}

export function deriveLifecycleConfidence(input: {
  supportModel: string | null;
  normalizedVersion: string | null;
  observedVersion: string | null;
  renewalDate: Date | null;
  endOfSupportAt: Date | null;
  endOfLifeAt: Date | null;
  warrantyEndAt: Date | null;
  evidenceSource: string | null;
  evidenceNotes: string | null;
}) {
  let confidence = 0.35;

  if (input.supportModel) confidence += 0.15;
  if (input.normalizedVersion || input.observedVersion) confidence += 0.15;
  if (input.renewalDate || input.endOfSupportAt || input.endOfLifeAt || input.warrantyEndAt) confidence += 0.2;
  if (input.evidenceSource) confidence += 0.1;
  if (input.evidenceNotes) confidence += 0.05;

  return Math.min(0.95, Number(confidence.toFixed(2)));
}

export function buildCustomerConfigurationItemLifecycleState(input: CustomerConfigurationItemInput) {
  const supportModel = trimOrNull(input.supportModel);
  const manufacturer = trimOrNull(input.manufacturer);
  const normalizedVersion = trimOrNull(input.normalizedVersion);
  const observedVersion = trimOrNull(input.observedVersion);
  const billingCadence = trimOrNull(input.billingCadence);
  const customerChargeModel = trimOrNull(input.customerChargeModel);
  const evidenceSource = trimOrNull(input.evidenceSource);
  const evidenceNotes = trimOrNull(input.evidenceNotes);
  const renewalDate = toDateOrNull(input.renewalDate);
  const endOfSupportAt = toDateOrNull(input.endOfSupportAt);
  const endOfLifeAt = toDateOrNull(input.endOfLifeAt);
  const warrantyEndAt = toDateOrNull(input.warrantyEndAt);

  const lifecycle = evaluateTechnologyLifecycle(
    {
      name: input.name,
      ciType: input.ciType,
      technologySourceType: input.technologySourceType ?? "commercial",
      supportModel: (supportModel as
        | "vendor_contract"
        | "subscription"
        | "community"
        | "lts"
        | "partner"
        | "unknown"
        | null
        | undefined) ?? undefined,
      normalizedVersion,
      observedVersion,
      billingCadence,
      customerChargeModel,
      renewalDate,
      endOfSupportAt,
      endOfLifeAt,
      warrantyEndAt,
      licenseQuantity: input.licenseQuantity ?? undefined,
    },
    new Date(),
  );

  const nextLifecycleReviewAt =
    lifecycle.nextReviewAt ??
    (input.reviewCadenceDays
      ? new Date(Date.now() + input.reviewCadenceDays * 24 * 60 * 60 * 1000)
      : null);

  return {
    supportModel,
    manufacturer,
    normalizedVersion,
    observedVersion,
    billingCadence,
    customerChargeModel,
    renewalDate,
    endOfSupportAt,
    endOfLifeAt,
    warrantyEndAt,
    lifecycleStatus: lifecycle.lifecycleStatus,
    supportStatus: lifecycle.supportStatus,
    recommendedAction: lifecycle.recommendedAction,
    lifecycleConfidence: deriveLifecycleConfidence({
      supportModel,
      normalizedVersion,
      observedVersion,
      renewalDate,
      endOfSupportAt,
      endOfLifeAt,
      warrantyEndAt,
      evidenceSource,
      evidenceNotes,
    }),
    lastLifecycleReviewAt: new Date(),
    nextLifecycleReviewAt,
    lifecycleEvidence: {
      summary: lifecycle.summary,
      seededReviewCadenceDays: input.reviewCadenceDays ?? null,
      source: evidenceSource,
      notes: evidenceNotes,
    },
  };
}

export function requiredTrimmed(value: string | null | undefined, label: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  return trimmed;
}

/** Calculate line total: unitPrice * quantity * (1 - discountPercent/100) */
export function calcLineTotal(
  unitPrice: number,
  quantity: number,
  discountPercent: number,
): number {
  return unitPrice * quantity * (1 - discountPercent / 100);
}
