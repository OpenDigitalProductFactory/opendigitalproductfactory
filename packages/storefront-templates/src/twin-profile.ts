import type { ArchetypeCategory, ArchetypeDefinition } from "./types";
import { readActivationProfile, type NormalizedOperatingModelAxes } from "./activation-profile";
import { deriveFieldDispatchProfile } from "./field-dispatch";

/**
 * Operational Twin Framework — the derived per-archetype twin configuration.
 *
 * The three hand-built prototypes (restaurant floor, field-service dispatch,
 * rental yard) converged on one grammar with different nouns. Rather than
 * building 53 bespoke twins, `deriveTwinProfile` picks one of ~12 templates and
 * binds its nouns from the operating-model axes, `schedulingDefaults`, the
 * derived `FieldDispatchProfile`, and the archetype's category — the fourth
 * member of DPF's derive-with-override family (OVSM, media-profile,
 * field-dispatch ADR-4). Derive, never author; a leaf `twinProfile` override is
 * the escape hatch for a genuine exception.
 *
 * Design: docs/superpowers/specs/2026-07-12-operational-twin-framework-design.md
 * Parent: docs/superpowers/specs/2026-07-11-living-business-workforce-visualization-design.md §3
 *
 * PURE + DB-free (mirrors operational-value-stream.ts). Nouns here are sensible
 * defaults; final operator-facing labels resolve through the vocabulary system
 * at render time (a credit union's board says "Members", a clinic redacts to
 * role not patient) — this profile just says which template and which nouns.
 */

/** The 13 twin templates. Physical templates render *space*; board templates
 *  (TENANTS/PIPELINE/PROGRAMS) render *portfolio state* for non-physical work. */
export type TwinTemplate =
  | "FLOOR" // tables/stations + seats on a floor plan (food-hospitality)
  | "TERRITORY" // fleet/techs/posts/units on a zone map (dispatch-native)
  | "YARD" // pooled assets in bays (reservation-and-return)
  | "BAYS" // work orders on lifts/bays/benches (fixed-location repair)
  | "BOOK" // providers x chairs/rooms on a day grid (appointment services)
  | "ROOMS" // rooms/beds/kennels occupancy board (overnight/occupancy)
  | "STORE" // shelves/stock + POS lanes + fulfilment (point-of-sale retail)
  | "VENUE" // seat/space map + run-of-show timeline (ticketed events)
  | "COUNTER" // service counters/case stations (statutory/public services)
  | "DOCK" // dock doors + racking + pick faces (custody-and-fulfilment warehousing)
  | "TENANTS" // accounts/tenants x health/usage/seats (board — SaaS/banking)
  | "PIPELINE" // matters/engagements/productions x stage (board — prof-svcs/media)
  | "PROGRAMS"; // programs/funds/donors/campaigns (board — nonprofit)

export type TwinVariant =
  | "fleet"
  | "posts"
  | "job-sites"
  | "unit-portfolio"
  | "provider-chair"
  | "provider-x-room"
  | "class-grid"
  | "portfolio"
  | "timeline";

/** The allocation decision the twin's AI "cog" assists (constraint→proposal→confirm). */
export type TwinCogKind =
  | "seat-from-dwell"
  | "nearest-resource"
  | "best-asset-by-readiness"
  | "bay-and-tech"
  | "provider-slot"
  | "room-assignment"
  | "restock-and-pick"
  | "space-and-date"
  | "next-in-line"
  | "wave-and-picker"
  | "route-at-risk-account"
  | "assign-by-utilization"
  | "allocate-to-program";

export type TwinCogSignal =
  | "dwell-time"
  | "turn-time"
  | "travel-time"
  | "skill"
  | "proximity"
  | "availability"
  | "readiness"
  | "class-fit"
  | "parts"
  | "labor-hours"
  | "utilization"
  | "deadline"
  | "health-score"
  | "workload"
  | "licensing"
  | "date-range"
  | "sla-clock"
  | "engagement-score";

export interface TwinNoun {
  singular: string;
  plural: string;
}

export interface TwinZoneSpec {
  key: string;
  label: string;
}

