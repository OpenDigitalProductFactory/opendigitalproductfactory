// Curated catalog of business integrations the platform supports (BI-PORTCOV-P2;
// spec §4.4.2). The McpIntegration marketplace is empty on a fresh install, so
// the truthful source of "what can this business turn on?" is the set of
// integrations DPF actually has adapters for. Each is projected as a portfolio
// entry: coverage `potential` by default (catalogued, one governed click to
// enable), `available` once an IntegrationCredential row exists, `used` once it
// is connected. Routed to a portfolio by its business domain.
//
// productIds are "int-*" so they never collide with "cap-*"/"prov-*"/registry rows.

import type { PortfolioSlug } from "./types";

export interface SupportedIntegration {
  slug: string;
  name: string;
  description: string;
  /** Portfolio this integration belongs in (routed by its business domain). */
  portfolioSlug: PortfolioSlug;
  pricingModel: "free" | "freemium" | "paid";
  /** IntegrationCredential.provider key checked for a live connection. */
  credentialProvider: string;
}

export const SUPPORTED_INTEGRATIONS: readonly SupportedIntegration[] = [
  // Financial management & payments → For Employees (internal business apps).
  {
    slug: "quickbooks",
    name: "QuickBooks Online",
    description: "Accounting & financial management — invoices, expenses, reconciliation.",
    portfolioSlug: "for_employees",
    pricingModel: "paid",
    credentialProvider: "quickbooks",
  },
  {
    slug: "xero",
    name: "Xero",
    description: "Cloud accounting & bookkeeping.",
    portfolioSlug: "for_employees",
    pricingModel: "paid",
    credentialProvider: "xero",
  },
  {
    slug: "stripe",
    name: "Stripe",
    description: "Payments, billing, and subscription processing.",
    portfolioSlug: "for_employees",
    pricingModel: "paid",
    credentialProvider: "stripe",
  },
  // HR / payroll → For Employees.
  {
    slug: "adp",
    name: "ADP Workforce Now",
    description: "Payroll and HR / workforce administration.",
    portfolioSlug: "for_employees",
    pricingModel: "paid",
    credentialProvider: "adp",
  },
  // CRM / sales → For Employees.
  {
    slug: "hubspot",
    name: "HubSpot",
    description: "CRM, marketing, and sales pipeline.",
    portfolioSlug: "for_employees",
    pricingModel: "freemium",
    credentialProvider: "hubspot",
  },
  {
    slug: "salesforce",
    name: "Salesforce",
    description: "Enterprise CRM and sales automation.",
    portfolioSlug: "for_employees",
    pricingModel: "paid",
    credentialProvider: "salesforce",
  },
  // Collaboration / work management → For Employees.
  {
    slug: "slack",
    name: "Slack",
    description: "Team messaging and collaboration.",
    portfolioSlug: "for_employees",
    pricingModel: "freemium",
    credentialProvider: "slack",
  },
  {
    slug: "jira",
    name: "Jira",
    description: "Project & work management / issue tracking.",
    portfolioSlug: "for_employees",
    pricingModel: "paid",
    credentialProvider: "jira",
  },
  // Identity / cloud / security → Foundational.
  {
    slug: "microsoft-365",
    name: "Microsoft 365",
    description: "Identity, email, and productivity (Entra, Outlook, Teams).",
    portfolioSlug: "foundational",
    pricingModel: "paid",
    credentialProvider: "microsoft365",
  },
  {
    slug: "google-workspace",
    name: "Google Workspace",
    description: "Identity, email, and productivity (Gmail, Drive, Admin).",
    portfolioSlug: "foundational",
    pricingModel: "paid",
    credentialProvider: "google_workspace",
  },
  // Service desk / RMM → Manufacturing & Delivery.
  {
    slug: "zendesk",
    name: "Zendesk",
    description: "Customer service / ticketing and support delivery.",
    portfolioSlug: "manufacturing_and_delivery",
    pricingModel: "paid",
    credentialProvider: "zendesk",
  },
  {
    slug: "ninjaone",
    name: "NinjaOne",
    description: "RMM / endpoint & device management for estate delivery.",
    portfolioSlug: "manufacturing_and_delivery",
    pricingModel: "paid",
    credentialProvider: "ninjaone",
  },
];
