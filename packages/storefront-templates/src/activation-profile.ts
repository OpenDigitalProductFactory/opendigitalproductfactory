import {
  deriveBillingPatternProfile,
  deriveCapabilityApplicability,
  derivePartnerProgramProfile,
} from "./applicability-rules";
import { needsFieldDispatch } from "./field-dispatch";
import {
  isCapabilityKey,
  type CapabilityKey,
} from "./capability-registry";
import type {
  ActivationProfile,
  ArchetypeProcessProfile,
  ArchetypeModule,
  BillingPatternProfile,
  CatalogMode,
  CapabilityActivation,
  CapabilityApplicability,
  CapabilityOverride,
  CommercialModel,
  ConsumptionChannel,
  CustomerGraphMode,
  EstateSeparationMode,
  GovernanceModel,
  It4ItStage,
  OperatingModelAxes,
  OperatingModelDelivery,
  OperatingModelForm,
  OwnershipScope,
  PartnerProgramProfile,
  PlatformEcosystem,
  PortfolioDecomposition,
  PortfolioScope,
  PrimaryConsumer,
  ProvisioningModel,
  TransactionContext,
  CapabilityIsolation,
} from "./types";

type UnknownRecord = Record<string, unknown>;

const MODULES = new Set<ArchetypeModule>([
  "customer-estate",
  "service-agreements",
  "billing-readiness",
  "service-operations",
  "projects",
  "lifecycle-signals",
  "integrations",
  "rental-fleet",
  "rental-agreements",
  "field-dispatch",
]);

const PROFILE_TYPES = new Set(["standard", "managed-service-provider"] as const);
const BILLING_MODES = new Set(["none", "prepared-not-prescribed"] as const);
const GRAPH_MODES = new Set<CustomerGraphMode>(["none", "separate-customer-projection"]);
const ESTATE_MODES = new Set<EstateSeparationMode>(["shared", "strict"]);
const CATALOG_MODES = new Set<CatalogMode>(["priced", "donation", "unpriced"]);
const PROCESS_PROFILE_KEYS = new Set([
  "catalogModes",
  "subjectTypes",
  "housesSubjects",
  "schedulesSubjects",
  "resourceKinds",
  "valueStreams",
  "supportingCapabilities",
  "omittedBackboneStages",
]);
const PROCESS_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_PROCESS_SLUG_LENGTH = 63;
const MAX_RESOURCE_CAPACITY = 1_000_000;

const FORM_VALUES = new Set<OperatingModelForm>(["goods", "services"]);
const DELIVERY_VALUES = new Set<OperatingModelDelivery>(["digital", "physical", "hybrid"]);
const PRIMARY_CONSUMER_VALUES = new Set<PrimaryConsumer>([
  "individual",
  "household",
  "business",
  "patient-and-payer",
  "channel-partner",
  "internal",
  "member",
  "resident",
]);
const CHANNEL_VALUES = new Set<ConsumptionChannel>([
  "physical",
  "web-app",
  "portal-api",
  "sales-assisted",
  "onsite-plus-portal",
  "api-portal-cli",
  "multi-channel",
  "portal-dashboard",
]);
const COMMERCIAL_MODEL_VALUES = new Set<CommercialModel>([
  "transactional",
  "subscription",
  "recurring-agreement",
  "usage-based",
  "account-based-fees",
  "encounter-based",
  "appointment-checkout",
  "point-of-sale",
  "statutory-fees-and-levies",
  "hybrid",
]);
const GOVERNANCE_VALUES = new Set<GovernanceModel>([
  "investor-owned",
  "member-owned",
  "public-body",
]);
const PROVISIONING_VALUES = new Set<ProvisioningModel>([
  "none",
  "account-with-billing",
  "account-and-entitlement",
  "account-with-kyc",
  "device-bound",
  "episode-of-care",
  "reservation-and-return",
  "custody-and-fulfilment",
]);
const PLATFORM_VALUES = new Set<PlatformEcosystem>(["no", "yes-marketplace", "yes-developer"]);
const PORTFOLIO_SCOPES = new Set<PortfolioScope>(["absent", "minimal", "standard", "primary"]);
const IT4IT_STAGES = new Set<It4ItStage>([
  "strategy-to-portfolio",
  "requirement-to-deploy",
  "request-to-fulfill",
  "detect-to-correct",
  "deploy-to-operate",
]);
const APPLICABILITY_VALUES = new Set<CapabilityApplicability>([
  "required",
  "recommended",
  "optional",
  "hidden",
  "not-applicable",
]);
const OWNERSHIP_SCOPE_VALUES = new Set<OwnershipScope>([
  "organization",
  "customer-account",
  "customer-site",
  "configuration-item",
  "edge-node",
  "partner-account",
]);
const TRANSACTION_CONTEXT_VALUES = new Set<TransactionContext>([
  "service-agreement",
  "engagement",
  "appointment",
  "order",
  "billing-period",
  "episode-of-care",
]);
const ISOLATION_VALUES = new Set<CapabilityIsolation>([
  "organization-scope",
  "strict-customer-scope",
  "shared",
  "strict-partner-scope",
]);