export interface TwinQueueSpec {
  key: string;
  label: string;
}

export interface TwinCogSpec {
  kind: TwinCogKind;
  signals: TwinCogSignal[];
}

export interface TwinProfile {
  template: TwinTemplate;
  variant?: TwinVariant;
  /** True for spatial twins; false for the board family (TENANTS/PIPELINE/PROGRAMS). */
  physical: boolean;
  /** Named regions of the operation. */
  zones: TwinZoneSpec[];
  /** Which zone actually holds the countable resource units — a restaurant's
   *  tables live in the dining room, not the kitchen/pass; a shop's work orders
   *  sit on the bays, not at intake. Consumers that render capacity into a single
   *  region use this instead of blindly taking `zones[0]`. Must be one of
   *  `zones[].key`; defaults to the first zone when a template omits it. */
  capacityZoneKey: string;
  /** The countable resource units (tables/vans/bays/chairs/rooms/accounts). */
  resourceNoun: TwinNoun;
  /** The units of demand processed through the twin (tickets/jobs/agreements/matters). */
  workItemNoun: TwinNoun;
  /** Ordered demand awaiting allocation — the heartbeat (waitlist/dispatch/renewals). */
  queues: TwinQueueSpec[];
  /** The AI-coworker allocation decision the twin assists. */
  cog: TwinCogSpec;
  /** Which live constraints headline as capacity chips. */
  capacityChips: string[];
  /** Some businesses default to *now* but carry a short forward-availability
   *  horizon (occupancy calendars — yard/rooms/venue). */
  forwardHorizon?: boolean;
  /** Hybrid archetypes (physical + digital) get a secondary board lens. */
  hybridBoard?: TwinTemplate;
}

/** Leaf-level override of the derived profile — the ADR-4 escape hatch. Mirrors
 *  `FieldDispatchProfileOverride`/`MediaProfile` override pattern. Set only for a
 *  genuine exception the derivation cannot express. */
export interface TwinProfileOverride {
  template?: TwinTemplate;
  variant?: TwinVariant;
  physical?: boolean;
  zones?: TwinZoneSpec[];
  capacityZoneKey?: string;
  resourceNoun?: Partial<TwinNoun>;
  workItemNoun?: Partial<TwinNoun>;
  queues?: TwinQueueSpec[];
  cog?: Partial<TwinCogSpec>;
  capacityChips?: string[];
  forwardHorizon?: boolean;
  hybridBoard?: TwinTemplate;
}

const PHYSICAL_TEMPLATES: ReadonlySet<TwinTemplate> = new Set<TwinTemplate>([
  "FLOOR",
  "TERRITORY",
  "YARD",
  "BAYS",
  "BOOK",
  "ROOMS",
  "STORE",
  "VENUE",
  "COUNTER",
  "DOCK",
]);

const n = (singular: string, plural: string): TwinNoun => ({ singular, plural });
const z = (key: string, label: string): TwinZoneSpec => ({ key, label });
const q = (key: string, label: string): TwinQueueSpec => ({ key, label });

/** Per-template defaults for the grammar primitives. Variant + field-dispatch
 *  nouns refine these; the leaf override wins over everything. */
const TEMPLATE_DEFAULTS: Record<
  TwinTemplate,
  Omit<TwinProfile, "template" | "physical" | "variant" | "hybridBoard">
