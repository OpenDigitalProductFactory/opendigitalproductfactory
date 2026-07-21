import type { ArchetypeModule, OperatingModelAxes } from "./types";

/**
 * Field Dispatch capability — derivation + per-vertical profile (F0).
 *
 * The "dispatcher" is a horizontal capability that recurs in every business
 * where a mobile resource travels to a customer location to perform work
 * (HVAC, auto-glass, cleaning, mobile grooming, home health, appliance repair,
 * pest control, field inspection, delivery/install). Rather than hand-author a
 * dispatcher per archetype, applicability is *derived* from the operating-model
 * axes — the same "axes in, profile out" pattern as `deriveBillingPatternProfile`
 * and `derivePartnerProgramProfile` (applicability-rules.ts). The per-vertical
 * variation (resource noun, serviced entity, compliance overlay, inventory
 * model, vocabulary) is expressed as data — a {@link FieldDispatchProfile} —
 * not code.
 *
 * See docs/superpowers/specs/2026-06-13-field-dispatch-capability-design.md
 * (ADR-1, ADR-2, ADR-4, §7.2).
 */

/**
 * The activation module that gates the field-dispatch capability. It is a
 * *derived* module: {@link needsFieldDispatch} adds it during activation-profile
 * normalization (activation-profile.ts), never hand-authored into an archetype
 * literal — mirroring how billing/partner profiles are derived from axes.
 */
export const FIELD_DISPATCH_MODULE: ArchetypeModule = "field-dispatch";

/**
 * Regulated artifacts captured as a by-product of a job close (ADR-5). Each key
 * is one pluggable compliance overlay; the F9 framework realizes them. No
 * mainstream FSM covers these, which is why they are the capability's moat.
 */
export type ComplianceOverlayKey =
  | "epa-608" // HVAC refrigerant handling
  | "adas-calibration" // auto-glass advanced driver-assistance recalibration
  | "pesticide-applicator" // pest control applicator license + per-application log
  | "hipaa-clinical" // home health / mobile clinical (regulated-health)
  | "bonding-insurance" // cleaning / locksmith / security
  | "dot-hours"; // moving / long-haul hours-of-service

/** What the job is performed on or for. */
export type ServicedEntity =
  | "equipment-unit" // HVAC unit, appliance
  | "vehicle" // auto glass (VIN-keyed)
  | "property-site" // cleaning, landscaping, pest, inspection
  | "animal" // mobile grooming / mobile vet
  | "person" // home health
  | "parcel"; // delivery / install

/** Where the work happens relative to the customer. */
export type SiteModel = "customer-premises" | "mobile-to-customer" | "route-based";

/** Signals an assignment engine (F4) scores when matching a resource to a job. */
export type AssignmentSignal = "skill" | "proximity" | "availability" | "parts" | "value" | "urgency";

/** Customer-facing dispatch notification events (F2). */
export type NotificationEvent = "confirm" | "on-my-way" | "running-late" | "complete";

/** How the vertical tracks consumable stock carried to the job. */
export type InventoryModel = "truck-stock" | "sku-by-vehicle" | "supplies" | "none";

/**
 * How the board renders location/route. `schematic` needs no provider and is the
 * default (ADR-9, no hidden geocoding dependency); `geocoded`/`optimized` are
 * unlocked once a mapping provider is configured (F5/F6).
 */
export type RouteMode = "schematic" | "geocoded" | "optimized";

/**
 * Data-sensitivity class for the vertical. Drives which verticals are eligible
 * for the smallest slice: only `standard`/`location-sensitive` ship first;
 * `regulated-health`/`regulated-public-safety` wait for the F9 evidence design
 * (ADR-10).
 */
export type PrivacyClass = "standard" | "location-sensitive" | "regulated-health" | "regulated-public-safety";

export interface FieldDispatchResource {
  /** Singular operator-facing noun, e.g. "technician", "installer", "cleaner". */
  noun: string;
  /** Plural form, e.g. "technicians". */
  nounPlural: string;
  /** Whether the assignable unit is one person, a crew, or vehicle-bound. */
  unit: "solo" | "crew" | "vehicle-bound";
  /** Fleet noun where the resource is vehicle-bound, e.g. "truck", "van". */
  fleetNoun?: string;
}

export interface FieldDispatchVocabulary {
  job: string;
  jobPlural: string;
  visit: string;
}

/**
 * The per-vertical parameterization of the field-dispatch capability. The core
 * dispatch loop reads this; adding a new vertical is authoring a profile, not
 * writing a dispatcher (ADR-4).
 */
export interface FieldDispatchProfile {
  resource: FieldDispatchResource;
  servicedEntity: ServicedEntity;
  siteModel: SiteModel;
  assignmentSignals: AssignmentSignal[];
  notificationEvents: NotificationEvent[];
  complianceOverlays: ComplianceOverlayKey[];
  inventoryModel: InventoryModel;
  routeMode: RouteMode;
  privacyClass: PrivacyClass;
  vocabulary: FieldDispatchVocabulary;
}

/**
 * Per-archetype override of the derived profile (ADR-4 escape hatch). `enabled`
 * forces dispatch on/off regardless of axis derivation — e.g. opt a
 * sales-assisted home builder *in*, or a self-storage rental pool *out*. Every
 * other field is a partial override of the derived base. Mirrors the
 * `MediaProfile` derive-with-override pattern.
 */