/**
 * Axes after normalization: `governance` is always resolved (absent legacy
 * values default to "investor-owned"), so downstream consumers never branch
 * on its presence.
 */
export type NormalizedOperatingModelAxes = OperatingModelAxes & {
  governance: GovernanceModel;
};

export interface NormalizedActivationProfile extends ActivationProfile {
  axes: NormalizedOperatingModelAxes;
  portfolios: PortfolioDecomposition;
  capabilityOverrides: CapabilityOverride[];
  billingProfile: BillingPatternProfile;
  partnerProgram: PartnerProgramProfile;
  capabilityActivations: CapabilityActivation[];
  processProfile: ArchetypeProcessProfile;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isProcessSlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_PROCESS_SLUG_LENGTH &&
    PROCESS_SLUG.test(value)
  );
}

function hasUniqueValues(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function isProcessText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 500;
}

function readValueStreams(raw: unknown): ArchetypeProcessProfile["valueStreams"] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;

  const streams = [];
  const streamKeys = new Set<string>();
  const stageKeys = new Set<string>();
  const handoffTargets: string[] = [];

  for (const stream of raw) {
    if (
      !isRecord(stream) ||
      Object.keys(stream).some(
        (key) => !["key", "label", "purpose", "input", "output", "responsibleRole", "loadBearingStageKeys", "stages"].includes(key),
      ) ||
      !isProcessSlug(stream.key) ||
      streamKeys.has(stream.key) ||
      !isProcessText(stream.label) ||
      !isProcessText(stream.purpose) ||
      !isProcessText(stream.input) ||
      !isProcessText(stream.output) ||
      !isProcessText(stream.responsibleRole) ||
      !Array.isArray(stream.loadBearingStageKeys) ||
      stream.loadBearingStageKeys.some((key) => !isProcessSlug(key)) ||
      !hasUniqueValues(stream.loadBearingStageKeys as string[]) ||
      !Array.isArray(stream.stages) ||
      stream.stages.length === 0
    ) {
      return null;
    }

    streamKeys.add(stream.key);
    const stages = [];
    const streamStageKeys = new Set<string>();
    for (const stage of stream.stages) {
      if (
        !isRecord(stage) ||
        Object.keys(stage).some(
          (key) => !["key", "label", "input", "output", "responsibleRole", "trustGateKeys", "handoffTo", "capabilityBindings", "metricBindings", "coversBackboneStages"].includes(key),
        ) ||
        !isProcessSlug(stage.key) ||
        stageKeys.has(stage.key) ||
        !isProcessText(stage.label) ||
        !isProcessText(stage.input) ||
        !isProcessText(stage.output) ||
        !isProcessText(stage.responsibleRole) ||
        !Array.isArray(stage.trustGateKeys) ||
        stage.trustGateKeys.some((key) => !isProcessSlug(key)) ||
        !hasUniqueValues(stage.trustGateKeys as string[]) ||
        (stage.handoffTo !== undefined && !isProcessSlug(stage.handoffTo)) ||
        (stage.capabilityBindings !== undefined &&
          (!Array.isArray(stage.capabilityBindings) || stage.capabilityBindings.some((module) => !MODULES.has(module as ArchetypeModule)))) ||
        (stage.metricBindings !== undefined &&
          (!Array.isArray(stage.metricBindings) || stage.metricBindings.some((metric) => !isProcessSlug(metric)))) ||
        (stage.coversBackboneStages !== undefined &&
          (!Array.isArray(stage.coversBackboneStages) ||
            stage.coversBackboneStages.some((key) => !isProcessSlug(key)) ||
            !hasUniqueValues(stage.coversBackboneStages as string[])))
      ) {
        return null;
      }

      stageKeys.add(stage.key);
      streamStageKeys.add(stage.key);
      if (stage.handoffTo !== undefined) handoffTargets.push(stage.handoffTo);
      stages.push({
        key: stage.key,
        label: stage.label,
        input: stage.input,
        output: stage.output,
        responsibleRole: stage.responsibleRole,
        trustGateKeys: stage.trustGateKeys as string[],
        ...(stage.handoffTo !== undefined ? { handoffTo: stage.handoffTo } : {}),
        ...(stage.capabilityBindings !== undefined ? { capabilityBindings: stage.capabilityBindings as ArchetypeModule[] } : {}),
        ...(stage.metricBindings !== undefined ? { metricBindings: stage.metricBindings as string[] } : {}),
        ...(stage.coversBackboneStages !== undefined
          ? { coversBackboneStages: stage.coversBackboneStages as string[] }
          : {}),
      });
    }

    if ((stream.loadBearingStageKeys as string[]).some((key) => !streamStageKeys.has(key))) {
      return null;
    }

    streams.push({
      key: stream.key,
      label: stream.label,
      purpose: stream.purpose,
      input: stream.input,
      output: stream.output,
      responsibleRole: stream.responsibleRole,
      loadBearingStageKeys: stream.loadBearingStageKeys as string[],
      stages,
    });
  }

  if (handoffTargets.some((target) => !stageKeys.has(target))) return null;
  return streams;
}