> = {
  FLOOR: {
    zones: [z("kitchen", "Kitchen / the pass"), z("floor", "Dining room"), z("entrance", "Entrance / waitlist")],
    capacityZoneKey: "floor", // tables live in the dining room, not the pass
    resourceNoun: n("table", "tables"),
    workItemNoun: n("ticket", "tickets"),
    queues: [q("waitlist", "Waitlist"), q("reservations", "Reservations")],
    cog: { kind: "seat-from-dwell", signals: ["dwell-time", "turn-time"] },
    capacityChips: ["tables seated", "seats filled", "parties waiting"],
  },
  TERRITORY: {
    zones: [z("map", "Territory map"), z("base", "Yard / depot")],
    capacityZoneKey: "map",
    resourceNoun: n("technician", "technicians"),
    workItemNoun: n("job", "jobs"),
    queues: [q("dispatch", "Dispatch queue")],
    cog: { kind: "nearest-resource", signals: ["travel-time", "skill", "availability", "parts"] },
    capacityChips: ["available", "en-route", "in dispatch queue"],
  },
  YARD: {
    zones: [z("ready", "Ready line"), z("returns", "Returns & inspection"), z("maintenance", "Maintenance bay"), z("out", "Out on rent")],
    capacityZoneKey: "ready",
    resourceNoun: n("asset", "assets"),
    workItemNoun: n("agreement", "agreements"),
    queues: [q("reservations", "Reservations to fill")],
    cog: { kind: "best-asset-by-readiness", signals: ["readiness", "date-range"] },
    capacityChips: ["assets on rent", "utilization", "overdue"],
    forwardHorizon: true,
  },
  BAYS: {
    zones: [z("intake", "Intake"), z("bays", "Bays / lifts"), z("waiting", "Awaiting parts"), z("ready", "Ready for pickup")],
    capacityZoneKey: "bays", // the bays/lifts hold the countable capacity, not intake
    resourceNoun: n("bay", "bays"),
    workItemNoun: n("work order", "work orders"),
    queues: [q("intake", "Awaiting approval"), q("promised", "Promised-by")],
    cog: { kind: "bay-and-tech", signals: ["labor-hours", "parts", "skill"] },
    capacityChips: ["bays in use", "awaiting parts", "billable hours"],
  },
  BOOK: {
    zones: [z("grid", "Day grid")],
    capacityZoneKey: "grid",
    resourceNoun: n("provider", "providers"),
    workItemNoun: n("appointment", "appointments"),
    queues: [q("requests", "Appointment requests"), q("walkins", "Walk-ins / waitlist")],
    cog: { kind: "provider-slot", signals: ["availability", "skill", "class-fit"] },
    capacityChips: ["provider-hours", "booked", "gaps"],
  },
  ROOMS: {
    zones: [z("board", "Occupancy board")],
    capacityZoneKey: "board",
    resourceNoun: n("room", "rooms"),
    workItemNoun: n("stay", "stays"),
    queues: [q("checkins", "Check-ins"), q("waitlist", "Waitlist")],
    cog: { kind: "room-assignment", signals: ["availability", "date-range"] },
    capacityChips: ["occupancy", "arrivals", "departures"],
    forwardHorizon: true,
  },
  STORE: {
    zones: [z("floor", "Store floor"), z("back", "Back room"), z("online", "Online channel")],
    capacityZoneKey: "floor",
    resourceNoun: n("shelf", "shelves"),
    workItemNoun: n("order", "orders"),
    queues: [q("pickups", "Pickups / online orders"), q("restock", "Low-stock / restock")],
    cog: { kind: "restock-and-pick", signals: ["availability", "workload"] },
    capacityChips: ["low-stock items", "open carts", "on-hand value"],
  },
  VENUE: {
    zones: [z("calendar", "Space / date calendar"), z("runofshow", "Run of show")],
    capacityZoneKey: "calendar",
    resourceNoun: n("space", "spaces"),
    workItemNoun: n("event", "events"),
    queues: [q("holds", "Holds awaiting contract"), q("tickets", "Ticket sales")],
    cog: { kind: "space-and-date", signals: ["date-range", "availability"] },
    capacityChips: ["holds", "seats/covers", "events this week"],
    forwardHorizon: true,
  },
  COUNTER: {
    zones: [z("queue", "Service queue"), z("review", "Case review"), z("inspections", "Inspections")],
    capacityZoneKey: "review", // reviewers work cases in review, not the intake queue
    resourceNoun: n("reviewer", "reviewers"),
    workItemNoun: n("case", "cases"),
    queues: [q("intake", "Intake"), q("review", "Review by department"), q("inspections", "Inspections today")],
    cog: { kind: "next-in-line", signals: ["sla-clock", "workload", "skill"] },
    capacityChips: ["in queue", "SLA at risk", "reviewer-days"],
  },
  DOCK: {
    zones: [
      z("inbound", "Inbound dock"),
      z("racking", "Put-away & racking"),
      z("pick", "Pick faces"),
      z("outbound", "Pack & despatch"),
    ],
    // The racking holds the countable capacity (pallet positions), not the
    // dock apron — doors are a throughput constraint, space is the sold one.
    capacityZoneKey: "racking",
    resourceNoun: n("dock door", "dock doors"),
    workItemNoun: n("shipment", "shipments"),
    queues: [q("appointments", "Inbound appointments"), q("waves", "Outbound waves")],
    // The carrier cut-off is the deadline every wave is racing.
    cog: { kind: "wave-and-picker", signals: ["workload", "availability", "deadline"] },
    capacityChips: ["space utilisation", "dock-to-stock", "orders to despatch"],
  },
  TENANTS: {
    zones: [z("board", "Account health board")],
    capacityZoneKey: "board",
    resourceNoun: n("account", "accounts"),
    workItemNoun: n("engagement", "engagements"),
    queues: [q("renewals", "Renewals at risk"), q("atrisk", "At-risk accounts"), q("ctas", "Open CTAs")],
    cog: { kind: "route-at-risk-account", signals: ["health-score", "workload", "deadline"] },
    capacityChips: ["at-risk", "renewals ≤90d", "book of business"],
  },
  PIPELINE: {
    zones: [z("pipeline", "Engagement pipeline")],
    capacityZoneKey: "pipeline",
    resourceNoun: n("professional", "professionals"),
    workItemNoun: n("matter", "matters"),
    queues: [q("deadlines", "Deadlines"), q("review", "Awaiting review"), q("wip", "Unbilled WIP")],
    cog: { kind: "assign-by-utilization", signals: ["utilization", "skill", "deadline"] },
    capacityChips: ["utilization", "unbilled WIP", "deadlines this week"],
  },
  PROGRAMS: {
    zones: [z("programs", "Programs"), z("moves", "Moves management")],
    capacityZoneKey: "programs",
    resourceNoun: n("program", "programs"),
    workItemNoun: n("campaign", "campaigns"),
    queues: [q("lapsing", "Lapsing donors"), q("grants", "Grant deadlines"), q("shifts", "Volunteer shifts")],
    cog: { kind: "allocate-to-program", signals: ["engagement-score", "availability", "deadline"] },
    capacityChips: ["goal progress", "lapse-risk", "volunteer hours"],
  },
};

