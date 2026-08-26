import type { FieldDispatchProfileOverride } from "./field-dispatch";
import type { TwinProfileOverride } from "./twin-profile";

export type CtaType = "booking" | "purchase" | "inquiry" | "donation" | "rental";

export type PriceType =
  | "fixed" | "from" | "per-hour" | "per-session"
  | "free" | "donation" | "quote";

export type SectionType =
  | "hero" | "about" | "items" | "team" | "gallery"
  | "contact" | "testimonials" | "donate"
  | "animals-available" | "disclosures" | "custom"
  // Banking-only interactive section: loan/mortgage payment calculator.
  // Gated to banking-financial-services at seed time; not addable by other archetypes.
  | "calculator";

export type ArchetypeCategory =
  | "healthcare-wellness"
  | "beauty-personal-care"
  | "trades-maintenance"
  | "professional-services"
  | "software-platform"
  | "education-training"
  | "pet-services"
  | "food-hospitality"
  | "retail-goods"
  | "fitness-recreation"
  | "nonprofit-community"
  | "hoa-property-management"
  | "banking-financial-services"
  | "public-sector"
  /** Rental of a reusable pooled asset — equipment/tool hire and self-storage.
   *  The defining value stream is reserve → hand out → use → return → inspect →
   *  re-pool (the S4b Return & Inspect stage); see
   *  docs/architecture/archetype-business-value-streams.md §10.1 and
   *  docs/superpowers/specs/2026-05-29-vehicle-equipment-rental-archetype-design.md. */
  | "asset-rental"
  /** Residential construction: production builders (communities and display homes)
   *  and custom builders (build-on-your-lot / BYOL). The defining value stream is
   *  design → permit → build → inspect → handover; subcontractors deliver most
   *  trade work under the builder's project management umbrella. */
  | "real-estate-construction"
  /** Automotive field services: a technician travels to the customer's vehicle
   *  (auto glass, mobile mechanic/detailing/tire, roadside/towing, locksmith).
   *  Dispatch-native — the distinctive substrate is VIN→part resolution and the
   *  ADAS calibration compliance overlay (a moat sibling to HVAC's EPA 608). See
   *  docs/superpowers/research/2026-06-13-field-dispatch-archetype-gap-analysis.md §4 (B1). */
  | "automotive-services"
  /** Moving & last-mile logistics: a crew and truck travel to load, haul, and
   *  deliver (moving, junk removal, courier, last-mile freight). Crew+truck
   *  dispatch with a DOT hours-of-service overlay; distinct from
   *  wholesale-distribution's B2B route delivery. Gap analysis §4 (B2). */
  | "moving-and-logistics"
  /** Physical security services: guard/patrol dispatch (post assignments, patrol
   *  routes, incident response — a real-time dispatch variant) and alarm/CCTV
   *  field installation with recurring monitoring. Guard (PSO) and low-voltage
   *  licensing overlays. Gap analysis §4 (B3). */
  | "security-services"
  /** Media & production: the businesses that MAKE the content — film / commercial
   *  / branded-video production companies, post-production & VFX studios, and
   *  event production / AV / staging houses. Project-based value stream (brief →
   *  pre-production → shoot/build → post/strike → deliver) billed against
   *  milestones through the projects module. Distinct from live-events-venues
   *  (which sells tickets to the show). See
   *  docs/superpowers/specs/2026-07-11-entertainment-industry-archetypes-design.md. */
  | "media-production"
  /** Live events & venues: the businesses that SELL the show — ticketed event
   *  venues / box offices (theatres, concert halls, live-music clubs), tour /
   *  concert promoters (arrange tours, book talent + venues, carry box-office
   *  risk), and talent & booking agencies. Event-driven, ticketed value stream;
   *  capacity is a physical hard cap (seats/room). Same design doc as above. */
  | "live-events-venues"
  /** Warehousing & fulfilment: the business takes **custody of goods it does not
   *  own** into a facility and is paid to hold and handle them — 3PL contract
   *  warehousing, e-commerce fulfilment centres, cold/temperature-controlled
   *  storage, and bonded/records storage. The defining value stream is
   *  receive → put-away → store → pick/pack → despatch (the S4c Receive & Store
   *  stage), billed as storage rent (per pallet/bin per period) plus handling
   *  (per receipt/pick/order). Custody is the discriminator: distinct from
   *  `asset-rental`'s `self-storage` (the customer keeps their own key and
   *  self-serves — no custody, no handling), from `retail-goods`'
   *  `wholesale-distribution` (sells stock it *owns*), and from
   *  `moving-and-logistics` (custody is transient and in-transit, with no
   *  facility inventory of record). See
   *  docs/superpowers/specs/2026-07-21-warehousing-fulfilment-archetype-design.md. */
  | "warehousing-fulfilment"
  /** Fabric-care services: dry cleaners, laundries, and alterations shops take
   *  custody of customer garments/textiles, issue a claim ticket, process work
   *  through a plant or counter network, and return the same customer property
   *  against a ready promise. Distinct from beauty-personal-care appointments
   *  (the customer is not the work surface), warehousing-fulfilment B2B stock
   *  custody, and trades-maintenance site work. See
   *  docs/superpowers/specs/2026-07-22-fabric-care-services-archetype-design.md. */
  | "fabric-care-services"
  /** Agriculture and ranching: land-based production systems whose operating
   *  clock is seasonal and biological. Covers forage/crop cycles, grazing and
   *  livestock health, working animals, equipment readiness, regulated inputs,
   *  outside services, and market/weather decisions. */
  | "agriculture-ranching"
  /** Discrete manufacturing and industrial OEMs own the transformation of
   *  materials into serialized finished goods. The defining operating loop is
   *  release → make → inspect → hold/rework → ship, organized by the ISA-95
   *  enterprise/site/area/line/cell/equipment hierarchy. */
  | "manufacturing";

