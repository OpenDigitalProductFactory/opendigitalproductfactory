export type CtaType = "booking" | "purchase" | "inquiry" | "donation";

export type PriceType =
  | "fixed" | "from" | "per-hour" | "per-session"
  | "free" | "donation" | "quote";

export type SectionType =
  | "hero" | "about" | "items" | "team" | "gallery"
  | "contact" | "testimonials" | "donate"
  | "animals-available" | "custom";

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
  | "hoa-property-management";

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
  bookingDurationMinutes?: number;
}

export interface SectionTemplate {
  type: SectionType;
  title: string;
  sortOrder: number;
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
  | "integrations";

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
  | "internal";

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
  | "hybrid";

export type ProvisioningModel =
  | "none"
  | "account-with-billing"
  | "account-and-entitlement"
  | "account-with-kyc"
  | "device-bound"
  | "episode-of-care";

export type PlatformEcosystem = "no" | "yes-marketplace" | "yes-developer";

export interface OperatingModelAxes {
  form: OperatingModelForm;
  delivery: OperatingModelDelivery;
  primaryConsumer: PrimaryConsumer;
  consumptionChannel: ConsumptionChannel;
  commercialModel: CommercialModel;
  provisioning: ProvisioningModel;
  platform: PlatformEcosystem;
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
}