/** TERRITORY variant + resource noun depend on category and the field-dispatch profile. */
function territoryVariant(category: ArchetypeCategory): TwinVariant {
  switch (category) {
    case "security-services":
      return "posts";
    case "hoa-property-management":
      return "unit-portfolio";
    case "real-estate-construction":
      return "job-sites";
    default:
      return "fleet"; // trades, moving-and-logistics, mobile automotive
  }
}

interface TemplateChoice {
  template: TwinTemplate;
  variant?: TwinVariant;
}

/**
 * Choose the template + variant. Priority order (per design §5): explicit
 * dispatch/rental axes first, then the board family for non-physical work, then
 * the physical-category mappings, with axes refining category where they can.
 */
function chooseTemplate(
  archetype: ArchetypeDefinition,
  axes: NormalizedOperatingModelAxes | null,
  fieldDispatchEnabled: boolean,
): TemplateChoice {
  const category = archetype.category;
  const commercialModel = axes?.commercialModel;
  const provisioning = axes?.provisioning;
  const delivery = axes?.delivery;
  const platform = axes?.platform;
  const governance = axes?.governance;
  const schedulingPattern = archetype.schedulingDefaults?.schedulingPattern;
  const tags = archetype.tags ?? [];
  const hasTag = (...needles: string[]) =>
    tags.some((t) => needles.some((needle) => t.toLowerCase().includes(needle)));

  // 1. Dispatch-native → TERRITORY (trades, moving, security, mobile automotive,
  //    field property mgmt / construction). Wins over category fallbacks.
  if (fieldDispatchEnabled) {
    return { template: "TERRITORY", variant: territoryVariant(category) };
  }

  // 2. Reservation-and-return pooled assets → YARD.
  if (provisioning === "reservation-and-return" || category === "asset-rental") {
    return { template: "YARD" };
  }

  // 3. Goods held in custody → DOCK. Must precede the board family and the
  //    `form === "goods"` → STORE safety net: a 3PL's floor is racking and dock
  //    doors, not a sales floor with POS lanes, and the stock on it is the
  //    client's, so STORE's restock-and-pick cog would be plain wrong.
  if (provisioning === "custody-and-fulfilment" || category === "warehousing-fulfilment") {
    return { template: "DOCK" };
  }

  // 4. Non-physical → the board family (SaaS/banking/prof-svcs/media/nonprofit).
  //    Category-specific board checks come BEFORE the generic member-owned rule so
  //    a member-owned credit union → TENANTS/portfolio (with "Members" vocabulary),
  //    not the donor/campaign PROGRAMS board.
  if (category === "software-platform") {
    return { template: "TENANTS" };
  }
  if (category === "banking-financial-services") {
    return { template: "TENANTS", variant: "portfolio" };
  }
  if (category === "professional-services") {
    return { template: "PIPELINE" }; // field prof-svcs (surveying/inspection) already caught in step 1
  }
  if (category === "media-production") {
    return { template: "PIPELINE", variant: "timeline" };
  }
  if (category === "nonprofit-community" || governance === "member-owned") {
    return { template: "PROGRAMS" }; // physical co-ops (rental/dispatch) already caught in steps 1-2
  }
  // Axis-driven board fallback for any other purely-digital service.
  if (delivery === "digital") {
    if (platform && platform !== "no") return { template: "TENANTS" };
    if (commercialModel === "subscription" || commercialModel === "usage-based" || commercialModel === "account-based-fees") {
      return { template: "TENANTS" };
    }
    return { template: "PIPELINE" };
  }

  // 5. Physical categories.
  if (category === "food-hospitality") {
    return { template: "FLOOR" };
  }
  if (category === "retail-goods" || commercialModel === "point-of-sale") {
    if (category === "fabric-care-services") {
      return { template: "BAYS" };
    }
    return { template: "STORE" };
  }
  if (category === "live-events-venues") {
    return { template: "VENUE" };
  }
  if (category === "public-sector" || commercialModel === "statutory-fees-and-levies") {
    return { template: "COUNTER" };
  }
  // Property, construction, and trades are spatial even when their axes don't set
  // the dispatch channel — a work-order board / job-site map / crew board, not an
  // appointment book. Map by category so they don't fall through to BOOK/PIPELINE.
  if (category === "hoa-property-management") {
    return { template: "TERRITORY", variant: "unit-portfolio" };
  }
  if (category === "real-estate-construction") {
    return { template: "TERRITORY", variant: "job-sites" };
  }
  if (category === "trades-maintenance") {
    return { template: "TERRITORY", variant: "fleet" };
  }
  if (category === "automotive-services") {
    return { template: "BAYS" }; // dispatch-native (mobile) automotive already caught in step 1
  }
  if (category === "pet-services") {
    return hasTag("board", "kennel", "daycare", "lodging", "hotel")
      ? { template: "ROOMS" }
      : { template: "BOOK", variant: "provider-chair" };
  }
  if (category === "healthcare-wellness") {
    return hasTag("hospital", "inpatient", "ward", "bed")
      ? { template: "ROOMS" }
      : { template: "BOOK", variant: "provider-x-room" };
  }
  if (category === "beauty-personal-care") {
    return { template: "BOOK", variant: "provider-chair" };
  }
  if (category === "fitness-recreation" || category === "education-training" || schedulingPattern === "class") {
    return { template: "BOOK", variant: "class-grid" };
  }

  // 6. Final safety net — never return undefined.
  if (schedulingPattern === "slot") return { template: "BOOK", variant: "provider-chair" };
  if (axes?.form === "goods") return { template: "STORE" };
  return { template: "PIPELINE" };
}

