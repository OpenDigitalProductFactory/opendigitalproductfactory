import type {
  ArchetypeCategory,
  ArchetypeDefinition,
  ArchetypeModule,
  CommercialModel,
  It4ItStage,
} from "./types";

/**
 * Operational Value Stream Model (OVSM) — a pure projection of an archetype's
 * existing substrate (axes / activation profile / scheduling / billing) into the
 * six-stage operational value stream described in
 * `docs/architecture/archetype-business-value-streams.md` (§3 load-bearing,
 * §5 capability binding, §7 demand–capacity). This is the P0 "Capture" contract:
 * derive, never author — no new fields on ArchetypeDefinition, no prose parsing.
 */

export type StandardOperationalValueStreamStageKey =
  | "attract"
  | "capture"
  | "qualify"
  | "deliver"
  | "settle"
  | "retain"
  | "trust-compliance"
  | "operate-improve"
  /** Rental/shared-asset only: the asset returns to the pool and is inspected. */
  | "return-inspect"
  /** Goods-custody only: the customer's goods arrive, are checked in, and come
   *  to rest in the facility before any outbound work happens. */
  | "receive-store";

/** Leaf profiles use validated slugs, while the shared backbone keeps a closed union. */
export type OperationalValueStreamStageKey = string;

export type CapacityUnitType =
  | "slot-hours"
  | "service-throughput"
  | "durable-stock"
  | "perishable-stock"
  | "physical-hard-cap"
  | "billable-hours"
  | "volunteer-or-bed-capacity"
  | "loan-processing-throughput"
  | "statutory-throughput"
  | "reusable-pooled-asset"
  | "governance-cycle"
  /** Custodial facility space — pallet positions, bin locations, cubic volume.
   *  Distinct from `durable-stock` (stock the business owns and sells) and from
   *  `physical-hard-cap` (seats/rooms): the constraint is racking and cube, and
   *  the headline measure is utilisation against it. */
  | "custodial-space";

export type DemandSignature =
  | "steady"
  | "seasonal"
  | "weekly"
  | "event-driven"
  | "fiscal-calendar"
  | "rate-sensitive"
  | "emergency-reactive"
  | "synchronized-contention";

export interface OperationalValueStreamStage {
  key: OperationalValueStreamStageKey;
  label: string;
  order: number;
  loadBearing: boolean;
  capabilityBindings: ArchetypeModule[];
  metricBindings: string[];
  trustGateKeys: string[];
  streamKey: string;
  input: string | null;
  output: string | null;
  responsibleRole: string | null;
  handoffToStageKey: string | null;
}

export interface OperationalValueStreamLane {
  key: string;
  label: string;
  purpose: string;
  input: string;
  output: string;
  responsibleRole: string;
  stages: OperationalValueStreamStage[];
}

export interface OperationalValueStream {
  archetypeId: string;
  archetypeName: string;
  category: string;
  stages: OperationalValueStreamStage[];
  loadBearingStageKeys: OperationalValueStreamStageKey[];
  capacityUnit: CapacityUnitType;
  demandSignature: DemandSignature;
  trustGates: string[];
  it4itStageBinding: It4ItStage[];
  streams: OperationalValueStreamLane[];
  supportingCapabilities: string[];
}

// ── Stage backbone ───────────────────────────────────────────────────────────

interface StageSpec {
  key: StandardOperationalValueStreamStageKey;
  label: string;
  order: number;
}

const PRIMARY_STAGE_SPECS: StageSpec[] = [
  { key: "attract", label: "Attract & Discover", order: 10 },
  { key: "capture", label: "Capture Demand", order: 20 },
  { key: "qualify", label: "Qualify & Schedule", order: 30 },
  { key: "deliver", label: "Deliver the Value", order: 40 },
  { key: "settle", label: "Settle & Account", order: 50 },
  { key: "retain", label: "Retain & Grow", order: 60 },
];

const RETURN_INSPECT_SPEC: StageSpec = {
  key: "return-inspect",
  label: "Return & Inspect",
  order: 45, // between deliver (40) and settle (50)
};