export interface FormField {
  name: string;
  label: string;
  type: "text" | "email" | "tel" | "textarea" | "select";
  required: boolean;
  options?: string[];         // for select type
  placeholder?: string;
}

export interface ItemTemplate {
  name: string;
  description: string;
  priceType: PriceType;
  ctaType?: CtaType;          // overrides archetype default if set
  ctaLabel?: string;
  /**
   * Optional seed price in the catalogue currency (the setup route seeds items
   * in GBP). Set on `fixed`/`from` items — especially `purchase` items — so the
   * storefront ships with a chargeable price out-of-the-box. A `purchase` item
   * with no `priceAmount` would otherwise render a Buy CTA that 404s at checkout
   * (the order route 404s on a null price); see {@link CtaButton}'s guard. Left
   * unset for `quote`/`free`/`donation`/`per-hour`/`per-session` items, where the
   * operator supplies the figure. Operator-overridable from the admin items
   * manager.
   */
  priceAmount?: number;
  bookingDurationMinutes?: number;
  /**
   * Image affordance this item template expects. When set, the storefront editor
   * surfaces an image/gallery slot for items seeded from this template (e.g. a
   * retail product or a rentable excavator). Usually left unset — the
   * archetype-level {@link MediaProfile} (derived in media-profile.ts) covers
   * the common case; this is the per-item override.
   */
  mediaRole?: MediaRole;
}

/**
 * A kind of image a business surface carries. Roles are how a {@link MediaSlot}
 * and a `MediaAttachment` (DB) describe *what* an image is, independent of which
 * entity holds it — so the storefront renderer and upload UI can treat a product
 * gallery, an adoptable-animal gallery, and an equipment gallery uniformly.
 */
export type MediaRole =
  | "logo"          // organization mark
  | "hero"          // storefront hero/banner
  | "gallery"       // general portfolio/work showcase
  | "product"       // a sellable item's photos (retail, food, artisan)
  | "equipment"     // a rentable unit's photos (asset-rental)
  | "avatar"        // staff/provider/instructor headshot
  | "animal"        // adoptable-animal photos (pet-rescue, animal-shelter)
  | "before-after"  // transformation pairs (beauty, grooming, fitness)
  | "facility"      // premises/space photos (storage, spa, clinic)
  | "certificate";  // credential/qualification images