export interface FieldDispatchProfileOverride {
  enabled?: boolean;
  resource?: Partial<FieldDispatchResource>;
  servicedEntity?: ServicedEntity;
  siteModel?: SiteModel;
  assignmentSignals?: AssignmentSignal[];
  notificationEvents?: NotificationEvent[];
  complianceOverlays?: ComplianceOverlayKey[];
  inventoryModel?: InventoryModel;
  routeMode?: RouteMode;
  privacyClass?: PrivacyClass;
  vocabulary?: Partial<FieldDispatchVocabulary>;
}

/**
 * True when an archetype's operating model is "a service delivered by a mobile
 * resource at the customer's location" (ADR-1).
 *
 * Derivation:
 *  - `form === "services"` — dispatch coordinates service work, not goods sale.
 *  - `delivery ∈ {physical, hybrid}` — there is physical on-site delivery.
 *  - `consumptionChannel === "onsite-plus-portal"` — the discriminator: the work
 *    is performed *at the customer's site*, distinct from `physical` (customer
 *    comes to the premises — salon, clinic, retail) and `web-app`/`multi-channel`
 *    (remote/digital).
 *  - `provisioning !== "reservation-and-return"` — excludes the rental-pool model
 *    (asset-rental, shared-machinery co-ops), which is the `rental-fleet`
 *    capability, not field dispatch.
 *  - `provisioning !== "custody-and-fulfilment"` — excludes the goods-custody
 *    model (warehousing-fulfilment). The work happens at the *operator's*
 *    facility, not the customer's site; the resource being allocated is a dock
 *    door and a pick wave, which is `warehouse-operations`, not dispatch.
 *
 * Known boundaries handled by the {@link FieldDispatchProfileOverride} escape
 * hatch and the trades-profile work (F7):
 *  - Trades leaves (plumber, electrician, cleaning, landscaping) declare no
 *    explicit axes yet, so they infer to `consumptionChannel: "web-app"` and do
 *    NOT qualify here. F7 gives them `onsite-plus-portal` axes so they qualify.
 *  - `sales-assisted` archetypes (home builders, wholesale-distribution) have a
 *    real delivery dispatch leg the axes don't encode; opt them in via override.
 */
export function needsFieldDispatch(axes: OperatingModelAxes): boolean {
  return (
    axes.form === "services" &&
    (axes.delivery === "physical" || axes.delivery === "hybrid") &&
    axes.consumptionChannel === "onsite-plus-portal" &&
    axes.provisioning !== "reservation-and-return" &&
    axes.provisioning !== "custody-and-fulfilment"
  );
}

/**
 * Built-in per-archetype profile overrides. Empty in F0 — the vertical profiles
 * (HVAC truck-stock + EPA 608, auto-glass van + ADAS, cleaning crew, …) are
 * authored here (or carried inline on the archetype as `fieldDispatch`) by F7
 * and the gap-analysis archetypes. Keyed by `archetypeId`.
 */
const BUILTIN_PROFILES: Record<string, FieldDispatchProfileOverride> = {};

const DEFAULT_PROFILE: FieldDispatchProfile = {
  resource: { noun: "technician", nounPlural: "technicians", unit: "solo", fleetNoun: "vehicle" },
  servicedEntity: "property-site",
  siteModel: "customer-premises",
  assignmentSignals: ["skill", "proximity", "availability"],
  notificationEvents: ["confirm", "on-my-way", "running-late", "complete"],
  complianceOverlays: [],
  inventoryModel: "none",
  routeMode: "schematic",
  privacyClass: "standard",
  vocabulary: { job: "job", jobPlural: "jobs", visit: "visit" },
};

function mergeOverrides(
  base: FieldDispatchProfileOverride | undefined,
  next: FieldDispatchProfileOverride | undefined,
): FieldDispatchProfileOverride | undefined {
  if (!base) return next;
  if (!next) return base;
  return {
    ...base,
    ...next,
    // `next` wins on `enabled`; nested objects merge so a partial override does
    // not blow away builtin resource/vocabulary fields.
    resource: { ...base.resource, ...next.resource },
    vocabulary: { ...base.vocabulary, ...next.vocabulary },
  };
}

function applyOverride(
  base: FieldDispatchProfile,
  override: FieldDispatchProfileOverride | undefined,
): FieldDispatchProfile {
  if (!override) return base;
  return {
    resource: { ...base.resource, ...override.resource },
    servicedEntity: override.servicedEntity ?? base.servicedEntity,
    siteModel: override.siteModel ?? base.siteModel,
    assignmentSignals: override.assignmentSignals ?? base.assignmentSignals,
    notificationEvents: override.notificationEvents ?? base.notificationEvents,
    complianceOverlays: override.complianceOverlays ?? base.complianceOverlays,
    inventoryModel: override.inventoryModel ?? base.inventoryModel,
    routeMode: override.routeMode ?? base.routeMode,
    privacyClass: override.privacyClass ?? base.privacyClass,
    vocabulary: { ...base.vocabulary, ...override.vocabulary },
  };
}

/**
 * Resolve the field-dispatch profile for an archetype, or `null` when the
 * archetype is not a field-dispatch business.
 *
 * Resolution order: built-in profile for `archetypeId` (F7 data) merged with the
 * caller-supplied `override` (the archetype's inline `fieldDispatch` slot), with
 * the explicit override winning. `enabled` from the merged override forces the
 * outcome; absent it, axes drive via {@link needsFieldDispatch}.
 */
export function deriveFieldDispatchProfile(
  axes: OperatingModelAxes,
  archetypeId: string,
  override?: FieldDispatchProfileOverride,
): FieldDispatchProfile | null {
  const merged = mergeOverrides(BUILTIN_PROFILES[archetypeId], override);
  const enabled = merged?.enabled ?? needsFieldDispatch(axes);
  if (!enabled) return null;
  return applyOverride(DEFAULT_PROFILE, merged);
}