const RECEIVE_STORE_SPEC: StageSpec = {
  key: "receive-store",
  label: "Receive & Store",
  // Between qualify (30, the dock appointment) and deliver (40, pick/pack/
  // despatch). Custody inverts the rental ordering: goods come to rest BEFORE
  // the outbound work, where a rental asset returns AFTER it.
  order: 35,
};

const CROSS_CUT_SPECS: StageSpec[] = [
  { key: "trust-compliance", label: "Trust & Compliance", order: 70 },
  { key: "operate-improve", label: "Operate & Improve", order: 80 },
];

// Stage → enabling capability modules (artefact §5). Intersected with the
// archetype's actual active modules when an activation profile is present so we
// never claim a capability the archetype did not activate.
const STAGE_CAPABILITY_MAP: Record<StandardOperationalValueStreamStageKey, ArchetypeModule[]> = {
  attract: [],
  capture: [],
  qualify: ["service-operations"],
  deliver: ["customer-estate", "service-operations", "projects"],
  settle: ["billing-readiness"],
  retain: ["service-agreements", "lifecycle-signals"],
  "trust-compliance": [],
  "operate-improve": ["integrations"],
  "return-inspect": ["rental-fleet", "rental-agreements"],
  "receive-store": ["customer-estate", "service-operations"],
};

const STAGE_METRIC_MAP: Record<StandardOperationalValueStreamStageKey, string[]> = {
  attract: ["storefront-published"],
  capture: ["inbox-submissions", "capture-conversion"],
  qualify: ["utilization", "no-show-rate", "lead-time"],
  deliver: ["estate-completeness", "fulfilment"],
  settle: ["invoice", "profit-loss"],
  retain: ["repeat-rate", "renewals"],
  "trust-compliance": ["obligations-status"],
  "operate-improve": ["backlog-throughput"],
  "return-inspect": ["asset-utilization", "turnaround", "overdue-returns"],
  // dock-to-stock and inventory accuracy are the two the industry actually
  // manages to; space utilisation is the capacity constraint behind them.
  "receive-store": ["dock-to-stock", "inventory-accuracy", "space-utilization"],
};

// ── Category defaults (used only when axes do not set a commercial model) ─────

const CATEGORY_DEFAULT_COMMERCIAL_MODEL: Partial<Record<ArchetypeCategory, CommercialModel>> = {
  "healthcare-wellness": "encounter-based",
  "beauty-personal-care": "appointment-checkout",
  "pet-services": "appointment-checkout",
  "trades-maintenance": "transactional",
  "professional-services": "recurring-agreement",
  "software-platform": "subscription",
  "fitness-recreation": "subscription",
  "retail-goods": "point-of-sale",
  "hoa-property-management": "statutory-fees-and-levies",
  "public-sector": "statutory-fees-and-levies",
  "banking-financial-services": "account-based-fees",
  "automotive-services": "appointment-checkout",
  "moving-and-logistics": "transactional",
  "security-services": "recurring-agreement",
  // Production is one-off project engagements captured as deals; live events and
  // venues capture the ticket sale. Per-leaf axes still override this default.
  "media-production": "transactional",
  "live-events-venues": "transactional",
  // Custody work runs on contract accounts against a rate card, not a sale.
  "warehousing-fulfilment": "account-based-fees",
  "fabric-care-services": "point-of-sale",
  "agriculture-ranching": "hybrid",
  "manufacturing": "transactional",
};

function resolveCommercialModel(a: ArchetypeDefinition): CommercialModel {
  const fromAxes = a.activationProfile?.axes?.commercialModel;
  if (fromAxes) return fromAxes;
  // food-hospitality and education-training are mixed — key on the CTA.
  if (a.category === "food-hospitality" || a.category === "education-training") {
    if (a.ctaType === "purchase") return "point-of-sale";
    if (a.ctaType === "booking") return "appointment-checkout";
    return "transactional";
  }
  return CATEGORY_DEFAULT_COMMERCIAL_MODEL[a.category] ?? "transactional";
}