/** Which entity a {@link MediaSlot}'s images attach to. */
export type MediaOwner =
  | "organization"
  | "storefront"
  | "item"
  | "provider"
  | "section"
  | "animal"
  | "rentable-unit";

/**
 * One declared image need for an archetype: a {@link MediaRole} on a
 * {@link MediaOwner}, with how strongly it applies and whether it is a gallery.
 * Derived from the archetype's sections/ctaType/category/axes by
 * `deriveMediaProfile` (media-profile.ts), not hand-authored per archetype —
 * mirroring how `BillingPatternProfile` is derived from `commercialModel`.
 */
export interface MediaSlot {
  role: MediaRole;
  owner: MediaOwner;
  applicability: "required" | "recommended" | "optional";
  /** True for an ordered gallery; false for a single image. */
  multiple: boolean;
  label: string;
  /** Why this image matters — ties the slot to the customer journey. */
  reason: string;
}

/** The full set of image affordances an archetype surfaces. */
export interface MediaProfile {
  slots: MediaSlot[];
}

export interface SectionTemplate {
  type: SectionType;
  title: string;
  sortOrder: number;
  /** Seed content for sections that need defaults beyond an empty object (e.g. calculator). */
  content?: Record<string, unknown>;
}

export interface SchedulingDefaults {
  schedulingPattern: "slot" | "class" | "recurring";
  assignmentMode: "next-available" | "customer-choice";
  defaultOperatingHours: { day: number; start: string; end: string }[];
  defaultBeforeBuffer: number;
  defaultAfterBuffer: number;
  minimumNoticeHours: number;
  maxAdvanceDays: number;
}

export type ArchetypeModule =
  | "customer-estate"
  | "service-agreements"
  | "billing-readiness"
  | "service-operations"
  | "projects"
  | "lifecycle-signals"
  | "integrations"
  | "rental-fleet"
  | "rental-agreements"
  /**
   * Mobile-resource-to-customer-site coordination (dispatcher coworker +
   * dispatch board). A *derived* module — `needsFieldDispatch(axes)` adds it
   * during activation-profile normalization; it is never hand-authored into an
   * archetype literal. Composes with `service-operations` (which stays the
   * office-side service-work module). See field-dispatch.ts and
   * docs/superpowers/specs/2026-06-13-field-dispatch-capability-design.md.
   */
  | "field-dispatch";

export type ArchetypeProfileType = "standard" | "managed-service-provider";

export type BillingReadinessMode = "none" | "prepared-not-prescribed";

export type CustomerGraphMode = "none" | "separate-customer-projection";

export type EstateSeparationMode = "shared" | "strict";

export type TechnologySourceType = "commercial" | "open_source" | "hybrid";

export type OperatingModelForm = "goods" | "services";

export type OperatingModelDelivery = "digital" | "physical" | "hybrid";

export type PrimaryConsumer =
  | "individual"
  | "household"
  | "business"
  | "patient-and-payer"
  | "channel-partner"
  | "internal"
  /** Owner-patron with governance rights (credit union, cooperative). */
  | "member"
  /** Served party defined by jurisdiction with statutory rights and a universal-service obligation (town, utility, police). */
  | "resident";

export type ConsumptionChannel =
  | "physical"
  | "web-app"
  | "portal-api"
  | "sales-assisted"
  | "onsite-plus-portal"
  | "api-portal-cli"
  | "multi-channel"
  | "portal-dashboard";

export type CommercialModel =
  | "transactional"
  | "subscription"
  | "recurring-agreement"
  | "usage-based"
  | "account-based-fees"
  | "encounter-based"
  | "appointment-checkout"
  | "point-of-sale"
  /** Revenue arrives by levy/assessment/fee schedule set by ordinance or statute, not by sale. */
  | "statutory-fees-and-levies"
  | "hybrid";