function readProcessProfile(raw: unknown): ArchetypeProcessProfile | null {
  if (raw === undefined) {
    return {
      catalogModes: [],
      subjectTypes: [],
      housesSubjects: false,
      schedulesSubjects: false,
      resourceKinds: [],
      valueStreams: [],
      supportingCapabilities: [],
      omittedBackboneStages: [],
    };
  }

  if (
    !isRecord(raw) ||
    Object.keys(raw).some((key) => !PROCESS_PROFILE_KEYS.has(key)) ||
    !Array.isArray(raw.catalogModes) ||
    raw.catalogModes.some(
      (mode) => typeof mode !== "string" || !CATALOG_MODES.has(mode as CatalogMode),
    ) ||
    !hasUniqueValues(raw.catalogModes as string[]) ||
    !Array.isArray(raw.subjectTypes) ||
    raw.subjectTypes.some((subjectType) => !isProcessSlug(subjectType)) ||
    !hasUniqueValues(raw.subjectTypes as string[]) ||
    typeof raw.housesSubjects !== "boolean" ||
    typeof raw.schedulesSubjects !== "boolean" ||
    !Array.isArray(raw.resourceKinds)
  ) {
    return null;
  }

  const valueStreams = readValueStreams(raw.valueStreams);
  if (!valueStreams) return null;
  const supportingCapabilities = raw.supportingCapabilities ?? [];
  if (
    !Array.isArray(supportingCapabilities) ||
    supportingCapabilities.some((capability) => !isProcessSlug(capability)) ||
    !hasUniqueValues(supportingCapabilities as string[])
  ) {
    return null;
  }

  // A declared omission must name a backbone stage and say why it does not run.
  // A reasonless omission is the silent loss this field exists to prevent.
  const omittedBackboneStages = raw.omittedBackboneStages ?? [];
  if (
    !Array.isArray(omittedBackboneStages) ||
    omittedBackboneStages.some(
      (omission) =>
        !isRecord(omission) ||
        Object.keys(omission).some((key) => !["stageKey", "reason"].includes(key)) ||
        !isProcessSlug(omission.stageKey) ||
        !isProcessText(omission.reason),
    ) ||
    !hasUniqueValues(
      (omittedBackboneStages as { stageKey: string }[]).map((omission) => omission.stageKey),
    )
  ) {
    return null;
  }

  const resourceKinds = [];
  for (const resourceKind of raw.resourceKinds) {
    if (
      !isRecord(resourceKind) ||
      Object.keys(resourceKind).some(
        (key) => !["kindSlug", "capacityUnit", "maxCapacity"].includes(key),
      ) ||
      !isProcessSlug(resourceKind.kindSlug) ||
      !isProcessSlug(resourceKind.capacityUnit) ||
      !Number.isInteger(resourceKind.maxCapacity) ||
      (resourceKind.maxCapacity as number) < 1 ||
      (resourceKind.maxCapacity as number) > MAX_RESOURCE_CAPACITY
    ) {
      return null;
    }

    resourceKinds.push({
      kindSlug: resourceKind.kindSlug,
      capacityUnit: resourceKind.capacityUnit,
      maxCapacity: resourceKind.maxCapacity as number,
    });
  }

  if (!hasUniqueValues(resourceKinds.map((resourceKind) => resourceKind.kindSlug))) {
    return null;
  }

  return {
    catalogModes: raw.catalogModes as CatalogMode[],
    subjectTypes: raw.subjectTypes as string[],
    housesSubjects: raw.housesSubjects,
    schedulesSubjects: raw.schedulesSubjects,
    resourceKinds,
    valueStreams,
    supportingCapabilities: supportingCapabilities as string[],
    omittedBackboneStages: omittedBackboneStages as { stageKey: string; reason: string }[],
  };
}