function applyOverride(base: TwinProfile, override: TwinProfileOverride | undefined): TwinProfile {
  if (!override) return base;
  return {
    ...base,
    ...(override.template ? { template: override.template } : {}),
    ...(override.variant ? { variant: override.variant } : {}),
    ...(override.physical !== undefined ? { physical: override.physical } : {}),
    ...(override.zones ? { zones: override.zones } : {}),
    ...(override.capacityZoneKey ? { capacityZoneKey: override.capacityZoneKey } : {}),
    resourceNoun: { ...base.resourceNoun, ...override.resourceNoun },
    workItemNoun: { ...base.workItemNoun, ...override.workItemNoun },
    ...(override.queues ? { queues: override.queues } : {}),
    cog: { ...base.cog, ...override.cog },
    ...(override.capacityChips ? { capacityChips: override.capacityChips } : {}),
    ...(override.forwardHorizon !== undefined ? { forwardHorizon: override.forwardHorizon } : {}),
    ...(override.hybridBoard ? { hybridBoard: override.hybridBoard } : {}),
  };
}

/** Board lens paired to a physical template for a hybrid (physical + digital) archetype. */
function hybridBoardFor(template: TwinTemplate): TwinTemplate | undefined {
  switch (template) {
    case "STORE":
      return "TENANTS"; // retail-with-online
    case "BOOK":
      return "PIPELINE"; // e.g. telehealth alongside in-person
    default:
      return undefined;
  }
}

