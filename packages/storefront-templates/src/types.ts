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
  | "edge-node";

export type TransactionContext =
  | "service-agreement"
  | "engagement"
  | "appointment"
  | "order"
  | "billing-period"
  | "episode-of-care";

export type CapabilityIsolation = "organization-scope" | "strict-customer-scope" | "shared";

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

export interface CapabilityActivation {
  capabilityKey: string;
  applicability: CapabilityApplicability;
  ownershipScopes: OwnershipScope[];
  transactionContexts?: TransactionContext[];
  isolation: CapabilityIsolation;
  surfaces: string[];
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
  reason: string;
}

export interface BillingPatternProfile {
  primaryPaymentPattern: PaymentPattern;
  supportedPaymentPatterns: PaymentPattern[];
  invoiceExecutionMode: InvoiceExecutionMode;
  recurringBillingApplicability: Exclude<CapabilityApplicability, "hidden">;
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