function readAxes(raw: unknown): NormalizedOperatingModelAxes | null {
  if (!isRecord(raw)) return null;

  const axes = raw as Partial<OperatingModelAxes>;
  if (
    !FORM_VALUES.has(axes.form as OperatingModelForm) ||
    !DELIVERY_VALUES.has(axes.delivery as OperatingModelDelivery) ||
    !PRIMARY_CONSUMER_VALUES.has(axes.primaryConsumer as PrimaryConsumer) ||
    !CHANNEL_VALUES.has(axes.consumptionChannel as ConsumptionChannel) ||
    !COMMERCIAL_MODEL_VALUES.has(axes.commercialModel as CommercialModel) ||
    !PROVISIONING_VALUES.has(axes.provisioning as ProvisioningModel) ||
    !PLATFORM_VALUES.has(axes.platform as PlatformEcosystem)
  ) {
    return null;
  }

  if (axes.governance !== undefined && !GOVERNANCE_VALUES.has(axes.governance as GovernanceModel)) {
    return null;
  }

  return {
    form: axes.form as OperatingModelForm,
    delivery: axes.delivery as OperatingModelDelivery,
    primaryConsumer: axes.primaryConsumer as PrimaryConsumer,
    consumptionChannel: axes.consumptionChannel as ConsumptionChannel,
    commercialModel: axes.commercialModel as CommercialModel,
    provisioning: axes.provisioning as ProvisioningModel,
    platform: axes.platform as PlatformEcosystem,
    governance: (axes.governance as GovernanceModel | undefined) ?? "investor-owned",
  };
}

function readPortfolioProfile(raw: unknown) {
  if (!isRecord(raw) || !PORTFOLIO_SCOPES.has(raw.scope as PortfolioScope)) {
    return null;
  }

  const it4itStages = raw.it4itStages;
  const offerings = raw.offerings;

  if (
    it4itStages !== undefined &&
    (!Array.isArray(it4itStages) ||
      it4itStages.some((stage) => typeof stage !== "string" || !IT4IT_STAGES.has(stage as It4ItStage)))
  ) {
    return null;
  }

  if (offerings !== undefined && !isStringArray(offerings)) {
    return null;
  }

  return {
    scope: raw.scope as PortfolioScope,
    ...(it4itStages ? { it4itStages: it4itStages as It4ItStage[] } : {}),
    ...(offerings ? { offerings } : {}),
  };
}

function readPortfolios(raw: unknown): PortfolioDecomposition | null {
  if (!isRecord(raw)) return null;

  const foundational = readPortfolioProfile(raw.foundational);
  const manufactureAndDeliver = readPortfolioProfile(raw.manufactureAndDeliver);
  const forEmployees = readPortfolioProfile(raw.forEmployees);
  const productsAndServicesSold = readPortfolioProfile(raw.productsAndServicesSold);

  if (!foundational || !manufactureAndDeliver || !forEmployees || !productsAndServicesSold) {
    return null;
  }

  return {
    foundational,
    manufactureAndDeliver,
    forEmployees,
    productsAndServicesSold,
  };
}

