import { openIntent, type NextStepPointer } from "@/lib/backlog/next-step-pointer";
import type { NativeIntegrationId } from "./native-integration-catalog";

export type EmployeeWorkRole =
  | "owner_operator"
  | "bookkeeper_accountant"
  | "sales_bd"
  | "marketer"
  | "service_ops"
  | "customer_support"
  | "hr_payroll_admin"
  | "it_security_compliance"
  | "inventory_procurement_admin";

export type IntegrationCoverageKind = "native" | "benchmark";

export type IntegrationCoveragePosture =
  | "native-dpf"
  | "integration-led"
  | "hybrid"
  | "provider-led"
  | "replacement-candidate";

export type IntegrationCoverageMaturity = "observe" | "read" | "stage" | "operate" | "write-back";

export type CsdmStructuralDomain =
  | "business-capability"
  | "business-service"
  | "application-service"
  | "technical-service"
  | "service-offering";

export type It4ItValueStream =
  | "strategy-to-portfolio"
  | "requirement-to-deploy"
  | "request-to-fulfill"
  | "detect-to-correct";

export type IntegrationCoverageMatrixRow = {
  id: string;
  productName: string;
  provider: string;
  kind: IntegrationCoverageKind;
  nativeIntegrationId?: NativeIntegrationId;
  category: string;
  employeeRoles: EmployeeWorkRole[];
  taxonomyNodeIds: string[];
  dpfSurfaces: string[];
  coworkerIds: string[];
  posture: IntegrationCoveragePosture;
  maturity: IntegrationCoverageMaturity;
  csdmDomain: CsdmStructuralDomain;
  it4itValueStreams: It4ItValueStream[];
  nextStep: NextStepPointer;
  replacementCriteria: string;
  notes: string;
};

export const EMPLOYEE_WORK_ROLE_LABELS: Record<EmployeeWorkRole, string> = {
  owner_operator: "Owner / Operator",
  bookkeeper_accountant: "Bookkeeper / Accountant",
  sales_bd: "Sales / Business Development",
  marketer: "Marketing",
  service_ops: "Service Delivery / Operations",
  customer_support: "Customer Support",
  hr_payroll_admin: "HR / Payroll / Admin",
  it_security_compliance: "IT / Security / Compliance",
  inventory_procurement_admin: "Inventory / Assets / Procurement",
};

export const INTEGRATION_COVERAGE_KIND_LABELS: Record<IntegrationCoverageKind, string> = {
  native: "Native",
  benchmark: "Benchmark",
};

export const INTEGRATION_COVERAGE_POSTURE_LABELS: Record<IntegrationCoveragePosture, string> = {
  "native-dpf": "Native DPF",
  "integration-led": "Integration-led",
  hybrid: "Hybrid",
  "provider-led": "Provider-led",
  "replacement-candidate": "Replacement candidate",
};

export const INTEGRATION_COVERAGE_MATURITY_LABELS: Record<IntegrationCoverageMaturity, string> = {
  observe: "Observe",
  read: "Read",
  stage: "Stage",
  operate: "Operate",
  "write-back": "Write-back",
};

export const CSDM_STRUCTURAL_DOMAIN_LABELS: Record<CsdmStructuralDomain, string> = {
  "business-capability": "Business Capability",
  "business-service": "Business Service",
  "application-service": "Application Service",
  "technical-service": "Technical Service",
  "service-offering": "Service Offering",
};

export const IT4IT_VALUE_STREAM_LABELS: Record<It4ItValueStream, string> = {
  "strategy-to-portfolio": "Strategy to Portfolio",
  "requirement-to-deploy": "Requirement to Deploy",
  "request-to-fulfill": "Request to Fulfill",
  "detect-to-correct": "Detect to Correct",
};