export type ProvisioningModel =
  | "none"
  | "account-with-billing"
  | "account-and-entitlement"
  | "account-with-kyc"
  | "device-bound"
  | "episode-of-care"
  /** The served party gets access by reserving a pooled asset, receiving it,
   *  and returning it — the rental/shared-asset entitlement model. Distinct from
   *  account-with-billing: the asset is re-pooled, not consumed. Gates the
   *  rental-fleet / rental-agreements / asset-pool capabilities. */
  | "reservation-and-return"
  /** The operator takes **custody of goods it does not own** into its facility
   *  and is paid to hold and handle them (bailment) — 3PL warehousing,
   *  fulfilment, cold storage, cross-dock. The mirror image of
   *  reservation-and-return: there, the operator's own asset goes out to the
   *  customer and comes back; here, the customer's goods come in and the
   *  operator handles them. Gates the goods-custody / warehouse-operations /
   *  storage-and-handling-billing capabilities. See
   *  docs/superpowers/specs/2026-07-21-warehousing-fulfilment-archetype-design.md. */
  | "custody-and-fulfilment";

export type PlatformEcosystem = "no" | "yes-marketplace" | "yes-developer";

/**
 * How the organization is governed — orthogonal to {@link PrimaryConsumer}
 * (a community bank is investor-owned serving individuals/businesses; an
 * electric co-op is member-owned serving member ratepayers; a municipal
 * utility is a public body serving resident ratepayers). Gates the
 * member-governance and public-body-governance capabilities; see
 * docs/superpowers/specs/2026-06-09-civic-and-member-governed-archetypes-design.md §6.1.
 */
export type GovernanceModel = "investor-owned" | "member-owned" | "public-body";

export interface OperatingModelAxes {
  form: OperatingModelForm;
  delivery: OperatingModelDelivery;
  primaryConsumer: PrimaryConsumer;
  consumptionChannel: ConsumptionChannel;
  commercialModel: CommercialModel;
  provisioning: ProvisioningModel;
  platform: PlatformEcosystem;
  /**
   * Optional so the 45+ existing archetype literals stay valid; the
   * normalizer defaults absent values to "investor-owned"
   * (readActivationProfile survival rule — consumers never branch on absence).
   */
  governance?: GovernanceModel;
}

export type PortfolioRole =
  | "foundational"
  | "manufactureAndDeliver"
  | "forEmployees"
  | "productsAndServicesSold";

export type PortfolioScope = "absent" | "minimal" | "standard" | "primary";

export type It4ItStage =
  | "strategy-to-portfolio"
  | "requirement-to-deploy"
  | "request-to-fulfill"
  | "detect-to-correct"
  | "deploy-to-operate";

export interface PortfolioProfile {
  scope: PortfolioScope;
  it4itStages?: It4ItStage[];
  offerings?: string[];
}

export type PortfolioDecomposition = Record<PortfolioRole, PortfolioProfile>;

export type CapabilityApplicability =
  | "required"
  | "recommended"
  | "optional"
  | "hidden"
  | "not-applicable";

export type OwnershipScope =
  | "organization"
  | "customer-account"
  | "customer-site"
  | "configuration-item"
  | "edge-node"
  | "partner-account";

export type TransactionContext =
  | "service-agreement"
  | "engagement"
  | "appointment"
  | "order"
  | "billing-period"
  | "episode-of-care";

export type CapabilityIsolation =
  | "organization-scope"
  | "strict-customer-scope"
  | "shared"
  | "strict-partner-scope";

export type PaymentPattern =
  | "point-of-sale"
  | "appointment-checkout"
  | "ad-hoc-invoice"
  | "recurring-agreement"
  | "subscription"
  | "retainer"
  | "project-milestone"
  | "usage-based"
  | "donation"
  | "optional-package";

export type InvoiceExecutionMode = "none" | "manual" | "prepared-not-prescribed" | "automated";

/**
 * Where a {@link PrimaryAction} is invoked from in the UI. Drives which actions
 * the {@link CapabilityActivation} contributes to a given surface (map pin
 * click, list-row click, multi-select toolbar, detail page).
 */