function readCapabilityOverrides(raw: unknown): CapabilityOverride[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;

  const overrides: CapabilityOverride[] = [];
  for (const item of raw) {
    if (
      !isRecord(item) ||
      typeof item.capabilityKey !== "string" ||
      !isCapabilityKey(item.capabilityKey) ||
      typeof item.applicability !== "string" ||
      !APPLICABILITY_VALUES.has(item.applicability as CapabilityApplicability) ||
      typeof item.reason !== "string" ||
      item.reason.trim().length === 0
    ) {
      return null;
    }

    const ownershipScopes = item.ownershipScopes;
    const transactionContexts = item.transactionContexts;
    const isolation = item.isolation;
    const surfaces = item.surfaces;
    if (
      (ownershipScopes !== undefined &&
        (!Array.isArray(ownershipScopes) ||
          ownershipScopes.some(
            (scope) => typeof scope !== "string" || !OWNERSHIP_SCOPE_VALUES.has(scope as OwnershipScope),
          ))) ||
      (transactionContexts !== undefined &&
        (!Array.isArray(transactionContexts) ||
          transactionContexts.some(
            (context) =>
              typeof context !== "string" ||
              !TRANSACTION_CONTEXT_VALUES.has(context as TransactionContext),
          ))) ||
      (isolation !== undefined &&
        (typeof isolation !== "string" ||
          !ISOLATION_VALUES.has(isolation as CapabilityIsolation))) ||
      (surfaces !== undefined && !isStringArray(surfaces))
    ) {
      return null;
    }

    overrides.push({
      capabilityKey: item.capabilityKey,
      applicability: item.applicability as CapabilityApplicability,
      ...(ownershipScopes !== undefined
        ? { ownershipScopes: ownershipScopes as OwnershipScope[] }
        : {}),
      ...(transactionContexts !== undefined
        ? { transactionContexts: transactionContexts as TransactionContext[] }
        : {}),
      ...(isolation !== undefined
        ? { isolation: isolation as CapabilityIsolation }
        : {}),
      ...(surfaces !== undefined ? { surfaces } : {}),
      reason: item.reason,
    });
  }

  return overrides;
}

function isManagedServiceProviderLegacyProfile(input: Pick<ActivationProfile, "profileType" | "modules" | "customerGraph" | "estateSeparation">): boolean {
  return (
    input.profileType === "managed-service-provider" ||
    input.modules.includes("customer-estate") ||
    input.customerGraph === "separate-customer-projection" ||
    input.estateSeparation === "strict"
  );
}

function inferLegacyAxes(input: Pick<ActivationProfile, "profileType" | "modules" | "customerGraph" | "estateSeparation" | "billingReadinessMode">): NormalizedOperatingModelAxes {
  if (isManagedServiceProviderLegacyProfile(input)) {
    return {
      form: "services",
      delivery: "hybrid",
      primaryConsumer: "business",
      consumptionChannel: "onsite-plus-portal",
      commercialModel:
        input.billingReadinessMode === "prepared-not-prescribed"
          ? "recurring-agreement"
          : "transactional",
      provisioning: "account-and-entitlement",
      platform: "no",
      governance: "investor-owned",
    };
  }

  return {
    form: "services",
    delivery: "physical",
    primaryConsumer: "individual",
    consumptionChannel: "web-app",
    commercialModel: "transactional",
    provisioning: "none",
    platform: "no",
    governance: "investor-owned",
  };
}

function inferLegacyPortfolios(input: Pick<ActivationProfile, "profileType" | "modules" | "customerGraph" | "estateSeparation">): PortfolioDecomposition {
  if (isManagedServiceProviderLegacyProfile(input)) {
    return {
      foundational: { scope: "minimal" },
      manufactureAndDeliver: {
        scope: "primary",
        it4itStages: ["detect-to-correct", "deploy-to-operate", "request-to-fulfill"],
      },
      forEmployees: { scope: "standard" },
      productsAndServicesSold: { scope: "primary" },
    };
  }

  return {
    foundational: { scope: "minimal" },
    manufactureAndDeliver: { scope: "minimal" },
    forEmployees: { scope: "minimal" },
    productsAndServicesSold: { scope: "primary" },
  };
}

