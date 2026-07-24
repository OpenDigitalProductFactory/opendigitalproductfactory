// Vertical incumbent provider inventory (BI-513AE505, P0 of BI-ECO-001).
//
// Plan: docs/superpowers/plans/2026-07-24-absorption-posture-matrix-vertical-provider-seed.md §4 P0.
// Design: docs/superpowers/specs/2026-07-24-vertical-backlog-investment-architecture-design.md §6.
//
// The 19 EP-VERTICAL-* integration/replacement-boundary-map BIs name ~100
// external incumbents each vertical coexists with or displaces. Spec §8 is
// explicit that this belongs as STRUCTURED DATA feeding the absorption matrix,
// not left in prose BI bodies. This module is that canonical home. It carries
// NO absorption verdict — it is the raw inventory. P1 (AbsorptionPosture) reads
// it to seed the matrix; the verdict is authored there, conservatively.
//
// Three facts per provider:
//   - integrationCategory: the KIND of system it is (the unit of connector
//     tiering — spec §6.1 tiers CATEGORIES, not vendors).
//   - verticalKey: which vertical named it (spec §6.2 grouping). Expands to the
//     granular storefront archetypeIds via VERTICAL_ARCHETYPES — one vertical
//     maps to MULTIPLE archetypes (fitness → gym/yoga-studio/dance-studio), so
//     the posture applies to each. archetypeIds are validated against the real
//     ALL_ARCHETYPES set in the parity test (a stale id fails CI).
//
// Closed string enums per AGENTS.md §3; guarded by the isX predicates below and
// the seed-parity test. packages/db depends on @dpf/storefront-templates
// (never the reverse), so importing the archetype set here is dependency-safe.

/** Connector build-order tiers (spec §6.1). tier1 = shared across ≥5 verticals
 *  (highest leverage); tier2 = semi-shared (2–4); tier3 = vertical-bespoke (1). */
export const CONNECTOR_TIERS = ["tier1-shared", "tier2-semi", "tier3-bespoke"] as const;
export type ConnectorTier = (typeof CONNECTOR_TIERS)[number];
export function isConnectorTier(value: string): value is ConnectorTier {
  return (CONNECTOR_TIERS as readonly string[]).includes(value);
}

// ─── Integration category → connector tier ──────────────────────────────────
//
// The category is the unit of tiering. A provider's connectorTier is DERIVED
// from its category via this map (never hand-set per provider), so the tier
// stays consistent across every vendor in a category. The keys are the closed
// integrationCategory enum.
export const INTEGRATION_CATEGORY_TIER = {
  // Tier 1 — shared connectors (recur across ≥5 verticals; build once).
  payments: "tier1-shared",
  calendar: "tier1-shared",
  messaging: "tier1-shared",
  documents: "tier1-shared",
  accounting: "tier1-shared",
  crm: "tier1-shared",
  inventory: "tier1-shared",
  // Tier 2 — semi-shared connectors (2–4 verticals).
  pos: "tier2-semi",
  routing: "tier2-semi",
  telematics: "tier2-semi",
  "access-control": "tier2-semi",
  psa: "tier2-semi",
  rmm: "tier2-semi",
  "it-documentation": "tier2-semi",
  "project-management": "tier2-semi",
  reservations: "tier2-semi",
  shipping: "tier2-semi",
  "field-service-management": "tier2-semi",
  // Tier 3 — vertical-bespoke connectors / operating systems (1 vertical).
  "core-banking": "tier3-bespoke",
  "loan-origination": "tier3-bespoke",
  lms: "tier3-bespoke",
  "class-management": "tier3-bespoke",
  ticketing: "tier3-bespoke",
  "feature-flags": "tier3-bespoke",
  "product-analytics": "tier3-bespoke",
  "product-management": "tier3-bespoke",
  "permitting-311": "tier3-bespoke",
  "donor-crm": "tier3-bespoke",
  "rental-management": "tier3-bespoke",
  "self-storage-management": "tier3-bespoke",
  "auto-shop-management": "tier3-bespoke",
  "construction-management": "tier3-bespoke",
  "event-management": "tier3-bespoke",
  "catering-management": "tier3-bespoke",
  "fitness-management": "tier3-bespoke",
  "property-management": "tier3-bespoke",
  "media-production": "tier3-bespoke",
  "moving-management": "tier3-bespoke",
  "pet-service-management": "tier3-bespoke",
  "legal-practice-management": "tier3-bespoke",
  "accounting-practice-management": "tier3-bespoke",
  govtech: "tier3-bespoke",
  "guard-management": "tier3-bespoke",
  "alarm-management": "tier3-bespoke",
  "wholesale-marketplace": "tier3-bespoke",
} as const satisfies Record<string, ConnectorTier>;

