export type NativeIntegrationId =
  | "adp"
  | "quickbooks"
  | "stripe"
  | "microsoft365"
  | "hubspot"
  | "google"
  | "facebook"
  | "mailchimp";

export type NativeIntegrationDescriptor = {
  id: NativeIntegrationId;
  integrationId: string;
  provider: NativeIntegrationId;
  name: string;
  description: string;
  href: string;
  category: string;
  pricingModel: "paid";
  model: "native";
  tags: string[];
  enables: string[];
  relevantAgentIds: string[];
  requiredGrantKeys: string[];
};

export const NATIVE_INTEGRATIONS: NativeIntegrationDescriptor[] = [
  {
    id: "adp",
    integrationId: "adp-workforce-now",
    provider: "adp",
    name: "ADP Workforce Now",
    description: "Payroll and workforce anchor using the dedicated ADP runtime and enterprise credential custody.",
    href: "/platform/tools/integrations/adp",
    category: "hr",
    pricingModel: "paid",
    model: "native",
    tags: ["hr", "payroll", "workforce", "workers", "pay statements"],
    enables: ["Worker lookup", "Pay statement context", "Time card context", "Deduction questions", "Payroll guidance"],
    relevantAgentIds: ["finance-controller", "hr-specialist", "coo"],
    requiredGrantKeys: ["consumer_read"],
  },
  {
    id: "quickbooks",
    integrationId: "quickbooks-online-accounting",
    provider: "quickbooks",
    name: "QuickBooks Online",
    description: "Finance anchor for company, customer, and invoice context on the native integration substrate.",
    href: "/platform/tools/integrations/quickbooks",
    category: "finance",
    pricingModel: "paid",
    model: "native",
    tags: ["finance", "accounting", "invoices", "customers", "ledger"],
    enables: ["Company context", "Customer context", "Invoice context", "Accounting previews"],
    relevantAgentIds: ["finance-controller", "coo"],
    requiredGrantKeys: ["registry_read"],
  },
  {
    id: "stripe",
    integrationId: "stripe-billing-payments",
    provider: "stripe",
    name: "Stripe Billing & Payments",
    description: "Payments anchor for balance, customer, invoice, and payment-intent context on the enterprise substrate.",
    href: "/platform/tools/integrations/stripe",
    category: "payments",
    pricingModel: "paid",
    model: "native",
    tags: ["payments", "billing", "stripe", "invoices"],
    enables: ["Payment balance context", "Customer payment context", "Payment-intent context"],
    relevantAgentIds: ["finance-controller", "customer-advisor", "coo"],
    requiredGrantKeys: ["registry_read"],
  },
  {
    id: "microsoft365",
    integrationId: "microsoft365-communications",
    provider: "microsoft365",
    name: "Microsoft 365 Communications",
    description: "Communications anchor for inbox, calendar, Teams, channels, and recent message context.",
    href: "/platform/tools/integrations/microsoft365-communications",
    category: "communications",
    pricingModel: "paid",
    model: "native",
    tags: ["email", "calendar", "teams", "communications"],
    enables: ["Inbox context", "Calendar context", "Teams context", "Channel context"],
    relevantAgentIds: ["admin-assistant", "coo", "ops-coordinator"],
    requiredGrantKeys: ["registry_read"],
  },
  {
    id: "hubspot",
    integrationId: "hubspot-crm-marketing",
    provider: "hubspot",
    name: "HubSpot CRM & Marketing",
    description: "Marketing and CRM anchor for account details, contacts, and lead-capture forms.",
    href: "/platform/tools/integrations/hubspot",
    category: "marketing",
    pricingModel: "paid",
    model: "native",
    tags: ["crm", "marketing", "contacts", "leads"],
    enables: ["Account context", "Contact context", "Lead form context"],
    relevantAgentIds: ["customer-advisor", "coo"],
    requiredGrantKeys: ["marketing_read"],
  },
  {
    id: "google",
    integrationId: "google-marketing-intelligence",
    provider: "google",
    name: "Google Marketing Intelligence",
    description: "Read-first GA4 and Search Console anchor for traffic, conversions, and search visibility.",
    href: "/platform/tools/integrations/google-marketing-intelligence",
    category: "marketing-intelligence",
    pricingModel: "paid",
    model: "native",
    tags: ["google", "analytics", "search console", "traffic"],
    enables: ["Traffic context", "Conversion context", "Search visibility context"],
    relevantAgentIds: ["customer-advisor", "coo"],
    requiredGrantKeys: ["marketing_read"],
  },
  {
    id: "facebook",
    integrationId: "facebook-lead-ads",
    provider: "facebook",
    name: "Facebook Lead Ads",
    description: "Localized lead-capture anchor for page forms, recent submissions, and downstream CRM follow-up.",
    href: "/platform/tools/integrations/facebook-lead-ads",
    category: "lead-capture",
    pricingModel: "paid",
    model: "native",
    tags: ["facebook", "lead ads", "leads", "forms"],
    enables: ["Lead form context", "Recent submission context"],
    relevantAgentIds: ["customer-advisor", "coo"],
    requiredGrantKeys: ["marketing_read"],
  },
  {
    id: "mailchimp",
    integrationId: "mailchimp-marketing",
    provider: "mailchimp",
    name: "Mailchimp Marketing",
    description: "Email marketing anchor for audiences, recent campaigns, and approved customer outreach context.",
    href: "/platform/tools/integrations/mailchimp",
    category: "email-marketing",
    pricingModel: "paid",
    model: "native",
    tags: ["email", "marketing", "campaigns", "audiences"],
    enables: ["Audience context", "Campaign context", "Outreach context"],
    relevantAgentIds: ["customer-advisor", "coo"],
    requiredGrantKeys: ["marketing_read"],
  },
];

export function getNativeIntegrationIds(): NativeIntegrationId[] {
  return NATIVE_INTEGRATIONS.map((integration) => integration.id);
}
