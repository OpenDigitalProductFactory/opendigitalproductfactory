import type {
  CapabilityIsolation,
  It4ItStage,
  OwnershipScope,
  PortfolioRole,
} from "./types";

export interface CapabilityRegistryEntry {
  label: string;
  portfolio: PortfolioRole;
  it4itStage?: It4ItStage;
  defaultOwnershipScope: OwnershipScope;
  defaultIsolation: CapabilityIsolation;
  surfaces: string[];
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
} as const satisfies Record<string, CapabilityRegistryEntry>;

export type CapabilityKey = keyof typeof CAPABILITY_REGISTRY;

export const CAPABILITY_KEYS = Object.keys(CAPABILITY_REGISTRY) as CapabilityKey[];

export function isCapabilityKey(value: string): value is CapabilityKey {
  return Object.prototype.hasOwnProperty.call(CAPABILITY_REGISTRY, value);
}