export function readActivationProfile(raw: unknown): NormalizedActivationProfile | null {
  if (!isRecord(raw)) return null;

  const profileType = raw.profileType;
  const modules = raw.modules;
  const billingReadinessMode = raw.billingReadinessMode;
  const customerGraph = raw.customerGraph;
  const estateSeparation = raw.estateSeparation;

  if (typeof profileType !== "string" || !PROFILE_TYPES.has(profileType as ActivationProfile["profileType"])) {
    return null;
  }

  if (
    !Array.isArray(modules) ||
    modules.some((module) => typeof module !== "string" || !MODULES.has(module as ArchetypeModule))
  ) {
    return null;
  }

  if (
    typeof billingReadinessMode !== "string" ||
    !BILLING_MODES.has(billingReadinessMode as ActivationProfile["billingReadinessMode"])
  ) {
    return null;
  }

  if (typeof customerGraph !== "string" || !GRAPH_MODES.has(customerGraph as CustomerGraphMode)) {
    return null;
  }

  if (typeof estateSeparation !== "string" || !ESTATE_MODES.has(estateSeparation as EstateSeparationMode)) {
    return null;
  }

  const legacyShape = {
    profileType: profileType as ActivationProfile["profileType"],
    modules: modules as ArchetypeModule[],
    billingReadinessMode: billingReadinessMode as ActivationProfile["billingReadinessMode"],
    customerGraph: customerGraph as CustomerGraphMode,
    estateSeparation: estateSeparation as EstateSeparationMode,
  };

  const axes = raw.axes === undefined ? inferLegacyAxes(legacyShape) : readAxes(raw.axes);
  if (!axes) return null;

  const portfolios =
    raw.portfolios === undefined ? inferLegacyPortfolios(legacyShape) : readPortfolios(raw.portfolios);
  if (!portfolios) return null;

  const capabilityOverrides = readCapabilityOverrides(raw.capabilityOverrides);
  if (!capabilityOverrides) return null;

  const processProfile = readProcessProfile(raw.processProfile);
  if (!processProfile) return null;

  const capabilityMap = deriveCapabilityApplicability(axes, portfolios, capabilityOverrides);
  const billingProfile = deriveBillingPatternProfile(axes);
  const partnerProgram = derivePartnerProgramProfile(axes, portfolios);

  // `field-dispatch` is a derived module (ADR-2): added from the axes here, not
  // hand-authored into archetype literals — the same way billingProfile and
  // partnerProgram are derived above. Idempotent if a literal ever declares it.
  const derivedModules: ArchetypeModule[] =
    needsFieldDispatch(axes) && !legacyShape.modules.includes("field-dispatch")
      ? [...legacyShape.modules, "field-dispatch"]
      : legacyShape.modules;

  return {
    ...legacyShape,
    modules: derivedModules,
    axes,
    portfolios,
    capabilityOverrides,
    billingProfile,
    partnerProgram,
    capabilityActivations: Array.from(capabilityMap.values()),
    processProfile,
    ...(raw.seededServiceCategories !== undefined && isStringArray(raw.seededServiceCategories)
      ? { seededServiceCategories: raw.seededServiceCategories }
      : {}),
    ...(Array.isArray(raw.seededConfigurationItemTypes)
      ? { seededConfigurationItemTypes: raw.seededConfigurationItemTypes as ActivationProfile["seededConfigurationItemTypes"] }
      : {}),
    ...(Array.isArray(raw.seededBillingUnitTypes)
      ? { seededBillingUnitTypes: raw.seededBillingUnitTypes as ActivationProfile["seededBillingUnitTypes"] }
      : {}),
    ...(Array.isArray(raw.seededChargeModels)
      ? { seededChargeModels: raw.seededChargeModels as ActivationProfile["seededChargeModels"] }
      : {}),
  };
}

export function getCapabilityActivation(
  profile: NormalizedActivationProfile | null | undefined,
  capabilityKey: CapabilityKey | string,
): CapabilityActivation | null {
  if (!profile || typeof capabilityKey !== "string") return null;
  return profile.capabilityActivations.find((activation) => activation.capabilityKey === capabilityKey) ?? null;
}

export function getCapabilityApplicability(
  profile: NormalizedActivationProfile | null | undefined,
  capabilityKey: CapabilityKey | string,
): CapabilityApplicability | null {
  return getCapabilityActivation(profile, capabilityKey)?.applicability ?? null;
}

export function activationHasCapability(
  profile: NormalizedActivationProfile | null | undefined,
  capabilityKey: CapabilityKey | string,
): boolean {
  const applicability = getCapabilityApplicability(profile, capabilityKey);
  return applicability === "required" || applicability === "recommended" || applicability === "optional";
}