export type IntegrationCategory = keyof typeof INTEGRATION_CATEGORY_TIER;
export const INTEGRATION_CATEGORIES = Object.keys(
  INTEGRATION_CATEGORY_TIER,
) as IntegrationCategory[];
export function isIntegrationCategory(value: string): value is IntegrationCategory {
  return Object.prototype.hasOwnProperty.call(INTEGRATION_CATEGORY_TIER, value);
}

/** The connector tier for a category (derived, never hand-set per provider). */
export function connectorTierForCategory(category: IntegrationCategory): ConnectorTier {
  return INTEGRATION_CATEGORY_TIER[category];
}

// ─── Vertical → granular storefront archetypeIds ────────────────────────────
//
// spec §6.2 groups incumbents by vertical; each vertical maps to the granular
// archetypeIds defined in packages/storefront-templates/src/archetypes/*.ts.
// A provider's posture applies to EVERY archetype in its vertical. Values are
// validated against ALL_ARCHETYPES in the parity test.
export const VERTICAL_ARCHETYPES = {
  "asset-rental": ["equipment-rental", "self-storage", "production-equipment-rental"],
  automotive: ["auto-glass", "mobile-mechanic", "mobile-detailing", "mobile-tire", "roadside-assistance", "locksmith"],
  banking: ["community-bank", "credit-union", "mortgage-lending"],
  construction: ["new-home-builder", "custom-home-builder"],
  education: ["corporate-training", "tutoring", "music-school", "driving-school"],
  events: ["event-venue", "tour-promoter", "talent-booking-agency"],
  fitness: ["gym", "yoga-studio", "dance-studio"],
  food: ["restaurant", "catering", "bakery"],
  hoa: ["homeowners-association", "condo-association", "property-management-company"],
  msp: ["it-managed-services"],
  media: ["film-video-production", "post-production-studio", "event-production-staging"],
  moving: ["moving-company", "junk-removal", "courier-delivery", "last-mile-freight", "freight-brokerage"],
  nonprofit: ["pet-rescue", "animal-shelter", "community-shelter", "charity", "sports-club", "cooperative", "agricultural-cooperative", "meal-delivery-program"],
  pet: ["pet-grooming", "dog-walking", "pet-boarding", "mobile-pet-grooming", "mobile-vet"],
  professional: ["legal-services", "accounting", "marketing-agency", "consulting", "field-inspection", "land-surveying", "process-serving-notary"],
  "public-sector": ["small-town-municipality", "municipal-utility", "law-enforcement-agency"],
  retail: ["retail-goods", "artisan-goods", "florist", "wholesale-distribution", "furniture-delivery-install"],
  security: ["guard-patrol", "alarm-cctv-install"],
  software: ["software-platform"],
} as const satisfies Record<string, readonly string[]>;

export type VerticalKey = keyof typeof VERTICAL_ARCHETYPES;
export function isVerticalKey(value: string): value is VerticalKey {
  return Object.prototype.hasOwnProperty.call(VERTICAL_ARCHETYPES, value);
}

/** The granular archetypeIds a vertical's incumbents apply to. */
export function archetypeIdsForVertical(vertical: VerticalKey): readonly string[] {
  return VERTICAL_ARCHETYPES[vertical];
}

// ─── The inventory ──────────────────────────────────────────────────────────
export interface VerticalIncumbent {
  /** Vendor / product name as named in the boundary-map BIs. */
  providerName: string;
  /** The kind of system it is — determines the connector tier. */
  integrationCategory: IntegrationCategory;
  /** The vertical (spec §6.2) that named it; expands to archetypeIds. */
  verticalKey: VerticalKey;
}