const CATEGORY_DEFAULT_DEMAND: Partial<Record<ArchetypeCategory, DemandSignature>> = {
  "beauty-personal-care": "weekly",
  "food-hospitality": "weekly",
  "healthcare-wellness": "seasonal",
  "pet-services": "seasonal",
  "retail-goods": "seasonal",
  "fitness-recreation": "seasonal",
  "public-sector": "seasonal",
  "hoa-property-management": "seasonal",
  "trades-maintenance": "emergency-reactive",
  "education-training": "fiscal-calendar",
  "professional-services": "fiscal-calendar",
  "nonprofit-community": "fiscal-calendar",
  "banking-financial-services": "rate-sensitive",
  "software-platform": "steady",
  // Automotive: chips, breakdowns, and lockouts arrive unscheduled.
  "automotive-services": "emergency-reactive",
  // Moving peaks at month-end and over summer.
  "moving-and-logistics": "seasonal",
  // Guard contracts and monitoring are steady recurring coverage.
  "security-services": "steady",
  // Production work follows campaign / commissioning cycles.
  "media-production": "seasonal",
  // On-sale spikes and event dates make live-events demand event-driven.
  "live-events-venues": "event-driven",
  // Contract volume arrives steadily; the client's own seasonality shows up as
  // throughput variance inside a standing agreement, not as new demand.
  "warehousing-fulfilment": "steady",
  "fabric-care-services": "weekly",
  "agriculture-ranching": "seasonal",
  "manufacturing": "steady",
};

const CATEGORY_DEFAULT_CAPACITY: Partial<Record<ArchetypeCategory, CapacityUnitType>> = {
  "beauty-personal-care": "slot-hours",
  "healthcare-wellness": "slot-hours",
  "pet-services": "slot-hours",
  "education-training": "slot-hours",
  "trades-maintenance": "slot-hours",
  "fitness-recreation": "physical-hard-cap",
  "retail-goods": "durable-stock",
  "professional-services": "billable-hours",
  "public-sector": "statutory-throughput",
  "nonprofit-community": "volunteer-or-bed-capacity",
  "software-platform": "service-throughput",
  "hoa-property-management": "service-throughput",
  // Field-dispatch services are bounded by technician / crew / officer hours.
  "automotive-services": "slot-hours",
  "moving-and-logistics": "slot-hours",
  "security-services": "slot-hours",
  // Production is bounded by crew / project throughput (billable days).
  "media-production": "billable-hours",
  // Venue and event capacity is a physical hard cap (seats / room).
  "live-events-venues": "physical-hard-cap",
  // Racking, bin locations, and cube — the constraint a warehouse sells.
  "warehousing-fulfilment": "custodial-space",
  "fabric-care-services": "service-throughput",
  "agriculture-ranching": "physical-hard-cap",
  "manufacturing": "service-throughput",
};

// ── Derivation ───────────────────────────────────────────────────────────────

function resolveCapacityUnit(a: ArchetypeDefinition, isRental: boolean, cm: CommercialModel): CapacityUnitType {
  if (isRental) return "reusable-pooled-asset";
  if (a.category === "food-hospitality") return a.ctaType === "purchase" ? "perishable-stock" : "slot-hours";
  if (a.category === "banking-financial-services") {
    return a.archetypeId === "mortgage-lending" ? "loan-processing-throughput" : "service-throughput";
  }
  if (a.category === "professional-services" && a.activationProfile?.profileType === "managed-service-provider") {
    return "service-throughput";
  }
  if (a.archetypeId === "cooperative") return "governance-cycle";
  const byCategory = CATEGORY_DEFAULT_CAPACITY[a.category];
  if (byCategory) return byCategory;
  // Commercial-model fallback for categories without a default.
  if (cm === "subscription") return "physical-hard-cap";
  return "service-throughput";
}