export const INTEGRATION_COVERAGE_MATRIX: IntegrationCoverageMatrixRow[] = [
  {
    id: "quickbooks-online-finance",
    productName: "QuickBooks Online",
    provider: "Intuit",
    kind: "native",
    nativeIntegrationId: "quickbooks",
    category: "Accounting",
    employeeRoles: ["bookkeeper_accountant", "owner_operator"],
    taxonomyNodeIds: [
      "for_employees/financial_management",
      "for_employees/financial_management/perform_general_accounting_and_reporting",
      "for_employees/financial_management/process_accounts_receivable",
      "for_employees/financial_management/process_accounts_payable_and_expense_reimbursements",
    ],
    dpfSurfaces: ["/finance", "/platform/tools/integrations/quickbooks"],
    coworkerIds: ["finance-controller", "finance-agent", "coo"],
    posture: "hybrid",
    maturity: "stage",
    csdmDomain: "service-offering",
    it4itValueStreams: ["strategy-to-portfolio", "request-to-fulfill", "detect-to-correct"],
    nextStep: openIntent("Entity links before write-back"),
    replacementCriteria:
      "DPF stays integration-led until source-attributed import staging, entity links, reconciliation evidence, accountant collaboration, rollback/export, and governed write-back gates prove system-of-record promotion criteria.",
    notes: "QuickBooks read coverage now feeds non-editable staging posture before any entity-link or write-back work.",
  },
  {
    id: "stripe-payments",
    productName: "Stripe Billing & Payments",
    provider: "Stripe",
    kind: "native",
    nativeIntegrationId: "stripe",
    category: "Payments",
    employeeRoles: ["bookkeeper_accountant", "sales_bd", "owner_operator"],
    taxonomyNodeIds: [
      "for_employees/financial_management",
      "for_employees/financial_management/process_accounts_receivable",
      "for_employees/sales_and_marketing/customer_sales",
    ],
    dpfSurfaces: ["/finance", "/customer", "/platform/tools/integrations/stripe"],
    coworkerIds: ["finance-controller", "customer-advisor", "coo"],
    posture: "hybrid",
    maturity: "read",
    csdmDomain: "application-service",
    it4itValueStreams: ["request-to-fulfill", "detect-to-correct"],
    nextStep: openIntent("Reconciliation parity with accounting"),
    replacementCriteria:
      "DPF should reconcile payments and customer invoices before promoting any local billing record as primary.",
    notes: "Stripe is a native payment anchor and a reconciliation dependency for accounting parity.",
  },
  {
    id: "adp-workforce-now",
    productName: "ADP Workforce Now",
    provider: "ADP",
    kind: "native",
    nativeIntegrationId: "adp",
    category: "HR / Payroll",
    employeeRoles: ["hr_payroll_admin", "bookkeeper_accountant", "owner_operator"],
    taxonomyNodeIds: [
      "for_employees/workforce_services",
      "for_employees/workforce_services/hr_operations_and_administration",
      "for_employees/financial_management/process_payroll",
    ],
    dpfSurfaces: ["/employee", "/finance", "/platform/tools/integrations/adp"],
    coworkerIds: ["hr-specialist", "finance-controller", "coo"],
    posture: "integration-led",
    maturity: "read",
    csdmDomain: "application-service",
    it4itValueStreams: ["request-to-fulfill", "detect-to-correct"],
    nextStep: openIntent("Payroll handoff into finance and HR"),
    replacementCriteria:
      "Payroll remains provider-led unless DPF later has compliance, tax, and payroll-control evidence for a narrow native service.",
    notes: "Payroll context belongs in finance and HR handoffs, not in a generic employee profile view.",
  },
  {
    id: "greenhouse-recruiting",
    productName: "Greenhouse Recruiting",
    provider: "Greenhouse",
    kind: "native",
    nativeIntegrationId: "greenhouse",
    category: "Recruiting / ATS",
    employeeRoles: ["hr_payroll_admin", "owner_operator"],
    taxonomyNodeIds: [
      "for_employees/workforce_services",
      "for_employees/workforce_services/hr_operations_and_administration",
    ],
    dpfSurfaces: ["/employee", "/platform/tools/integrations/greenhouse"],
    coworkerIds: ["hr-specialist", "coo"],
    posture: "integration-led",
    maturity: "stage",
    csdmDomain: "application-service",
    it4itValueStreams: ["request-to-fulfill", "detect-to-correct"],
    nextStep: openIntent("Absorb ATS staging toward replacement"),
    replacementCriteria:
      "Greenhouse stays integration-led until native recruiting (requisition-to-hire, converting into the worker record) reaches parity and a dual-run cutover is proven.",
    notes: "First ATS connector; imports jobs/candidates/applications/offers to read-only staging and lands hires into onboarding. Bridge -> absorb -> replace toward native recruiting.",
  },
  {
    id: "microsoft365-communications",
    productName: "Microsoft 365 Communications",
    provider: "Microsoft",
    kind: "native",
    nativeIntegrationId: "microsoft365",
    category: "Communications",
    employeeRoles: ["owner_operator", "service_ops", "customer_support", "it_security_compliance"],
    taxonomyNodeIds: [
      "for_employees/workforce_services/employee_relations_and_communications",
      "for_employees/security_and_compliance/identity_and_access_management",
    ],
    dpfSurfaces: ["/workspace/my-queue", "/employee", "/platform/tools/integrations/microsoft365-communications"],
    coworkerIds: ["admin-assistant", "ops-coordinator", "platform-engineer"],
    posture: "hybrid",
    maturity: "read",
    csdmDomain: "business-service",
    it4itValueStreams: ["request-to-fulfill", "detect-to-correct"],
    nextStep: openIntent("Provider custody boundary for channels"),
    replacementCriteria:
      "DPF should orchestrate work and evidence while Microsoft 365 remains the provider system for mail, calendar, and Teams.",
    notes: "Communications coverage needs both worker queue consumption and provider-level custody boundaries.",
  },
  {
    id: "hubspot-crm-marketing",
    productName: "HubSpot CRM & Marketing",
    provider: "HubSpot",
    kind: "native",
    nativeIntegrationId: "hubspot",
    category: "CRM / Marketing",
    employeeRoles: ["sales_bd", "marketer", "customer_support"],
    taxonomyNodeIds: [
      "for_employees/sales_and_marketing/customer_sales",
      "for_employees/sales_and_marketing/marketing_and_advertising",
      "for_employees/sales_and_marketing/inquiry_management",
    ],
    dpfSurfaces: ["/customer", "/storefront", "/platform/tools/integrations/hubspot"],
    coworkerIds: ["customer-advisor", "marketing-specialist", "coo"],
    posture: "hybrid",
    maturity: "read",
    csdmDomain: "service-offering",
    it4itValueStreams: ["strategy-to-portfolio", "request-to-fulfill"],
    nextStep: openIntent("One CRM lane across sales, marketing and support"),
    replacementCriteria:
      "DPF can own work queues and customer context while CRM remains provider-led until pipeline, consent, and support handoffs are explicit.",
    notes: "CRM coverage is shared by sales, marketing, and support rather than a single route.",
  },
  {
    id: "google-marketing-intelligence",
    productName: "Google Marketing Intelligence",
    provider: "Google",
    kind: "native",
    nativeIntegrationId: "google",
    category: "Marketing Intelligence",
    employeeRoles: ["marketer", "owner_operator"],
    taxonomyNodeIds: [
      "for_employees/sales_and_marketing/customer_analytics",
      "for_employees/sales_and_marketing/marketing_and_advertising",
    ],
    dpfSurfaces: ["/customer", "/portfolio", "/platform/tools/integrations/google-marketing-intelligence"],
    coworkerIds: ["customer-advisor", "marketing-specialist", "portfolio-advisor"],
    posture: "integration-led",
    maturity: "read",
    csdmDomain: "application-service",
    it4itValueStreams: ["strategy-to-portfolio", "detect-to-correct"],
    nextStep: openIntent("Read-first signals for daily decisions"),
    replacementCriteria:
      "DPF should interpret and route marketing signals, not replace the analytics provider.",
    notes: "Marketing intelligence is a read-first signal source for owner and marketer daily decisions.",
  },
  {
    id: "google-business-profile",
    productName: "Google Business Profile",
    provider: "Google",
    kind: "native",
    nativeIntegrationId: "google-business-profile",
    category: "Local Presence",
    employeeRoles: ["marketer", "customer_support", "owner_operator"],
    taxonomyNodeIds: [
      "for_employees/sales_and_marketing/marketing_and_advertising",
      "for_employees/sales_and_marketing/inquiry_management",
    ],
    dpfSurfaces: ["/customer", "/storefront", "/platform/tools/integrations/google-business-profile"],
    coworkerIds: ["customer-advisor", "marketing-specialist", "coo"],
    posture: "hybrid",
    maturity: "read",
    csdmDomain: "service-offering",
    it4itValueStreams: ["request-to-fulfill", "detect-to-correct"],
    nextStep: openIntent("Local presence across marketing and support"),
    replacementCriteria:
      "DPF can stage local-presence work, but provider listings remain authoritative until write approvals and audit are designed.",
    notes: "Local presence belongs in both marketing and customer support coverage.",
  },
  {
    id: "facebook-lead-ads",
    productName: "Facebook Lead Ads",
    provider: "Meta",
    kind: "native",
    nativeIntegrationId: "facebook",
    category: "Lead Capture",
    employeeRoles: ["marketer", "sales_bd"],
    taxonomyNodeIds: [
      "for_employees/sales_and_marketing/marketing_and_advertising",
      "for_employees/sales_and_marketing/customer_sales",
    ],
    dpfSurfaces: ["/customer", "/storefront", "/platform/tools/integrations/facebook-lead-ads"],
    coworkerIds: ["customer-advisor", "marketing-specialist", "coo"],
    posture: "hybrid",
    maturity: "read",
    csdmDomain: "service-offering",
    it4itValueStreams: ["request-to-fulfill"],
    nextStep: openIntent("Land captured leads in the sales workflow"),
    replacementCriteria:
      "DPF should own lead triage and routing while Meta remains the campaign and form provider.",
    notes: "Lead capture must land in CRM/sales workflow, not just integration status.",
  },
  {
    id: "facebook-pages",
    productName: "Facebook Pages",
    provider: "Meta",
    kind: "native",
    nativeIntegrationId: "facebook-pages",
    category: "Social Presence",
    employeeRoles: ["marketer", "customer_support"],
    taxonomyNodeIds: [
      "for_employees/sales_and_marketing/marketing_and_advertising",
      "for_employees/sales_and_marketing/inquiry_management",
    ],
    dpfSurfaces: ["/customer", "/storefront", "/platform/tools/integrations/facebook-pages"],
    coworkerIds: ["customer-advisor", "marketing-specialist"],
    posture: "hybrid",
    maturity: "read",
    csdmDomain: "service-offering",
    it4itValueStreams: ["request-to-fulfill", "detect-to-correct"],
    nextStep: openIntent("Split publishing from support response"),
    replacementCriteria:
      "DPF should stage response work and evidence before any social write-back is allowed.",
    notes: "Social presence coverage crosses marketing publishing and support response work.",
  },
  {
    id: "whatsapp-business-messaging",
    productName: "WhatsApp Business",
    provider: "Meta",
    kind: "native",
    nativeIntegrationId: "whatsapp-business",
    category: "Localized Messaging",
    employeeRoles: ["customer_support", "marketer", "owner_operator"],
    taxonomyNodeIds: [
      "for_employees/sales_and_marketing/inquiry_management",
      "for_employees/sales_and_marketing/marketing_and_advertising",
    ],
    dpfSurfaces: ["/customer", "/platform/tools/integrations/whatsapp-business"],
    coworkerIds: ["customer-advisor", "marketing-specialist", "coo"],
    posture: "hybrid",
    maturity: "read",
    csdmDomain: "service-offering",
    it4itValueStreams: ["request-to-fulfill", "detect-to-correct"],
    nextStep: openIntent("Governance before outbound messaging"),
    replacementCriteria:
      "DPF should own messaging triage, template governance, and evidence while Meta remains the WhatsApp Cloud API provider until outbound send and webhook approvals are explicit.",
    notes: "Read-first WhatsApp phone and template readiness; outbound messaging stays out of scope until governance is explicit.",
  },
  {
    id: "instagram-business-social",
    productName: "Instagram Business",
    provider: "Meta",
    kind: "native",
    nativeIntegrationId: "instagram-business",
    category: "Social Presence",
    employeeRoles: ["marketer", "customer_support"],
    taxonomyNodeIds: [
      "for_employees/sales_and_marketing/marketing_and_advertising",
      "for_employees/sales_and_marketing/inquiry_management",
    ],
    dpfSurfaces: ["/customer", "/storefront", "/platform/tools/integrations/instagram-business"],
    coworkerIds: ["customer-advisor", "marketing-specialist"],
    posture: "hybrid",
    maturity: "read",
    csdmDomain: "service-offering",
    it4itValueStreams: ["request-to-fulfill", "detect-to-correct"],
    nextStep: openIntent("Governance before social write-back"),
    replacementCriteria:
      "DPF should stage response and publishing work with evidence before any Instagram write-back is allowed; Meta remains the media and comment provider.",
    notes: "Read-first Instagram profile, media, and comment context; social write-back stays out of scope until governance is explicit.",
  },
  {
    id: "mailchimp-marketing",
    productName: "Mailchimp Marketing",
    provider: "Intuit Mailchimp",
    kind: "native",
    nativeIntegrationId: "mailchimp",
    category: "Email Marketing",
    employeeRoles: ["marketer", "sales_bd"],
    taxonomyNodeIds: [
      "for_employees/sales_and_marketing/marketing_and_advertising",
      "for_employees/sales_and_marketing/customer_analytics",
    ],
    dpfSurfaces: ["/customer", "/platform/tools/integrations/mailchimp"],
    coworkerIds: ["marketing-specialist", "customer-advisor"],
    posture: "integration-led",
    maturity: "read",
    csdmDomain: "application-service",
    it4itValueStreams: ["strategy-to-portfolio", "request-to-fulfill"],
    nextStep: openIntent("Consent boundaries before write-back"),
    replacementCriteria:
      "DPF should coordinate audiences, approvals, and outcomes while Mailchimp remains the campaign execution provider.",
    notes: "Campaign context needs consent and customer-record boundaries before write-back.",
  },
  {
    id: "linkedin-personal-social",
    productName: "LinkedIn (personal publishing)",
    provider: "LinkedIn",
    kind: "native",
    nativeIntegrationId: "linkedin-personal-social",
    category: "Social Publishing",
    employeeRoles: ["marketer", "owner_operator"],
    taxonomyNodeIds: [
      "for_employees/sales_and_marketing/marketing_and_advertising",
    ],
    dpfSurfaces: ["/customer/marketing", "/platform/tools/integrations/linkedin-personal-social"],
    coworkerIds: ["marketing-specialist"],
    posture: "integration-led",
    maturity: "write-back",
    csdmDomain: "application-service",
    it4itValueStreams: ["strategy-to-portfolio", "request-to-fulfill"],
    nextStep: openIntent("Member-scope publishing only"),
    replacementCriteria:
      "Conduit-only personal publishing; operator brings their own LinkedIn developer app and credentials.",
    notes: "Phase 2 of the marketing execution loop. Scope w_member_social only; no company-page write, no ads.",
  },
  {
    id: "linkedin-ads",
    productName: "LinkedIn Ads",
    provider: "LinkedIn",
    kind: "native",
    nativeIntegrationId: "linkedin-ads",
    category: "Paid Advertising",
    employeeRoles: ["marketer", "owner_operator"],
    taxonomyNodeIds: [
      "for_employees/sales_and_marketing/marketing_and_advertising",
    ],
    dpfSurfaces: ["/customer/marketing", "/platform/tools/integrations/linkedin-personal-social"],
    coworkerIds: ["marketing-specialist"],
    posture: "integration-led",
    maturity: "write-back",
    csdmDomain: "application-service",
    it4itValueStreams: ["strategy-to-portfolio", "request-to-fulfill"],
    nextStep: openIntent("Spend ceilings before adapter calls"),
    replacementCriteria:
      "Conduit-only paid placement. Operator brings their own LinkedIn ad account; DPF enforces hard weekly spend ceilings before any campaign goes live.",
    notes: "Phase 4 of the marketing execution loop. Reuses Phase 2's LinkedIn OAuth with optional r_ads/rw_ads scopes. Spend ceiling refused before adapter API call.",
  },
  {
    id: "email-postmark",
    productName: "Email (Postmark)",
    provider: "Postmark",
    kind: "native",
    nativeIntegrationId: "email-postmark",
    category: "Email Marketing",
    employeeRoles: ["marketer", "owner_operator", "sales_bd"],
    taxonomyNodeIds: [
      "for_employees/sales_and_marketing/marketing_and_advertising",
      "for_employees/sales_and_marketing/customer_analytics",
    ],
    dpfSurfaces: ["/customer/marketing", "/platform/tools/integrations/email-postmark"],
    coworkerIds: ["marketing-specialist", "customer-advisor"],
    posture: "integration-led",
    maturity: "write-back",
    csdmDomain: "application-service",
    it4itValueStreams: ["strategy-to-portfolio", "request-to-fulfill"],
    nextStep: openIntent("One approval path for outbound and inbound"),
    replacementCriteria:
      "Conduit-only email send + receive; operator brings their own Postmark server and signing secret.",
    notes: "Phase 3 of the marketing execution loop. Outbound send + inbound signed-webhook with classification + holding-pattern reply through the same approval queue.",
  },
  {
    id: "xero-accounting-benchmark",
    productName: "Xero",
    provider: "Xero",
    kind: "benchmark",
    category: "Accounting",
    employeeRoles: ["bookkeeper_accountant", "owner_operator"],
    taxonomyNodeIds: [
      "for_employees/financial_management",
      "for_employees/financial_management/perform_general_accounting_and_reporting",
    ],
    dpfSurfaces: ["/finance", "/platform/tools/integrations"],
    coworkerIds: ["finance-controller", "finance-agent"],
    posture: "integration-led",
    maturity: "observe",
    csdmDomain: "service-offering",
    it4itValueStreams: ["strategy-to-portfolio", "request-to-fulfill"],
    nextStep: openIntent("Adapter after QuickBooks proves the lane"),
    replacementCriteria:
      "Use Xero as a parity benchmark for accounting read breadth before considering another native connector.",
    notes: "Benchmark-only accounting product for customers that are not QuickBooks-centered.",
  },
  {
    id: "gusto-payroll-benchmark",
    productName: "Gusto",
    provider: "Gusto",
    kind: "benchmark",
    category: "Payroll / HR",
    employeeRoles: ["hr_payroll_admin", "bookkeeper_accountant", "owner_operator"],
    taxonomyNodeIds: [
      "for_employees/workforce_services/hr_operations_and_administration",
      "for_employees/financial_management/process_payroll",
    ],
    dpfSurfaces: ["/employee", "/finance", "/platform/tools/integrations"],
    coworkerIds: ["hr-specialist", "finance-controller"],
    posture: "provider-led",
    maturity: "observe",
    csdmDomain: "application-service",
    it4itValueStreams: ["request-to-fulfill", "detect-to-correct"],
    nextStep: openIntent("Compare SMB expectations against ADP"),
    replacementCriteria:
      "Keep payroll provider-led until HR, payroll tax, benefits, and finance posting boundaries are explicitly modeled.",
    notes: "Benchmark-only payroll product that helps compare SMB expectations against ADP coverage.",
  },
  {
    id: "salesforce-crm-benchmark",
    productName: "Salesforce",
    provider: "Salesforce",
    kind: "benchmark",
    category: "CRM / Sales",
    employeeRoles: ["sales_bd", "marketer", "customer_support", "owner_operator"],
    taxonomyNodeIds: [
      "for_employees/sales_and_marketing/customer_sales",
      "for_employees/sales_and_marketing/customer_analytics",
      "for_employees/sales_and_marketing/inquiry_management",
    ],
    dpfSurfaces: ["/customer", "/portfolio", "/platform/tools/integrations"],
    coworkerIds: ["customer-advisor", "marketing-specialist", "portfolio-advisor"],
    posture: "integration-led",
    maturity: "observe",
    csdmDomain: "business-service",
    it4itValueStreams: ["strategy-to-portfolio", "request-to-fulfill"],
    nextStep: openIntent("Benchmark only; no adapter planned"),
    replacementCriteria:
      "DPF should benchmark CRM breadth before deciding whether customer records become native, synchronized, or provider-led.",
    notes: "Benchmark-only CRM reference for sales pipeline, customer support, and analytics coverage.",
  },
  {
    id: "slack-communications-benchmark",
    productName: "Slack",
    provider: "Salesforce",
    kind: "benchmark",
    category: "Communications",
    employeeRoles: ["owner_operator", "service_ops", "customer_support", "it_security_compliance"],
    taxonomyNodeIds: [
      "for_employees/workforce_services/employee_relations_and_communications",
      "for_employees/security_and_compliance/identity_and_access_management",
    ],
    dpfSurfaces: ["/workspace/my-queue", "/employee", "/platform/tools/integrations"],
    coworkerIds: ["ops-coordinator", "admin-assistant", "platform-engineer"],
    posture: "integration-led",
    maturity: "observe",
    csdmDomain: "business-service",
    it4itValueStreams: ["request-to-fulfill", "detect-to-correct"],
    nextStep: openIntent("Channel-adapter decision"),
    replacementCriteria:
      "DPF should orchestrate tasks and evidence while chat remains a provider channel.",
    notes: "Benchmark-only communication provider for work queue and channel-adapter decisions.",
  },
  {
    id: "zendesk-support-benchmark",
    productName: "Zendesk",
    provider: "Zendesk",
    kind: "benchmark",
    category: "Customer Support",
    employeeRoles: ["customer_support", "service_ops", "owner_operator"],
    taxonomyNodeIds: [
      "for_employees/sales_and_marketing/inquiry_management",
      "for_employees/workforce_services/employee_relations_and_communications",
    ],
    dpfSurfaces: ["/customer", "/workspace/my-queue", "/storefront", "/platform/tools/integrations"],
    coworkerIds: ["customer-advisor", "ops-coordinator"],
    posture: "replacement-candidate",
    maturity: "observe",
    csdmDomain: "service-offering",
    it4itValueStreams: ["request-to-fulfill", "detect-to-correct"],
    nextStep: openIntent("Support lane connector decision"),
    replacementCriteria:
      "DPF can become primary for lightweight support only after intake, SLA, assignment, knowledge, and customer portal coverage are native.",
    notes: "Benchmark-only support product for the customer support lane.",
  },
  {
    id: "shopify-commerce-benchmark",
    productName: "Shopify",
    provider: "Shopify",
    kind: "benchmark",
    category: "Storefront / Inventory",
    employeeRoles: ["inventory_procurement_admin", "sales_bd", "owner_operator"],
    taxonomyNodeIds: [
      "for_employees/vendor_and_procurement_services/sourcing_and_procurement",
      "for_employees/sales_and_marketing/customer_sales",
    ],
    dpfSurfaces: ["/storefront", "/customer", "/platform/tools/integrations"],
    coworkerIds: ["inventory-specialist", "customer-advisor", "coo"],
    posture: "hybrid",
    maturity: "observe",
    csdmDomain: "service-offering",
    it4itValueStreams: ["strategy-to-portfolio", "request-to-fulfill"],
    nextStep: openIntent("Inventory and procurement coverage decision"),
    replacementCriteria:
      "DPF should keep commerce provider-led until product catalog, inventory, order, payment, and fulfillment ownership are explicit.",
    notes: "Benchmark-only storefront product for inventory and procurement admin coverage.",
  },
  {
    id: "servicenow-service-management-benchmark",
    productName: "ServiceNow",
    provider: "ServiceNow",
    kind: "benchmark",
    category: "Service Management",
    employeeRoles: ["service_ops", "it_security_compliance", "customer_support"],
    taxonomyNodeIds: [
      "for_employees/develop_and_manage_business_capabilities/manage_business_processes",
      "for_employees/security_and_compliance/governance_risk_and_compliance",
    ],
    dpfSurfaces: ["/workspace/my-queue", "/compliance", "/portfolio", "/platform/tools/integrations"],
    coworkerIds: ["ops-coordinator", "platform-engineer", "licensing-specialist"],
    posture: "replacement-candidate",
    maturity: "observe",
    csdmDomain: "business-service",
    it4itValueStreams: ["request-to-fulfill", "detect-to-correct"],
    nextStep: openIntent("CSDM reference, not an implementation target"),
    replacementCriteria:
      "DPF can borrow structural patterns while staying narrower than a CMDB/ITSM suite until service ownership and operations are native.",
    notes: "Benchmark-only service-management product and CSDM reference point, not a verbatim implementation target.",
  },
  {
    id: "jira-service-management-benchmark",
    productName: "Jira Service Management",
    provider: "Atlassian",
    kind: "benchmark",
    category: "IT / Service Operations",
    employeeRoles: ["service_ops", "it_security_compliance", "customer_support"],
    taxonomyNodeIds: [
      "for_employees/develop_and_manage_business_capabilities/manage_business_processes",
      "for_employees/security_and_compliance/cybersecurity_operations",
    ],
    dpfSurfaces: ["/workspace/my-queue", "/compliance", "/platform/tools/integrations"],
    coworkerIds: ["ops-coordinator", "platform-engineer"],
    posture: "integration-led",
    maturity: "observe",
    csdmDomain: "application-service",
    it4itValueStreams: ["request-to-fulfill", "detect-to-correct"],
    nextStep: openIntent("Work-queue modeling reference"),
    replacementCriteria:
      "Use as a workflow benchmark for request, incident, and change-style queue patterns before creating native equivalents.",
    notes: "Benchmark-only IT and service-ops reference for work queue modeling.",
  },
  {
    id: "microsoft-intune-benchmark",
    productName: "Microsoft Intune",
    provider: "Microsoft",
    kind: "benchmark",
    category: "Endpoint / Compliance",
    employeeRoles: ["it_security_compliance", "owner_operator"],
    taxonomyNodeIds: [
      "for_employees/security_and_compliance/identity_and_access_management",
      "for_employees/security_and_compliance/privacy_and_data_protection",
    ],
    dpfSurfaces: ["/compliance", "/employee", "/platform/tools/integrations"],
    coworkerIds: ["platform-engineer", "licensing-specialist", "coo"],
    posture: "provider-led",
    maturity: "observe",
    csdmDomain: "technical-service",
    it4itValueStreams: ["request-to-fulfill", "detect-to-correct"],
    nextStep: openIntent("Estate discovery before vendor RMM"),
    replacementCriteria:
      "Device and endpoint management should remain provider-led; DPF should consume posture and evidence signals.",
    notes: "Benchmark-only endpoint provider for IT/security/compliance coverage.",
  },
];

export function getCoverageRowsByNativeIntegrationId(
  nativeIntegrationId: NativeIntegrationId,
): IntegrationCoverageMatrixRow[] {
  return INTEGRATION_COVERAGE_MATRIX.filter((row) => row.nativeIntegrationId === nativeIntegrationId);
}

export function getBenchmarkCoverageRows(): IntegrationCoverageMatrixRow[] {
  return INTEGRATION_COVERAGE_MATRIX.filter((row) => row.kind === "benchmark");
}