export const VERTICAL_INCUMBENTS: readonly VerticalIncumbent[] = [
  // Asset-rental
  { providerName: "Point of Rental", integrationCategory: "rental-management", verticalKey: "asset-rental" },
  { providerName: "RentalMan", integrationCategory: "rental-management", verticalKey: "asset-rental" },
  { providerName: "EZRentOut", integrationCategory: "rental-management", verticalKey: "asset-rental" },
  { providerName: "Quipli", integrationCategory: "rental-management", verticalKey: "asset-rental" },
  { providerName: "Rentle", integrationCategory: "rental-management", verticalKey: "asset-rental" },
  { providerName: "StoragePug", integrationCategory: "self-storage-management", verticalKey: "asset-rental" },
  // Automotive
  { providerName: "Shopmonkey", integrationCategory: "auto-shop-management", verticalKey: "automotive" },
  { providerName: "Tekmetric", integrationCategory: "auto-shop-management", verticalKey: "automotive" },
  { providerName: "AutoLeap", integrationCategory: "auto-shop-management", verticalKey: "automotive" },
  { providerName: "RepairShopr", integrationCategory: "auto-shop-management", verticalKey: "automotive" },
  // Banking
  { providerName: "Banno", integrationCategory: "core-banking", verticalKey: "banking" },
  { providerName: "Alkami", integrationCategory: "core-banking", verticalKey: "banking" },
  { providerName: "Backbase", integrationCategory: "core-banking", verticalKey: "banking" },
  { providerName: "Q2", integrationCategory: "core-banking", verticalKey: "banking" },
  { providerName: "nCino", integrationCategory: "loan-origination", verticalKey: "banking" },
  { providerName: "Blend", integrationCategory: "loan-origination", verticalKey: "banking" },
  // Construction
  { providerName: "Buildertrend", integrationCategory: "construction-management", verticalKey: "construction" },
  { providerName: "Procore", integrationCategory: "construction-management", verticalKey: "construction" },
  { providerName: "JobTread", integrationCategory: "construction-management", verticalKey: "construction" },
  { providerName: "CoConstruct", integrationCategory: "construction-management", verticalKey: "construction" },
  { providerName: "Houzz Pro", integrationCategory: "construction-management", verticalKey: "construction" },
  // Education
  { providerName: "TutorCruncher", integrationCategory: "class-management", verticalKey: "education" },
  { providerName: "Teachworks", integrationCategory: "class-management", verticalKey: "education" },
  { providerName: "Jackrabbit", integrationCategory: "class-management", verticalKey: "education" },
  { providerName: "Sawyer", integrationCategory: "class-management", verticalKey: "education" },
  { providerName: "Thinkific", integrationCategory: "lms", verticalKey: "education" },
  { providerName: "Arlo", integrationCategory: "lms", verticalKey: "education" },
  // Events
  { providerName: "Tripleseat", integrationCategory: "event-management", verticalKey: "events" },
  { providerName: "Event Temple", integrationCategory: "event-management", verticalKey: "events" },
  { providerName: "Planning Pod", integrationCategory: "event-management", verticalKey: "events" },
  { providerName: "Prism", integrationCategory: "event-management", verticalKey: "events" },
  { providerName: "Eventbrite", integrationCategory: "ticketing", verticalKey: "events" },
  { providerName: "Momentus", integrationCategory: "event-management", verticalKey: "events" },
  // Fitness
  { providerName: "Mindbody", integrationCategory: "fitness-management", verticalKey: "fitness" },
  { providerName: "WellnessLiving", integrationCategory: "fitness-management", verticalKey: "fitness" },
  { providerName: "Glofox", integrationCategory: "fitness-management", verticalKey: "fitness" },
  { providerName: "PushPress", integrationCategory: "fitness-management", verticalKey: "fitness" },
  { providerName: "ClubReady", integrationCategory: "fitness-management", verticalKey: "fitness" },
  // Food
  { providerName: "Toast", integrationCategory: "pos", verticalKey: "food" },
  { providerName: "Square Restaurants", integrationCategory: "pos", verticalKey: "food" },
  { providerName: "OpenTable", integrationCategory: "reservations", verticalKey: "food" },
  { providerName: "Resy", integrationCategory: "reservations", verticalKey: "food" },
  { providerName: "CaterZen", integrationCategory: "catering-management", verticalKey: "food" },
  { providerName: "Craftybase", integrationCategory: "inventory", verticalKey: "food" },
  // HOA
  { providerName: "AppFolio", integrationCategory: "property-management", verticalKey: "hoa" },
  { providerName: "Buildium", integrationCategory: "property-management", verticalKey: "hoa" },
  { providerName: "Enumerate", integrationCategory: "property-management", verticalKey: "hoa" },
  { providerName: "Condo Control", integrationCategory: "property-management", verticalKey: "hoa" },
  { providerName: "DoorLoop", integrationCategory: "property-management", verticalKey: "hoa" },
  // MSP
  { providerName: "ConnectWise", integrationCategory: "psa", verticalKey: "msp" },
  { providerName: "Autotask", integrationCategory: "psa", verticalKey: "msp" },
  { providerName: "HaloPSA", integrationCategory: "psa", verticalKey: "msp" },
  { providerName: "NinjaOne", integrationCategory: "rmm", verticalKey: "msp" },
  { providerName: "Datto", integrationCategory: "rmm", verticalKey: "msp" },
  { providerName: "N-able", integrationCategory: "rmm", verticalKey: "msp" },
  { providerName: "Hudu", integrationCategory: "it-documentation", verticalKey: "msp" },
  { providerName: "IT Glue", integrationCategory: "it-documentation", verticalKey: "msp" },
  // Media
  { providerName: "StudioBinder", integrationCategory: "media-production", verticalKey: "media" },
  { providerName: "Frame.io", integrationCategory: "media-production", verticalKey: "media" },
  { providerName: "Yamdu", integrationCategory: "media-production", verticalKey: "media" },
  { providerName: "Celtx", integrationCategory: "media-production", verticalKey: "media" },
  { providerName: "Monday", integrationCategory: "project-management", verticalKey: "media" },
  { providerName: "ShotGrid", integrationCategory: "media-production", verticalKey: "media" },
  // Moving
  { providerName: "Onfleet", integrationCategory: "routing", verticalKey: "moving" },
  { providerName: "Routific", integrationCategory: "routing", verticalKey: "moving" },
  { providerName: "Samsara", integrationCategory: "telematics", verticalKey: "moving" },
  { providerName: "Moverbase", integrationCategory: "moving-management", verticalKey: "moving" },
  { providerName: "Supermove", integrationCategory: "moving-management", verticalKey: "moving" },
  { providerName: "Shipday", integrationCategory: "routing", verticalKey: "moving" },
  // Nonprofit
  { providerName: "Bloomerang", integrationCategory: "donor-crm", verticalKey: "nonprofit" },
  { providerName: "Blackbaud", integrationCategory: "donor-crm", verticalKey: "nonprofit" },
  { providerName: "Givebutter", integrationCategory: "donor-crm", verticalKey: "nonprofit" },
  { providerName: "Little Green Light", integrationCategory: "donor-crm", verticalKey: "nonprofit" },
  { providerName: "EveryAction", integrationCategory: "donor-crm", verticalKey: "nonprofit" },
  // Pet
  { providerName: "Gingr", integrationCategory: "pet-service-management", verticalKey: "pet" },
  { providerName: "MoeGo", integrationCategory: "pet-service-management", verticalKey: "pet" },
  { providerName: "Time To Pet", integrationCategory: "pet-service-management", verticalKey: "pet" },
  { providerName: "Pawfinity", integrationCategory: "pet-service-management", verticalKey: "pet" },
  { providerName: "PetExec", integrationCategory: "pet-service-management", verticalKey: "pet" },
  // Professional
  { providerName: "Clio", integrationCategory: "legal-practice-management", verticalKey: "professional" },
  { providerName: "Karbon", integrationCategory: "accounting-practice-management", verticalKey: "professional" },
  { providerName: "Teamwork", integrationCategory: "project-management", verticalKey: "professional" },
  { providerName: "Accelo", integrationCategory: "psa", verticalKey: "professional" },
  { providerName: "HoneyBook", integrationCategory: "crm", verticalKey: "professional" },
  { providerName: "ConnectWise PSA", integrationCategory: "psa", verticalKey: "professional" },
  // Public sector
  { providerName: "Tyler Technologies", integrationCategory: "govtech", verticalKey: "public-sector" },
  { providerName: "OpenGov", integrationCategory: "govtech", verticalKey: "public-sector" },
  { providerName: "CivicPlus", integrationCategory: "govtech", verticalKey: "public-sector" },
  { providerName: "Granicus", integrationCategory: "govtech", verticalKey: "public-sector" },
  { providerName: "Accela", integrationCategory: "permitting-311", verticalKey: "public-sector" },
  { providerName: "SeeClickFix", integrationCategory: "permitting-311", verticalKey: "public-sector" },
  // Retail
  { providerName: "Shopify POS", integrationCategory: "pos", verticalKey: "retail" },
  { providerName: "Lightspeed", integrationCategory: "pos", verticalKey: "retail" },
  { providerName: "Square Retail", integrationCategory: "pos", verticalKey: "retail" },
  { providerName: "Cin7", integrationCategory: "inventory", verticalKey: "retail" },
  { providerName: "Faire", integrationCategory: "wholesale-marketplace", verticalKey: "retail" },
  { providerName: "ShipStation", integrationCategory: "shipping", verticalKey: "retail" },
  // Security
  { providerName: "TrackTik", integrationCategory: "guard-management", verticalKey: "security" },
  { providerName: "Silvertrac", integrationCategory: "guard-management", verticalKey: "security" },
  { providerName: "Guardhouse", integrationCategory: "guard-management", verticalKey: "security" },
  { providerName: "Simpro", integrationCategory: "field-service-management", verticalKey: "security" },
  { providerName: "SecurityTrax", integrationCategory: "alarm-management", verticalKey: "security" },
  // Software
  { providerName: "Productboard", integrationCategory: "product-management", verticalKey: "software" },
  { providerName: "Jira Product Discovery", integrationCategory: "product-management", verticalKey: "software" },
  { providerName: "Linear", integrationCategory: "product-management", verticalKey: "software" },
  { providerName: "Intercom", integrationCategory: "messaging", verticalKey: "software" },
  { providerName: "LaunchDarkly", integrationCategory: "feature-flags", verticalKey: "software" },
  { providerName: "PostHog", integrationCategory: "product-analytics", verticalKey: "software" },
];
