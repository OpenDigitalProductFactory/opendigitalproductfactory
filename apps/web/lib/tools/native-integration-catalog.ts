import { QUICKBOOKS_READINESS_ENTITY_FAMILIES } from "@/lib/integrations/quickbooks/readiness";

export type NativeIntegrationId =
  | "adp"
  | "greenhouse"
  | "quickbooks"
  | "stripe"
  | "microsoft365"
  | "hubspot"
  | "google"
  | "google-business-profile"
  | "facebook"
  | "facebook-pages"
  | "whatsapp-business"
  | "instagram-business"
  | "linkedin-personal-social"
  | "linkedin-ads"
  | "email-postmark"
  | "mailchimp";

export type NativeIntegrationDescriptor = {
  id: NativeIntegrationId;
  integrationId: string;
  provider: string;
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
  readiness?: {
    entityFamilies: readonly string[];
  };
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
    id: "greenhouse",
    integrationId: "greenhouse-recruiting",
    provider: "greenhouse",
    name: "Greenhouse Recruiting",
    description:
      "Applicant-tracking anchor for jobs, candidates, applications, stages, scorecards, offers, and hires via the Greenhouse Harvest API. Bridges toward native recruiting (requisition-to-hire) on the ecosystem-absorption path.",
    href: "/platform/tools/integrations/greenhouse",
    category: "hr",
    pricingModel: "paid",
    model: "native",
    tags: ["hr", "recruiting", "ats", "candidates", "applications", "offers", "hiring"],
    enables: [
      "Requisition context",
      "Candidate context",
      "Application/pipeline context",
      "Scorecard context",
      "Offer context",
      "Hire import into onboarding",
    ],
    relevantAgentIds: ["hr-specialist", "coo"],
    requiredGrantKeys: ["consumer_read"],
  },
  {
    id: "quickbooks",
    integrationId: "quickbooks-online-accounting",
    provider: "quickbooks",
    name: "QuickBooks Online",
    description:
      "Finance anchor for company, customer, invoice, AP, payment, chart-of-accounts, and report context on the native integration substrate.",
    href: "/platform/tools/integrations/quickbooks",
    category: "finance",
    pricingModel: "paid",
    model: "native",
    tags: [
      "finance",
      "accounting",
      "invoices",
      "customers",
      "vendors",
      "bills",
      "expenses",
      "payments",
      "ledger",
      "reports",
    ],
    enables: [
      "Company context",
      "Customer context",
      "Invoice context",
      "Vendor context",
      "Bill context",
      "Expense context",
      "Payment context",
      "Chart of accounts context",
      "Report context",
      "Accounting previews",
    ],
    relevantAgentIds: ["finance-controller", "coo"],
    requiredGrantKeys: ["registry_read"],
    readiness: {
      entityFamilies: QUICKBOOKS_READINESS_ENTITY_FAMILIES,
    },
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
    integrationId: "hubspot-marketing-crm",
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
    id: "facebook-pages",
    integrationId: "facebook-pages",
    provider: "facebook",
    name: "Facebook Pages",
    description: "Localized social presence anchor for page details, recent posts, and comment activity.",
    href: "/platform/tools/integrations/facebook-pages",
    category: "local-social-presence",
    pricingModel: "paid",
    model: "native",
    tags: ["facebook", "pages", "social", "posts", "comments", "local presence"],
    enables: ["Page profile context", "Recent post context", "Recent comment context", "Local social presence guidance"],
    relevantAgentIds: ["customer-advisor", "coo"],
    requiredGrantKeys: ["marketing_read"],
  },
  {
    id: "whatsapp-business",
    integrationId: "whatsapp-business",
    provider: "facebook",
    name: "WhatsApp Business",
    description:
      "Localized messaging readiness anchor for WhatsApp Business phone quality, approved message templates, and language coverage. Read-first phone and template probes run before any outbound message, automation, or webhook workflows.",
    href: "/platform/tools/integrations/whatsapp-business",
    category: "communications",
    pricingModel: "paid",
    model: "native",
    tags: ["whatsapp", "messaging", "communications", "templates", "meta"],
    enables: ["WhatsApp phone readiness context", "Message template context", "Localized template coverage context"],
    relevantAgentIds: ["customer-advisor", "marketing-specialist", "coo"],
    requiredGrantKeys: ["marketing_read"],
  },
  {
    id: "instagram-business",
    integrationId: "instagram-business",
    provider: "facebook",
    name: "Instagram Business",
    description: "Local visual presence anchor for Instagram Business profile details, recent media, and comment activity. Read-first profile and media probes before any publishing or comment write-back is scoped.",
    href: "/platform/tools/integrations/instagram-business",
    category: "local-social-presence",
    pricingModel: "paid",
    model: "native",
    tags: ["instagram", "social", "media", "comments", "local presence", "meta"],
    enables: ["Instagram profile context", "Recent media context", "Recent comment context"],
    relevantAgentIds: ["customer-advisor", "marketing-specialist"],
    requiredGrantKeys: ["marketing_read"],
  },
  {
    id: "google-business-profile",
    integrationId: "google-business-profile",
    provider: "google",
    name: "Google Business Profile",
    description: "Localized presence anchor for business listings, location details, and recent review context.",
    href: "/platform/tools/integrations/google-business-profile",
    category: "local-presence",
    pricingModel: "paid",
    model: "native",
    tags: ["google", "business profile", "local presence", "reviews", "locations"],
    enables: ["Business listing context", "Location context", "Review context", "Local presence guidance"],
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
  {
    id: "linkedin-personal-social",
    integrationId: "linkedin-personal-social",
    provider: "linkedin",
    name: "LinkedIn (personal publishing)",
    description: "Publish approved marketing drafts to your own LinkedIn feed. You bring your own LinkedIn developer app; DPF stores the refresh token encrypted in this install.",
    href: "/platform/tools/integrations/linkedin-personal-social",
    category: "marketing",
    pricingModel: "paid",
    model: "native",
    tags: ["marketing", "social", "publish", "linkedin"],
    enables: ["Publish marketing draft to LinkedIn feed"],
    relevantAgentIds: ["marketing-specialist"],
    requiredGrantKeys: ["marketing_write"],
  },
  {
    id: "linkedin-ads",
    integrationId: "linkedin-ads",
    provider: "linkedin",
    name: "LinkedIn Ads",
    description: "Place paid LinkedIn ads from approved ad-creative drafts with hard per-channel weekly spend ceilings + KPI pullback. Reuses your own LinkedIn developer app with the optional ads scope.",
    href: "/platform/tools/integrations/linkedin-personal-social",
    category: "marketing",
    pricingModel: "paid",
    model: "native",
    tags: ["marketing", "ads", "paid", "linkedin"],
    enables: [
      "Place LinkedIn campaign from approved ad-creative",
      "Hard weekly spend ceiling refused at place time",
      "Engagement pullback into MarketingKpiCheckpoint",
    ],
    relevantAgentIds: ["marketing-specialist"],
    requiredGrantKeys: ["marketing_write"],
  },
  {
    id: "email-postmark",
    integrationId: "email-postmark",
    provider: "postmark",
    name: "Email (Postmark)",
    description: "Send approved marketing email drafts through your own Postmark account and accept inbound replies via signed webhook. DPF stores the server token + signing secret encrypted.",
    href: "/platform/tools/integrations/email-postmark",
    category: "email-marketing",
    pricingModel: "paid",
    model: "native",
    tags: ["marketing", "email", "publish", "inbound"],
    enables: [
      "Send approved marketing email",
      "Accept inbound reply via webhook",
      "Draft AI reply for human approval",
      "Link qualified inquiry to CRM Engagement",
    ],
    relevantAgentIds: ["marketing-specialist", "customer-advisor"],
    requiredGrantKeys: ["marketing_write"],
  },
];

export function getNativeIntegrationIds(): NativeIntegrationId[] {
  return NATIVE_INTEGRATIONS.map((integration) => integration.id);
}

export function getNativeIntegrationCredentialIds(): string[] {
  return NATIVE_INTEGRATIONS.map((integration) => integration.integrationId);
}
