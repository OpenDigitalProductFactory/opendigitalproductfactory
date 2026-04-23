import type { ActivationProfile } from "@dpf/storefront-templates";

type UnknownRecord = Record<string, unknown>;

const MODULES = new Set([
  "customer-estate",
  "service-agreements",
  "billing-readiness",
  "service-operations",
  "projects",
  "lifecycle-signals",
  "integrations",
] as const);

const PROFILE_TYPES = new Set(["standard", "managed-service-provider"] as const);
const BILLING_MODES = new Set(["none", "prepared-not-prescribed"] as const);
const GRAPH_MODES = new Set(["none", "separate-customer-projection"] as const);
const ESTATE_MODES = new Set(["shared", "strict"] as const);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export type ArchetypeActivationProfile = ActivationProfile;

export function readActivationProfile(raw: unknown): ArchetypeActivationProfile | null {
  if (!isRecord(raw)) return null;

  const profileType = raw.profileType;
  const modules = raw.modules;
  const billingReadinessMode = raw.billingReadinessMode;
  const customerGraph = raw.customerGraph;
  const estateSeparation = raw.estateSeparation;
  const seededServiceCategories = raw.seededServiceCategories;
  const seededConfigurationItemTypes = raw.seededConfigurationItemTypes;
  const seededBillingUnitTypes = raw.seededBillingUnitTypes;
  const seededChargeModels = raw.seededChargeModels;

  if (typeof profileType !== "string" || !PROFILE_TYPES.has(profileType as ActivationProfile["profileType"])) {
    return null;
  }

  if (!Array.isArray(modules) || modules.some((module) => typeof module !== "string" || !MODULES.has(module as ActivationProfile["modules"][number]))) {
    return null;
  }

  if (typeof billingReadinessMode !== "string" || !BILLING_MODES.has(billingReadinessMode as ActivationProfile["billingReadinessMode"])) {
    return null;
  }

  if (typeof customerGraph !== "string" || !GRAPH_MODES.has(customerGraph as ActivationProfile["customerGraph"])) {
    return null;
  }

  if (typeof estateSeparation !== "string" || !ESTATE_MODES.has(estateSeparation as ActivationProfile["estateSeparation"])) {
    return null;
  }

  if (seededServiceCategories !== undefined && !isStringArray(seededServiceCategories)) {
    return null;
  }

  if (
    seededConfigurationItemTypes !== undefined &&
    (!Array.isArray(seededConfigurationItemTypes) ||
      seededConfigurationItemTypes.some(
        (item) =>
          !isRecord(item) ||
          typeof item.key !== "string" ||
          typeof item.label !== "string" ||
          !["commercial", "open_source", "hybrid"].includes(String(item.technologySourceType)) ||
          (item.defaultReviewCadenceDays !== undefined && typeof item.defaultReviewCadenceDays !== "number") ||
          (item.supportsLicensing !== undefined && typeof item.supportsLicensing !== "boolean") ||
          (item.defaultChargeModel !== undefined && typeof item.defaultChargeModel !== "string"),
      ))
  ) {
    return null;
  }

  if (
    seededBillingUnitTypes !== undefined &&
    (!Array.isArray(seededBillingUnitTypes) ||
      seededBillingUnitTypes.some(
        (item) => !isRecord(item) || typeof item.key !== "string" || typeof item.label !== "string",
      ))
  ) {
    return null;
  }

  if (
    seededChargeModels !== undefined &&
    (!Array.isArray(seededChargeModels) ||
      seededChargeModels.some(
        (item) => !isRecord(item) || typeof item.key !== "string" || typeof item.label !== "string",
      ))
  ) {
    return null;
  }

  const normalizedProfileType = profileType as ActivationProfile["profileType"];
  const normalizedModules = modules as ActivationProfile["modules"];
  const normalizedBillingReadinessMode =
    billingReadinessMode as ActivationProfile["billingReadinessMode"];
  const normalizedCustomerGraph =
    customerGraph as ActivationProfile["customerGraph"];
  const normalizedEstateSeparation =
    estateSeparation as ActivationProfile["estateSeparation"];
  const normalizedSeededServiceCategories =
    seededServiceCategories as ActivationProfile["seededServiceCategories"];
  const normalizedSeededConfigurationItemTypes =
    seededConfigurationItemTypes as ActivationProfile["seededConfigurationItemTypes"];
  const normalizedSeededBillingUnitTypes =
    seededBillingUnitTypes as ActivationProfile["seededBillingUnitTypes"];
  const normalizedSeededChargeModels =
    seededChargeModels as ActivationProfile["seededChargeModels"];

  return {
    profileType: normalizedProfileType,
    modules: normalizedModules,
    billingReadinessMode: normalizedBillingReadinessMode,
    customerGraph: normalizedCustomerGraph,
    estateSeparation: normalizedEstateSeparation,
    ...(normalizedSeededServiceCategories
      ? { seededServiceCategories: normalizedSeededServiceCategories }
      : {}),
    ...(normalizedSeededConfigurationItemTypes
      ? { seededConfigurationItemTypes: normalizedSeededConfigurationItemTypes }
      : {}),
    ...(normalizedSeededBillingUnitTypes
      ? { seededBillingUnitTypes: normalizedSeededBillingUnitTypes }
      : {}),
    ...(normalizedSeededChargeModels
      ? { seededChargeModels: normalizedSeededChargeModels }
      : {}),
  };
}

export function isManagedServiceProviderProfile(
  profile: ArchetypeActivationProfile | null | undefined,
): profile is ArchetypeActivationProfile & { profileType: "managed-service-provider" } {
  return profile?.profileType === "managed-service-provider";
}

export function deriveRevenueModelFromActivationProfile(
  profile: ArchetypeActivationProfile | null | undefined,
  ctaType: string,
): string | null {
  if (isManagedServiceProviderProfile(profile)) {
    return "Managed service agreements with recurring schedules and customer-estate coverage";
  }

  const ctaRevenueModels: Record<string, string> = {
    booking: "Appointment-based services",
    purchase: "Product/service sales",
    inquiry: "Quote-based services",
    donation: "Donor-funded",
  };

  return ctaRevenueModels[ctaType] ?? null;
}

export function deriveCustomerConfigurationItemDefaults(
  profile: ArchetypeActivationProfile | null | undefined,
) {
  return {
    itemTypes: profile?.seededConfigurationItemTypes ?? [],
    billingUnitTypes: profile?.seededBillingUnitTypes ?? [],
    chargeModels: profile?.seededChargeModels ?? [],
  };
}