export type PrimaryActionSurface = "map-pin" | "list-row" | "selection" | "detail-page";

/**
 * Declares an action that a capability contributes to a UI surface, so map-pin
 * click / list-row click / etc. semantics are capability-driven rather than
 * hard-coded per archetype. Resolution happens via
 * `apps/web/lib/customer-surface/pin-actions.ts` (or equivalent host helpers);
 * see `docs/superpowers/specs/2026-05-22-customer-surface-archetype-activation-design.md`
 * §11.
 */
export interface PrimaryAction {
  /** Stable id, e.g. "open-customer-detail", "dispatch-tech", "log-violation". */
  id: string;
  /** Verb label for the action button, e.g. "Open", "Dispatch", "Log violation". */
  label: string;
  /** Which UI scope this action fires from. */
  surface: PrimaryActionSurface;
  /** Whether this is the default action (e.g. single-click on map pin). */
  isDefault?: boolean;
}

export interface CapabilityActivation {
  capabilityKey: string;
  applicability: CapabilityApplicability;
  ownershipScopes: OwnershipScope[];
  transactionContexts?: TransactionContext[];
  isolation: CapabilityIsolation;
  surfaces: string[];
  /**
   * Actions this capability contributes to UI surfaces. Optional for backward
   * compatibility — existing capabilities without action declarations behave
   * exactly as before.
   */
  primaryActions?: PrimaryAction[];
  sourceRules: string[];
  reason?: string;
  overrideReason?: string;
}

export interface CapabilityOverride {
  capabilityKey: string;
  applicability: CapabilityApplicability;
  ownershipScopes?: OwnershipScope[];
  transactionContexts?: TransactionContext[];
  isolation?: CapabilityIsolation;
  surfaces?: string[];
  primaryActions?: PrimaryAction[];
  reason: string;
}

export interface BillingPatternProfile {
  primaryPaymentPattern: PaymentPattern;
  supportedPaymentPatterns: PaymentPattern[];
  invoiceExecutionMode: InvoiceExecutionMode;
  recurringBillingApplicability: Exclude<CapabilityApplicability, "hidden">;
}

/**
 * Channel-partner / reseller archetypes. Names follow the established
 * Partner Relationship Management (PRM) taxonomy so the platform classification
 * stays aligned with how the channel-sales industry already segments partners
 * (see docs/superpowers/specs/2026-06-04-partner-reseller-archetype-identity-design.md §3).
 *
 * - `referral` / `affiliate`: introduce or market leads; paid on close, never take title.
 * - `reseller`: buys-to-resell / value-added reseller (VAR); transacts under their own paper.
 * - `distributor`: sells to downstream resellers; needs tiered access and inventory visibility.
 * - `managed-service-provider`: delivers and resells the offer under their own brand.
 * - `technology`: ISV / integration / alliance partner; co-built or co-marketed solutions.
 * - `franchise`: operates the brand under a licensed territory.
 * - `agent-broker`: sells on commission without taking title to goods or contracts.
 */
export type PartnerType =
  | "referral"
  | "affiliate"
  | "reseller"
  | "distributor"
  | "managed-service-provider"
  | "technology"
  | "franchise"
  | "agent-broker";

/**
 * Partner program tier ladder. Empty tier list means a flat, untiered program.
 * Tier governs deal-registration priority, margin, and portal entitlements.
 */
export type PartnerTier =
  | "registered"
  | "authorized"
  | "silver"
  | "gold"
  | "platinum";

/**
 * How prominent the partner channel is for this archetype.
 * - `none`: no partner channel; the partner portal route stays hidden.
 * - `available`: partner channel runs alongside direct sales (platform/SaaS, MSP, wholesale).
 * - `primary`: the business sells *through* partners as its main go-to-market motion.
 */
export type PartnerPortalMode = "none" | "available" | "primary";

/**
 * Whether partners get an isolated downstream projection of their own
 * sub-customers / managed estate, mirroring {@link CustomerGraphMode} for the
 * customer side. `separate-partner-projection` means a partner's records are
 * scoped to the partner account under strict isolation.
 */
