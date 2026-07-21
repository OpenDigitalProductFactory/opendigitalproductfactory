import type {
  CapabilityIsolation,
  It4ItStage,
  OwnershipScope,
  PortfolioRole,
} from "./types";

/**
 * Operator-facing copy for the setup-wizard / admin opt-in question, for
 * capabilities that should *ask* the operator whether to activate (i.e. those
 * that derive to `recommended` — see `resolveCapabilityActivation`). Capabilities
 * with no `setupPrompt` are not surfaced as a setup question. Default microcopy
 * lives here next to the capability; localization/overrides can layer on later.
 */
export interface CapabilitySetupPrompt {
  question: string;
  helpText?: string;
}

export interface CapabilityRegistryEntry {
  label: string;
  portfolio: PortfolioRole;
  it4itStage?: It4ItStage;
  defaultOwnershipScope: OwnershipScope;
  defaultIsolation: CapabilityIsolation;
  surfaces: string[];
  setupPrompt?: CapabilitySetupPrompt;
}

export const CAPABILITY_REGISTRY = {
  "customer-accounts": {
    label: "Customer Accounts",
    portfolio: "productsAndServicesSold",
    defaultOwnershipScope: "customer-account",
    defaultIsolation: "organization-scope",
    surfaces: ["customers"],
  },
  "customer-sites": {
    label: "Customer Sites",
    portfolio: "productsAndServicesSold",
    defaultOwnershipScope: "customer-site",
    defaultIsolation: "strict-customer-scope",
    surfaces: ["customers", "sites"],
  },
  "customer-estate": {
    label: "Customer Estate",
    portfolio: "manufactureAndDeliver",
    it4itStage: "detect-to-correct",
    defaultOwnershipScope: "customer-account",
    defaultIsolation: "strict-customer-scope",
    surfaces: ["customers", "customer-estate"],
  },
  "edge-node-customer-deployment": {
    label: "Edge Node Customer Deployment",
    portfolio: "manufactureAndDeliver",
    it4itStage: "detect-to-correct",
    defaultOwnershipScope: "edge-node",
    defaultIsolation: "strict-customer-scope",
    surfaces: ["edge-nodes", "customer-estate"],
  },
  "network-inventory": {
    label: "Network Inventory",
    portfolio: "manufactureAndDeliver",
    it4itStage: "detect-to-correct",
    defaultOwnershipScope: "customer-site",
    defaultIsolation: "strict-customer-scope",
    surfaces: ["customer-estate", "network"],
  },
  "cybersecurity-posture": {
    label: "Cybersecurity Posture",
    portfolio: "manufactureAndDeliver",
    it4itStage: "detect-to-correct",
    defaultOwnershipScope: "customer-account",
    defaultIsolation: "strict-customer-scope",
    surfaces: ["security", "customer-estate"],
  },
  "backup-restore-posture": {
    label: "Backup And Restore Posture",
    portfolio: "manufactureAndDeliver",
    it4itStage: "detect-to-correct",
    defaultOwnershipScope: "customer-account",
    defaultIsolation: "strict-customer-scope",
    surfaces: ["backup", "customer-estate"],
  },
  "service-agreements": {
    label: "Service Agreements",
    portfolio: "productsAndServicesSold",
    defaultOwnershipScope: "customer-account",
    defaultIsolation: "strict-customer-scope",
    surfaces: ["agreements", "customers"],
  },
  "recurring-agreement-billing": {
    label: "Recurring Agreement Billing",
    portfolio: "productsAndServicesSold",
    defaultOwnershipScope: "customer-account",
    defaultIsolation: "strict-customer-scope",
    surfaces: ["finance", "billing-readiness"],
  },
  "billing-readiness": {
    label: "Billing Readiness",
    portfolio: "productsAndServicesSold",
    defaultOwnershipScope: "customer-account",
    defaultIsolation: "strict-customer-scope",
    surfaces: ["finance", "billing-readiness"],
  },
  "appointment-checkout": {
    label: "Appointment Checkout",
    portfolio: "productsAndServicesSold",
    defaultOwnershipScope: "organization",
    defaultIsolation: "organization-scope",
    surfaces: ["storefront", "booking", "checkout"],
  },
  "point-of-sale": {
    label: "Point Of Sale",
    portfolio: "productsAndServicesSold",
    defaultOwnershipScope: "organization",
    defaultIsolation: "organization-scope",
    surfaces: ["checkout", "payments"],
  },
  "project-work": {
    label: "Project Work",
    portfolio: "manufactureAndDeliver",
    it4itStage: "request-to-fulfill",
    defaultOwnershipScope: "customer-account",
    defaultIsolation: "strict-customer-scope",
    surfaces: ["projects", "customers"],
  },
  "lifecycle-review-queues": {
    label: "Lifecycle Review Queues",
    portfolio: "manufactureAndDeliver",
    it4itStage: "detect-to-correct",
    defaultOwnershipScope: "customer-account",
    defaultIsolation: "strict-customer-scope",
    surfaces: ["lifecycle-reviews", "customer-estate"],
  },
  "remote-support": {
    label: "Remote Support",
    portfolio: "manufactureAndDeliver",
    it4itStage: "detect-to-correct",
    defaultOwnershipScope: "customer-account",
    defaultIsolation: "strict-customer-scope",
    surfaces: ["remote-support", "customers"],
  },
  "partner-program": {
    label: "Partner Program",
    portfolio: "productsAndServicesSold",
    defaultOwnershipScope: "partner-account",
    defaultIsolation: "strict-partner-scope",
    surfaces: ["partners", "partner-portal"],
    setupPrompt: {
      question: "Do you sell through partners or resellers?",
      helpText:
        "Turns on a partner portal, deal registration, and partner tiers for resellers, distributors, or referral partners. You can add this later.",
    },
  },
  // Civic & member-governed capabilities — gated by the governance axis and the
  // member/resident primaryConsumer values (spec: 2026-06-09 civic archetypes §6.1).
  "member-governance": {
    label: "Member Governance",
    portfolio: "forEmployees",
    defaultOwnershipScope: "organization",
    defaultIsolation: "organization-scope",
    surfaces: ["governance", "meetings"],
  },
  "membership-eligibility": {
    label: "Membership Eligibility",
    portfolio: "productsAndServicesSold",
    defaultOwnershipScope: "organization",
    defaultIsolation: "organization-scope",
    surfaces: ["customers", "membership"],
  },
  "member-equity": {
    label: "Member Equity & Patronage",
    portfolio: "productsAndServicesSold",
    defaultOwnershipScope: "customer-account",
    defaultIsolation: "organization-scope",
    surfaces: ["finance", "membership"],
    setupPrompt: {
      question: "Do members hold equity or receive patronage allocations?",
      helpText:
        "Turns on per-member equity records, year-end patronage allocation, and equity retirement schedules. Common for cooperatives; you can add this later.",
    },
  },
  "public-body-governance": {
    label: "Public-Body Governance",
    portfolio: "forEmployees",
    defaultOwnershipScope: "organization",
    defaultIsolation: "organization-scope",
    surfaces: ["governance", "meetings"],
  },
  "records-request": {
    label: "Records Requests",
    portfolio: "manufactureAndDeliver",
    it4itStage: "request-to-fulfill",
    defaultOwnershipScope: "organization",
    defaultIsolation: "organization-scope",
    surfaces: ["records-requests"],
  },
  "service-request-311": {
    label: "Service Requests (311)",
    portfolio: "manufactureAndDeliver",
    it4itStage: "request-to-fulfill",
    defaultOwnershipScope: "organization",
    defaultIsolation: "organization-scope",
    surfaces: ["service-requests"],
  },
  // Rental / shared-asset capabilities — gated by the reservation-and-return
  // provisioning model (asset-rental archetypes; value-stream doc §10.1).
  "rental-fleet": {
    label: "Rental Fleet & Asset Pool",
    portfolio: "productsAndServicesSold",
    defaultOwnershipScope: "organization",
    defaultIsolation: "organization-scope",
    surfaces: ["rental", "fleet"],
  },
  "rental-agreements": {
    label: "Rental Agreements & Returns",
    portfolio: "manufactureAndDeliver",
    it4itStage: "request-to-fulfill",
    defaultOwnershipScope: "organization",
    defaultIsolation: "organization-scope",
    surfaces: ["rental", "agreements"],
  },
  "asset-pool": {
    label: "Asset-Pool Capacity & Utilization",
    portfolio: "manufactureAndDeliver",
    it4itStage: "detect-to-correct",
    defaultOwnershipScope: "organization",
    defaultIsolation: "organization-scope",
    surfaces: ["rental", "utilization"],
  },
  // Goods-custody capabilities — gated by the custody-and-fulfilment
  // provisioning model (warehousing-fulfilment archetypes; design doc
  // 2026-07-21). The stock belongs to the customer, so the ledger and the
  // handling record are both strictly customer-scoped: one client's stock must
  // never be visible in another's, which is the multi-client tenancy a 3PL WMS
  // is defined by.
  "goods-custody": {
    label: "Goods Custody & Stock Ledger",
    portfolio: "manufactureAndDeliver",
    it4itStage: "detect-to-correct",
    defaultOwnershipScope: "customer-account",
    defaultIsolation: "strict-customer-scope",
    surfaces: ["warehouse", "inventory"],
  },
  "warehouse-operations": {
    label: "Warehouse Operations",
    portfolio: "manufactureAndDeliver",
    it4itStage: "request-to-fulfill",
    defaultOwnershipScope: "organization",
    defaultIsolation: "organization-scope",
    surfaces: ["warehouse", "operations"],
  },
  "storage-and-handling-billing": {
    label: "Storage & Handling Billing",
    portfolio: "productsAndServicesSold",
    defaultOwnershipScope: "customer-account",
    defaultIsolation: "strict-customer-scope",
    surfaces: ["finance", "billing-readiness", "warehouse"],
    setupPrompt: {
      question: "Do you bill storage separately from handling?",
      helpText:
        "Turns on a rate card with two meters — storage rent per pallet or bin per period, and handling per receipt, pick, or order — plus monthly minimums and accessorial charges. Fulfilment-only operators who bill per order can leave this off and add it later.",
    },
  },
} as const satisfies Record<string, CapabilityRegistryEntry>;

export type CapabilityKey = keyof typeof CAPABILITY_REGISTRY;

export const CAPABILITY_KEYS = Object.keys(CAPABILITY_REGISTRY) as CapabilityKey[];

export function isCapabilityKey(value: string): value is CapabilityKey {
  return Object.prototype.hasOwnProperty.call(CAPABILITY_REGISTRY, value);
}

/**
 * Returns the setup-wizard opt-in prompt for a capability, or `null` if the
 * capability is not surfaced as a setup question. The wizard should only ask
 * for capabilities whose resolved activation has `promptAtSetup === true`
 * (see `resolveCapabilityActivation`) *and* that declare a `setupPrompt`.
 */
export function getCapabilitySetupPrompt(
  capabilityKey: CapabilityKey | string,
): CapabilitySetupPrompt | null {
  if (!isCapabilityKey(capabilityKey)) return null;
  const entry: CapabilityRegistryEntry = CAPABILITY_REGISTRY[capabilityKey];
  return entry.setupPrompt ?? null;
}