/**
 * Derive the operational-twin configuration for an archetype. Pure, total
 * (always returns a valid template), and override-respecting. This is the
 * single source of truth for "which twin does this archetype get, with which
 * nouns" — consumed by the twin render kit and the workspace-home registry.
 */
export function deriveTwinProfile(archetype: ArchetypeDefinition): TwinProfile {
  const activation = readActivationProfile(archetype.activationProfile);
  const axes = activation?.axes ?? null;

  // Field-dispatch enablement: axes drive it (needsFieldDispatch), but an
  // explicit inline `fieldDispatch.enabled` forces the outcome either way.
  let fieldDispatchEnabled = false;
  let fdResource: TwinNoun | undefined;
  if (archetype.fieldDispatch?.enabled === true) {
    fieldDispatchEnabled = true;
  } else if (archetype.fieldDispatch?.enabled === false) {
    fieldDispatchEnabled = false;
  } else if (axes) {
    const fd = deriveFieldDispatchProfile(axes, archetype.archetypeId, archetype.fieldDispatch);
    fieldDispatchEnabled = fd !== null;
    if (fd) fdResource = n(fd.resource.noun, fd.resource.nounPlural);
  }
  // Recover the resource noun when enablement was forced on without axes.
  if (fieldDispatchEnabled && !fdResource && axes) {
    const fd = deriveFieldDispatchProfile(axes, archetype.archetypeId, {
      ...archetype.fieldDispatch,
      enabled: true,
    });
    if (fd) fdResource = n(fd.resource.noun, fd.resource.nounPlural);
  }

  const { template, variant } = chooseTemplate(archetype, axes, fieldDispatchEnabled);
  const defaults = TEMPLATE_DEFAULTS[template];

  const base: TwinProfile = {
    template,
    ...(variant ? { variant } : {}),
    physical: PHYSICAL_TEMPLATES.has(template),
    zones: defaults.zones.map((zone) => ({ ...zone })),
    capacityZoneKey: defaults.capacityZoneKey,
    resourceNoun:
      template === "TERRITORY" && fdResource ? fdResource : { ...defaults.resourceNoun },
    workItemNoun: { ...defaults.workItemNoun },
    queues: defaults.queues.map((queue) => ({ ...queue })),
    cog: { kind: defaults.cog.kind, signals: [...defaults.cog.signals] },
    capacityChips: [...defaults.capacityChips],
    ...(defaults.forwardHorizon ? { forwardHorizon: true } : {}),
  };

  // Hybrid archetypes get a secondary board lens (physical + digital).
  if (axes?.delivery === "hybrid") {
    const secondary = hybridBoardFor(template);
    if (secondary) base.hybridBoard = secondary;
  }

  return applyOverride(base, archetype.twinProfile);
}