function resolveLoadBearingStages(
  cm: CommercialModel,
  isRental: boolean,
  isDonation: boolean,
  isCustody: boolean,
): OperationalValueStreamStageKey[] {
  if (isRental) return ["qualify"]; // reserve the right asset against a finite pool
  if (isDonation) return ["capture"]; // capture the gift; no purchase artefact downstream
  // Custody is won or lost on the inbound: dock-to-stock and inventory accuracy
  // determine whether every downstream pick is possible and correct.
  if (isCustody) return ["receive-store"];
  switch (cm) {
    case "appointment-checkout":
      return ["qualify"];
    case "encounter-based":
      return ["deliver"];
    case "recurring-agreement":
      return ["deliver"];
    case "subscription":
      return ["retain"];
    case "transactional":
    case "point-of-sale":
      return ["capture"];
    case "account-based-fees":
      return ["trust-compliance", "qualify"]; // the gate precedes scheduling
    case "statutory-fees-and-levies":
      return ["trust-compliance"];
    case "usage-based":
      return ["qualify"];
    default:
      return ["capture"];
  }
}

function humanizeSlug(value: string): string {
  return value
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function deriveLeafValueStreams(
  archetype: ArchetypeDefinition,
): { streams: OperationalValueStreamLane[]; stages: OperationalValueStreamStage[]; loadBearingStageKeys: string[]; trustGates: string[]; supportingCapabilities: string[] } | null {
  const profiles = archetype.activationProfile?.processProfile?.valueStreams;
  if (!profiles || profiles.length === 0) return null;

  const loadBearingStageKeys = profiles.flatMap((stream) => stream.loadBearingStageKeys);
  const stages = profiles.flatMap((stream, streamIndex) =>
    stream.stages.map((stage, stageIndex): OperationalValueStreamStage => ({
      key: stage.key,
      label: stage.label,
      order: (streamIndex + 1) * 100 + (stageIndex + 1) * 10,
      loadBearing: loadBearingStageKeys.includes(stage.key),
      capabilityBindings: stage.capabilityBindings ?? [],
      metricBindings: stage.metricBindings ?? [],
      trustGateKeys: stage.trustGateKeys,
      streamKey: stream.key,
      input: stage.input,
      output: stage.output,
      responsibleRole: stage.responsibleRole,
      handoffToStageKey: stage.handoffTo ?? null,
    })),
  );
  const stageByKey = new Map(stages.map((stage) => [stage.key, stage]));
  const streams = profiles.map((profile): OperationalValueStreamLane => ({
    key: profile.key,
    label: profile.label,
    purpose: profile.purpose,
    input: profile.input,
    output: profile.output,
    responsibleRole: profile.responsibleRole,
    stages: profile.stages.map((stage) => stageByKey.get(stage.key)!),
  }));
  return {
    streams,
    stages,
    loadBearingStageKeys,
    trustGates: Array.from(new Set(stages.flatMap((stage) => stage.trustGateKeys))),
    supportingCapabilities: (archetype.activationProfile?.processProfile?.supportingCapabilities ?? []).map(humanizeSlug),
  };
}

function resolveTrustGates(a: ArchetypeDefinition, isRental: boolean): string[] {
  const gates: string[] = [];
  const governance = a.activationProfile?.axes?.governance ?? "investor-owned";

  if (a.category === "healthcare-wellness") gates.push("clinical-adjacent-no-advice");
  if (a.archetypeId === "counselling") gates.push("crisis-routing");
  if (a.archetypeId === "optician") gates.push("clinical-adjacent-no-advice");
  if (a.category === "banking-financial-services") gates.push("kyc-and-disclosure");
  if (a.archetypeId === "legal-services" || a.archetypeId === "accounting") gates.push("regulated-no-advice");

  if (governance === "public-body") gates.push("universal-service-obligation");
  if (a.archetypeId === "law-enforcement-agency") gates.push("no-cji-access");

  if (a.activationProfile?.estateSeparation === "strict") gates.push("strict-estate-separation");

  if (governance === "member-owned") {
    gates.push(isRental ? "member-equitable-allocation" : "member-governance");
  }

  return Array.from(new Set(gates));
}

function resolveIt4itBinding(a: ArchetypeDefinition): It4ItStage[] {
  const portfolios = a.activationProfile?.portfolios;
  if (portfolios) {
    const stages = new Set<It4ItStage>();
    for (const profile of Object.values(portfolios)) {
      for (const stage of profile?.it4itStages ?? []) stages.add(stage);
    }
    if (stages.size > 0) return Array.from(stages);
  }
  return ["request-to-fulfill"];
}

/**
 * Pure derivation: archetype definition → operational value stream model.
 * Deterministic and side-effect-free; safe to call at setup, archetype-reset,
 * or in tests across every archetype in `ALL_ARCHETYPES`.
 */
export function deriveOperationalValueStream(archetype: ArchetypeDefinition): OperationalValueStream {
  const commercialModel = resolveCommercialModel(archetype);
  const provisioning = archetype.activationProfile?.axes?.provisioning;
  const isRental = provisioning === "reservation-and-return";
  const isCustody = provisioning === "custody-and-fulfilment";
  const isDonation = archetype.ctaType === "donation";

  const loadBearingStageKeys = resolveLoadBearingStages(
    commercialModel,
    isRental,
    isDonation,
    isCustody,
  );
  const trustGates = resolveTrustGates(archetype, isRental);
  const capacityUnit = resolveCapacityUnit(archetype, isRental, commercialModel);
  const demandSignature = isRental
    ? "synchronized-contention"
    : (CATEGORY_DEFAULT_DEMAND[archetype.category] ?? "steady");
  const it4itStageBinding = resolveIt4itBinding(archetype);

  const leaf = deriveLeafValueStreams(archetype);
  if (leaf) {
    return {
      archetypeId: archetype.archetypeId,
      archetypeName: archetype.name,
      category: archetype.category,
      stages: leaf.stages,
      streams: leaf.streams,
      loadBearingStageKeys: leaf.loadBearingStageKeys,
      capacityUnit,
      demandSignature,
      trustGates: leaf.trustGates,
      supportingCapabilities: leaf.supportingCapabilities,
      it4itStageBinding,
    };
  }

  const activeModules = archetype.activationProfile?.modules;

  const specs: StageSpec[] = [
    ...PRIMARY_STAGE_SPECS,
    ...(isRental ? [RETURN_INSPECT_SPEC] : []),
    ...(isCustody ? [RECEIVE_STORE_SPEC] : []),
    ...CROSS_CUT_SPECS,
  ].sort((x, y) => x.order - y.order);

  const stages: OperationalValueStreamStage[] = specs.map((spec) => {
    const mapped = STAGE_CAPABILITY_MAP[spec.key];
    const capabilityBindings = activeModules
      ? mapped.filter((m) => activeModules.includes(m))
      : mapped;
    const metricBindings =
      spec.key === "settle" && isDonation ? ["donation-receipt"] : STAGE_METRIC_MAP[spec.key];
    return {
      key: spec.key,
      label: spec.label,
      order: spec.order,
      loadBearing: loadBearingStageKeys.includes(spec.key),
      capabilityBindings,
      metricBindings,
      trustGateKeys: spec.key === "trust-compliance" ? trustGates : [],
      streamKey: "operational-value-stream",
      input: null,
      output: null,
      responsibleRole: null,
      handoffToStageKey: null,
    };
  });

  return {
    archetypeId: archetype.archetypeId,
    archetypeName: archetype.name,
    category: archetype.category,
    stages,
    streams: [
      {
        key: "operational-value-stream",
        label: `${archetype.name} operational value stream`,
        purpose: `Create and deliver value for ${archetype.name}`,
        input: "Interest or demand",
        output: "Delivered value and an accountable relationship",
        responsibleRole: "Business operator",
        stages,
      },
    ],
    loadBearingStageKeys,
    capacityUnit,
    demandSignature,
    trustGates,
    it4itStageBinding,
    supportingCapabilities: [],
  };
}
