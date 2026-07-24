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
  // ─── Tier-1 shared connector catalog (BI-96BFA984, P3) ────────────────────
  // Closes the Tier-1 readiness gap (design §6.1 / §7): the absorption matrix
  // classifies these shared categories, but the portfolio "potential"
  // projection and the BI-PSC-002 connector kernel had no targets for the ones
  // the original 12 left uncovered — calendar/scheduling, transactional
  // messaging (SMS/email), documents, inventory. These are the highest-leverage
  // connectors (recur across ≥5 verticals). No overlap with the entries above.
  // Payments (Stripe✓), accounting (QuickBooks/Xero✓), CRM (HubSpot/Salesforce✓)
  // are already covered; these fill the remaining Tier-1 categories.
  {
    slug: "square",
    name: "Square",
    description: "Payments — card processing, POS, and payouts.",
    portfolioSlug: "for_employees",
    pricingModel: "freemium",
    credentialProvider: "square",
  },
  {
    slug: "paypal",
    name: "PayPal",
    description: "Payments and online checkout.",
    portfolioSlug: "for_employees",
    pricingModel: "freemium",
    credentialProvider: "paypal",
  },
  {
    slug: "calendly",
    name: "Calendly",
    description: "Scheduling / calendar booking — availability and appointments.",
    portfolioSlug: "for_employees",
    pricingModel: "freemium",
    credentialProvider: "calendly",
  },
  {
    slug: "cal-com",
    name: "Cal.com",
    description: "Open scheduling / calendar booking infrastructure.",
    portfolioSlug: "for_employees",
    pricingModel: "freemium",
    credentialProvider: "cal_com",
  },
  {
    slug: "acuity-scheduling",
    name: "Acuity Scheduling",
    description: "Appointment scheduling and calendar management.",
    portfolioSlug: "for_employees",
    pricingModel: "paid",
    credentialProvider: "acuity",
  },
  {
    slug: "twilio",
    name: "Twilio",
    description: "Programmable messaging — transactional SMS and voice.",
    portfolioSlug: "for_employees",
    pricingModel: "paid",
    credentialProvider: "twilio",
  },
  {
    slug: "sendgrid",
    name: "SendGrid",
    description: "Transactional and marketing email delivery.",
    portfolioSlug: "for_employees",
    pricingModel: "freemium",
    credentialProvider: "sendgrid",
  },
  {
    slug: "mailgun",
    name: "Mailgun",
    description: "Transactional email delivery API.",
    portfolioSlug: "for_employees",
    pricingModel: "freemium",
    credentialProvider: "mailgun",
  },
  {
    slug: "docusign",
    name: "DocuSign",
    description: "Documents — e-signature and agreement workflows.",
    portfolioSlug: "for_employees",
    pricingModel: "paid",
    credentialProvider: "docusign",
  },
  {
    slug: "dropbox",
    name: "Dropbox",
    description: "Documents — file storage and sharing.",
    portfolioSlug: "for_employees",
    pricingModel: "freemium",
    credentialProvider: "dropbox",
  },
  {
    slug: "box",
    name: "Box",
    description: "Documents — content management and secure file sharing.",
    portfolioSlug: "for_employees",
    pricingModel: "paid",
    credentialProvider: "box",
  },
  {
    slug: "zoho-inventory",
    name: "Zoho Inventory",
    description: "Inventory — stock, order, and warehouse management.",
    portfolioSlug: "manufacturing_and_delivery",
    pricingModel: "freemium",
    credentialProvider: "zoho_inventory",
  },
  {
    slug: "fishbowl",
    name: "Fishbowl Inventory",
    description: "Inventory and manufacturing / warehouse management.",
    portfolioSlug: "manufacturing_and_delivery",
    pricingModel: "paid",
    credentialProvider: "fishbowl",
  },
];