export type PartnerGraphMode = "none" | "separate-partner-projection";

/**
 * An organization's stored decision about an offered (recommended/optional)
 * capability. This is the *persisted opt-in overlay* that sits on top of the
 * derived {@link CapabilityApplicability}: the derivation answers "is this
 * applicable to the business model?"; the choice answers "did this org turn it
 * on?". Captured at setup when a capability is `recommended`, and editable later
 * from admin (the "add it later" path). Resolution lives in
 * `resolveCapabilityActivation` (capability-activation.ts).
 */
export type CapabilityActivationChoice = "enabled" | "disabled";

/**
 * The partner/reseller operating model an archetype activates. Derived from the
 * {@link OperatingModelAxes} (platform, primaryConsumer, form, commercialModel)
 * the same way {@link BillingPatternProfile} is derived from `commercialModel`,
 * so adding partner support to an archetype is a function of its axis values —
 * not a hand-authored per-archetype flag.
 */
export interface PartnerProgramProfile {
  portalMode: PartnerPortalMode;
  partnerTypes: PartnerType[];
  tiers: PartnerTier[];
  /** Deal-registration / channel-conflict protection applies. */
  dealRegistration: boolean;
  partnerGraph: PartnerGraphMode;
}

export interface SeededConfigurationItemType {
  key: string;
  label: string;
  technologySourceType: TechnologySourceType;
  defaultReviewCadenceDays?: number;
  supportsLicensing?: boolean;
  defaultChargeModel?: string;
}

export interface SeededBillingUnitType {
  key: string;
  label: string;
}

export interface SeededChargeModel {
  key: string;
  label: string;
}

export type CatalogMode = "priced" | "donation" | "unpriced";

export interface ResourceKindProfile {
  kindSlug: string;
  capacityUnit: string;
  maxCapacity: number;
}

export interface ArchetypeValueStreamStageProfile {
  key: string;
  label: string;
  input: string;
  output: string;
  responsibleRole: string;
  trustGateKeys: string[];
  /** Explicit cross-stream or return handoff. In-stream sequence is implied by order. */
  handoffTo?: string;
  capabilityBindings?: ArchetypeModule[];
  metricBindings?: string[];
}

export interface ArchetypeValueStreamProfile {
  key: string;
  label: string;
  purpose: string;
  input: string;
  output: string;
  responsibleRole: string;
  loadBearingStageKeys: string[];
  stages: ArchetypeValueStreamStageProfile[];
}

/**
 * Operational semantics that accompany an archetype without leaking into its
 * presentation vocabulary. Subject and resource slugs stay open for future
 * verticals, while the activation-profile reader owns their validation.
 */
export interface ArchetypeProcessProfile {
  catalogModes: CatalogMode[];
  subjectTypes: string[];
  housesSubjects: boolean;
  schedulesSubjects: boolean;
  resourceKinds: ResourceKindProfile[];
  /** Leaf-specific operating flows. Omit to use the shared commercial backbone. */
  valueStreams?: ArchetypeValueStreamProfile[];
  /** Supporting work that enables, but must not replace, the subject's primary flow. */
  supportingCapabilities?: string[];
}

export interface ActivationProfile {
  profileType: ArchetypeProfileType;
  modules: ArchetypeModule[];
  billingReadinessMode: BillingReadinessMode;
  customerGraph: CustomerGraphMode;
  estateSeparation: EstateSeparationMode;
  axes?: OperatingModelAxes;
  portfolios?: PortfolioDecomposition;
  capabilityOverrides?: CapabilityOverride[];
  billingProfile?: BillingPatternProfile;
  seededServiceCategories?: string[];
  seededConfigurationItemTypes?: SeededConfigurationItemType[];
  seededBillingUnitTypes?: SeededBillingUnitType[];
  seededChargeModels?: SeededChargeModel[];
  processProfile?: ArchetypeProcessProfile;
}

/**
 * Leaf-level vocabulary override, seeded into `StorefrontArchetype.customVocabulary`
 * and merged over the category vocabulary by `applyCustomVocabulary`
 * (apps/web/lib/storefront/archetype-vocabulary.ts). Lets one leaf diverge from
 * its category's labels — e.g. credit-union "Members" over the banking
 * category's "Customers" — without a parallel resolution path.
 */
export interface ArchetypeVocabularyOverride {
  itemsLabel?: string;
  singleItemLabel?: string;
  addButtonLabel?: string;
  categoryLabel?: string;
  priceLabel?: string;
  portalLabel?: string;
  stakeholderLabel?: string;
  teamLabel?: string;
  inboxLabel?: string;
  agentName?: string;
}

/**
 * A business-facing product seed. This describes what the organization sells;
 * it is deliberately separate from DigitalProduct architecture and storefront
 * pricing/offer contracts.
 */
export interface BusinessProductTemplate {
  key: string;
  label: string;
  description?: string;
}

/**
 * One organization-owned product line suggested during setup. `archetypeId`
 * links an optional adjacent line to the existing storefront composition
 * substrate; custom lines may omit it.
 */
export interface ProductLineTemplate {
  key: string;
  label: string;
  description?: string;
  archetypeId?: string;
  products: BusinessProductTemplate[];
}

export interface ProductMixDefinition {
  primary: ProductLineTemplate;
  adjacent?: ProductLineTemplate[];
}

export interface ArchetypeDefinition {
  archetypeId: string;
  name: string;
  category: ArchetypeCategory;
  ctaType: CtaType;
  itemTemplates: ItemTemplate[];
  sectionTemplates: SectionTemplate[];
  formSchema: FormField[];
  tags: string[];
  schedulingDefaults?: SchedulingDefaults;
  activationProfile?: ActivationProfile;
  /**
   * Optional business product-line defaults. Checked-in definitions seed the
   * live StorefrontArchetype record, which remains the setup-time read
   * authority. Absence resolves to one primary line from this archetype.
   */
  productMix?: ProductMixDefinition;
  /**
   * Per-leaf vocabulary overrides, seeded into
   * `StorefrontArchetype.customVocabulary` and read by `getVocabulary()` —
   * the mechanism the BIAN banking spec §7.4 decided (credit-union "Members"
   * vs bank "Customers"); civic spec §8 uses it for Ratepayers/Community.
   * Typed against the `ArchetypeVocabulary` fields so a misspelled key fails
   * typecheck instead of being silently ignored at merge time.
   */
  vocabulary?: ArchetypeVocabularyOverride;
  /**
   * Optional override of the derived {@link MediaProfile}. Almost always left
   * unset — `deriveMediaProfile` (media-profile.ts) produces a sensible profile
   * from this archetype's sections/ctaType/category/axes. Set only if a leaf has
   * a genuine image-affordance exception the derivation can't express.
   */
  mediaProfile?: MediaProfile;
  /**
   * Optional override of the derived field-dispatch profile. Left unset for the
   * common case — `deriveFieldDispatchProfile` (field-dispatch.ts) derives
   * applicability and a sensible profile from this archetype's axes. Set
   * `fieldDispatch.enabled` to force dispatch on/off against the axis
   * derivation, or supply partial fields to specialize the vertical (resource
   * noun, compliance overlay, inventory model, vocabulary). See
   * docs/superpowers/specs/2026-06-13-field-dispatch-capability-design.md ADR-4.
   */
  fieldDispatch?: FieldDispatchProfileOverride;
  /**
   * Optional override of the derived operational-twin configuration. Left unset
   * for the common case — `deriveTwinProfile` (twin-profile.ts) picks the
   * template and binds its nouns from this archetype's axes, scheduling,
   * field-dispatch profile, and category. Set only for a genuine exception the
   * derivation cannot express (the ADR-4 escape hatch, mirroring `fieldDispatch`
   * / `mediaProfile`). See
   * docs/superpowers/specs/2026-07-12-operational-twin-framework-design.md §5.
   */
  twinProfile?: TwinProfileOverride;
}
