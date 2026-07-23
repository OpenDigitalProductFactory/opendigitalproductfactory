export const BUSINESS_CAPABILITY_SEED_PREFIX = "BCAP-SEED-";

type CapabilityRow = {
  id: string;
  capabilityId: string;
};

type BusinessCapabilityStore = {
  businessCapability: {
    findMany(args: {
      where: { capabilityId: { startsWith: string }; status?: string };
      select: { id: true; capabilityId: true };
    }): Promise<CapabilityRow[]>;
    upsert(args: {
      where: { capabilityId: string };
      create: ProjectedCapabilityWrite;
      update: ProjectedCapabilityUpdate;
      select: { id: true; capabilityId: true };
    }): Promise<CapabilityRow>;
    updateMany(args: {
      where: { capabilityId: { in: string[] } };
      data: { status: string };
    }): Promise<{ count: number }>;
  };
};

type BusinessCapabilitySeedStore = BusinessCapabilityStore & {
  storefrontConfig: {
    findFirst(args: {
      select: {
        archetype: {
          select: { archetypeId: true; category: true };
        };
      };
      orderBy: { createdAt: "asc" };
    }): Promise<{
      archetype: { archetypeId: string; category: string } | null;
    } | null>;
  };
};

export type BusinessCapabilityPerspectiveInput = {
  archetypeId?: string | null;
  category?: string | null;
};

export type BusinessCapabilitySeedDefinition = {
  key: string;
  parentKey?: string;
  name: string;
  description: string;
  level: 1 | 2 | 3;
  sortOrder: number;
  currentMaturity?: number;
  targetMaturity?: number;
  maturityRationale?: string;
  it4itValueStreams?: string[];
};

type ProjectedCapabilityWrite = {
  capabilityId: string;
  name: string;
  slug: string;
  description: string;
  level: number;
  sortOrder: number;
  status: string;
  parentId: string | null;
  currentMaturity: number;
  targetMaturity: number;
  maturityRationale: string | null;
  it4itValueStreams: string[];
};

type ProjectedCapabilityUpdate = Omit<
  ProjectedCapabilityWrite,
  "capabilityId" | "currentMaturity" | "targetMaturity" | "maturityRationale"
>;

type BusinessCapabilityPerspective = {
  perspectiveId: string;
  label: string;
  source: string;
  capabilities: BusinessCapabilitySeedDefinition[];
};

export type BusinessCapabilityPerspectiveSource = Pick<
  BusinessCapabilityPerspective,
  "perspectiveId" | "label" | "source"
>;

export type ResolvedBusinessCapabilityPerspective = {
  sourcePerspectiveIds: string[];
  sources: BusinessCapabilityPerspectiveSource[];
  capabilities: BusinessCapabilitySeedDefinition[];
};

export type ApplyBusinessCapabilityPerspectiveResult = {
  sourcePerspectiveIds: string[];
  appliedCount: number;
  deactivatedCount: number;
};

const COMMON_SMALL_BUSINESS: BusinessCapabilityPerspective = {
  perspectiveId: "common-small-business",
  label: "Common Small Business",
  source: "DPF baseline informed by APQC-style process families",
  capabilities: [
    l1("setup", "Business Setup And Operating Model", 10, "Define the business shape, operating footprint, provider choices, and readiness posture.", ["evaluate"]),
    l2("setup-business-context", "setup", "Business Context", 10, "Maintain the business profile, archetype, stakeholder vocabulary, footprint, and setup assumptions.", ["evaluate"]),
    l2("setup-provider-readiness", "setup", "Provider Readiness", 20, "Track which finance, payment, payroll, customer, marketing, and communication providers are configured or missing.", ["integrate"]),

    l1("finance", "Financial Management", 20, "Manage cash, invoices, bills, expenses, tax posture, reporting, and close evidence.", ["operate"]),
    l2("finance-invoicing-ar", "finance", "Invoicing And Accounts Receivable", 10, "Create, read, stage, and reconcile invoices, customers, payments, and collections posture.", ["consume", "operate"]),
    l2("finance-bills-expenses-vendors", "finance", "Bills Expenses And Vendors", 20, "Track suppliers, bills, expense claims, purchase orders, and payment readiness.", ["consume", "operate"]),
    l2("finance-payments-reconciliation", "finance", "Payments And Reconciliation", 30, "Reconcile Stripe, QuickBooks, bank facts, deposits, fees, payouts, and payment records.", ["operate"]),
    l2("finance-reporting-close", "finance", "Reporting And Close", 40, "Prepare reports, close workflows, variance notes, and accountant evidence packets.", ["operate"]),

    l1("revenue-customer-growth", "Revenue And Customer Growth", 30, "Find, convert, retain, and grow customers through sales, marketing, and local presence work.", ["explore", "consume"]),
    l2("revenue-leads-pipeline", "revenue-customer-growth", "Leads Pipeline And Opportunities", 10, "Capture leads, qualify opportunities, manage quotes, and progress sales orders.", ["explore", "consume"]),
    l2("revenue-marketing-presence", "revenue-customer-growth", "Marketing And Local Presence", 20, "Coordinate campaigns, local listings, social channels, content, and email marketing.", ["explore"]),

    l1("customer-operations-support", "Customer Operations And Support", 40, "Run customer intake, support, service delivery, and follow-up.", ["consume", "operate"]),
    l2("customer-intake-inbox", "customer-operations-support", "Customer Intake And Inbox", 10, "Receive and triage inquiries, portal messages, service requests, and channel conversations.", ["consume"]),
    l2("customer-service-delivery", "customer-operations-support", "Service Delivery Operations", 20, "Coordinate appointments, work items, engagements, delivery status, and completion evidence.", ["operate"]),
    l2("customer-support-followup", "customer-operations-support", "Support And Follow-Up", 30, "Resolve questions, complaints, requests, status updates, and support handoffs.", ["operate"]),

    l1("people-admin", "People Payroll And Administration", 50, "Manage worker records, payroll readiness, admin operations, and authority handoffs.", ["operate"]),
    l2("people-employee-records", "people-admin", "Employee Records And Roles", 10, "Maintain workers, roles, availability, responsibilities, and governed access context.", ["operate"]),
    l2("people-payroll-readiness", "people-admin", "Payroll Readiness", 20, "Keep payroll provider posture, worker payment context, and payroll evidence integration-led until proven.", ["integrate"]),

    l1("work-communications", "Work Coordination And Communications", 60, "Route work, coordinate employees and coworkers, and keep communication evidence connected.", ["operate"]),
    l2("work-queues", "work-communications", "Work Queues And Ownership", 10, "Assign, route, prioritize, and complete work across employees, AI coworkers, and queues.", ["operate"]),
    l2("communications-fabric", "work-communications", "Communication Fabric", 20, "Coordinate email, messaging, customer updates, and employee reachability across channels.", ["integrate", "operate"]),

    l1("compliance-risk", "Compliance Risk And Assurance", 70, "Track obligations, licensing, risk, controls, incidents, and evidence.", ["operate"]),
    l2("compliance-licensing-obligations", "compliance-risk", "Licensing And Obligations", 10, "Investigate and maintain business authority, licensing, regulatory, and renewal posture.", ["operate"]),
    l2("compliance-security-assurance", "compliance-risk", "Security And Assurance", 20, "Govern security controls, audit evidence, incidents, and platform authority.", ["operate"]),

    l1("portfolio-product", "Portfolio Product And Backlog Operations", 80, "Plan, govern, build, and improve products, services, work surfaces, and platform backlog.", ["evaluate", "explore", "integrate"]),
    l2("portfolio-backlog-product-management", "portfolio-product", "Backlog And Product Management", 10, "Connect capabilities, product surfaces, epics, backlog items, and build/change evidence.", ["evaluate", "explore"]),

    l1("inventory-procurement-assets", "Inventory Procurement And Assets", 90, "Manage goods, equipment, suppliers, procurement, asset records, and stock where relevant.", ["operate"]),
    l2("inventory-purchasing-assets", "inventory-procurement-assets", "Purchasing Assets And Stock", 10, "Track purchased items, assets, inventory, restock posture, and vendor dependencies.", ["operate"]),
  ],
};

const IT_MANAGED_SERVICES: BusinessCapabilityPerspective = {
  perspectiveId: "it-managed-services",
  label: "IT Managed Services",
  source: "DPF MSP overlay informed by managed services, customer estate, NIST CSF, and service-agreement operating patterns",
  capabilities: [
    l1("msp-operations", "Managed Service Provider Operations", 100, "Operate customer-scoped technology estates, agreements, support, security, backup, and lifecycle reviews.", ["operate"]),
    l2("msp-managed-customer-estate", "msp-operations", "Managed Customer Estate", 10, "Maintain customer accounts, sites, managed assets, configuration items, and estate boundaries.", ["operate"]),
    l2("msp-monitoring-discovery", "msp-operations", "Monitoring And Discovery", 20, "Collect edge-node, network, endpoint, identity, and service health signals per customer scope.", ["operate"]),
    l2("msp-cybersecurity-posture", "msp-operations", "Cybersecurity Posture", 30, "Track governed identify, protect, detect, respond, and recover posture per managed customer.", ["operate"]),
    l2("msp-backup-recovery-posture", "msp-operations", "Backup And Recovery Posture", 40, "Track backup coverage, recovery readiness, test evidence, and continuity exceptions.", ["operate"]),
    l2("msp-service-agreements-sla", "msp-operations", "Service Agreements And SLA", 50, "Manage agreement scope, support coverage, SLA commitments, service catalogs, and renewal evidence.", ["consume", "operate"]),
    l2("msp-remote-support-consent", "msp-operations", "Remote Support Consent", 60, "Coordinate remote assistance only when authority, consent, customer/site scope, and evidence are clear.", ["operate"]),
    l2("msp-lifecycle-review", "msp-operations", "Lifecycle Review Queues", 70, "Review customers, sites, assets, backups, security posture, agreements, and lifecycle exceptions.", ["operate"]),
    l2("msp-agreement-billing-readiness", "msp-operations", "Agreement Billing Readiness", 80, "Prepare device, user, backup, service, and pass-through billing evidence without owning final accounting execution by default.", ["consume", "operate"]),
  ],
};

const BEAUTY_PERSONAL_CARE: BusinessCapabilityPerspective = {
  perspectiveId: "beauty-personal-care",
  label: "Beauty And Personal Care",
  source: "DPF beauty/personal-care overlay informed by appointment checkout, service menu, practitioner assignment, retail/POS payments, CRM/marketing automation, and local-presence operating patterns",
  capabilities: [
    l1(
      "beauty-service-operations",
      "Beauty And Personal Care Operations",
      100,
      "Operate appointment-led personal services across service menus, practitioners, client preferences, checkout, retail products, and local demand channels.",
      ["consume", "operate"],
    ),
    l2(
      "beauty-service-menu-packages",
      "beauty-service-operations",
      "Service Menu Packages And Pricing",
      10,
      "Define services, treatments, add-ons, packages, memberships, prices, durations, booking rules, and product/service bundles.",
      ["explore", "consume"],
    ),
    l2(
      "beauty-booking-practitioner-calendar",
      "beauty-service-operations",
      "Booking Practitioner Calendar",
      20,
      "Coordinate appointment slots, practitioner or stylist assignment, customer-choice booking, buffers, reminders, and schedule exceptions.",
      ["consume", "operate"],
    ),
    l2(
      "beauty-client-preferences-intake",
      "beauty-service-operations",
      "Client Preferences And Intake",
      30,
      "Maintain client records, preferences, sensitivities, consent notes, style or treatment history, and CRM/customer profile anchors.",
      ["consume", "operate"],
    ),
    l2(
      "beauty-checkout-retail-payments",
      "beauty-service-operations",
      "Checkout Retail And Payments",
      40,
      "Handle appointment checkout, deposits, tips, packages, product retail sales, refunds, and Stripe/Square-like POS or payment reconciliation posture.",
      ["consume", "operate", "integrate"],
    ),
    l2(
      "beauty-supplies-tools-stock",
      "beauty-service-operations",
      "Supplies Tools Stock And Procurement",
      50,
      "Track professional products, consumables, tools, equipment, retail stock, restock thresholds, suppliers, and purchasing needs.",
      ["operate"],
    ),
    l2(
      "beauty-local-marketing-reviews",
      "beauty-service-operations",
      "Local Marketing Reviews And Referrals",
      60,
      "Manage Google Business Profile/local presence, social proof, reviews, referrals, email campaigns, promotions, and HubSpot/Mailchimp-style growth anchors.",
      ["explore"],
    ),
  ],
};

const TRADES_MAINTENANCE: BusinessCapabilityPerspective = {
  perspectiveId: "trades-maintenance",
  label: "Trades And Maintenance",
  source: "DPF trades/maintenance overlay informed by field-service dispatch, work-order lifecycle, customer ETA communications, truck stock, subcontractor/safety, and trades finance operating patterns",
  capabilities: [
    l1(
      "trades-field-service-operations",
      "Trades And Maintenance Operations",
      100,
      "Operate field-service work across inquiry intake, dispatch, technician readiness, work orders, customer updates, vehicle stock, subcontractors, and contract billing.",
      ["consume", "operate"],
    ),
    l2(
      "trades-job-intake-triage",
      "trades-field-service-operations",
      "Job Intake And Triage",
      10,
      "Capture job descriptions, urgency, property type, photos, notes, quote requests, emergency call-outs, and customer contact preferences.",
      ["consume"],
    ),
    l2(
      "trades-dispatch-technician-readiness",
      "trades-field-service-operations",
      "Dispatch And Technician Readiness",
      20,
      "Assign technicians or crews, schedule visits, check skills, tools, and parts readiness, and keep dispatcher queues current.",
      ["operate"],
    ),
    l2(
      "trades-work-order-lifecycle",
      "trades-field-service-operations",
      "Work Order Lifecycle",
      30,
      "Track planned maintenance, reactive repair, inspections, site notes, completion evidence, follow-up tasks, and status handoffs.",
      ["operate"],
    ),
    l2(
      "trades-customer-updates-eta",
      "trades-field-service-operations",
      "Customer Updates ETA And Exceptions",
      40,
      "Send appointment confirmations, on-my-way ETA updates, running-late notices, access instructions, and completion follow-ups across communication channels.",
      ["integrate", "operate"],
    ),
    l2(
      "trades-truck-stock-parts",
      "trades-field-service-operations",
      "Truck Stock Parts And Materials",
      50,
      "Track truck stock, parts usage, materials, tools, restock needs, purchasing, and job-to-inventory evidence.",
      ["operate"],
    ),
    l2(
      "trades-quotes-contracts-billing",
      "trades-field-service-operations",
      "Quotes Contracts And Billing Readiness",
      60,
      "Prepare quotes, maintenance contracts, labour and materials billing, purchase orders, deposits, VAT/tax posture, and collections evidence.",
      ["consume", "operate", "integrate"],
    ),
    l2(
      "trades-safety-compliance-subcontractors",
      "trades-field-service-operations",
      "Safety Compliance And Subcontractors",
      70,
      "Manage site safety, PPE, certificates, insurance, subcontractors, waste disposal, and regulated trade obligations.",
      ["operate"],
    ),
  ],
};

const FABRIC_CARE_SERVICES: BusinessCapabilityPerspective = {
  perspectiveId: "fabric-care-services",
  label: "Fabric Care Services",
  source: "DPF fabric-care overlay informed by dry-cleaning POS, claim-ticket custody, plant/workroom flow, ready notifications, pickup routes, and garment-care operating patterns",
  capabilities: [
    l1(
      "fabric-care-operations",
      "Fabric Care Operations",
      100,
      "Operate garment and textile care across intake, claim tickets, plant/workroom processing, pickup and delivery, customer notices, and account billing readiness.",
      ["consume", "operate"],
    ),
    l2(
      "fabric-care-intake-claim-ticket",
      "fabric-care-operations",
      "Intake Claim Ticket And Tagging",
      10,
      "Capture customer, garment count, care instructions, stains, existing damage, special handling, and claim-ticket/tag evidence at drop-off or pickup.",
      ["consume", "operate"],
    ),
    l2(
      "fabric-care-plant-workroom-flow",
      "fabric-care-operations",
      "Plant Workroom And Route Flow",
      20,
      "Coordinate dry cleaning, laundry, pressing, alterations, commercial account work, and route handoffs through the plant or satellite-store network.",
      ["operate"],
    ),
    l2(
      "fabric-care-ready-promise-notices",
      "fabric-care-operations",
      "Ready Promise Notices And Exceptions",
      30,
      "Track promised-ready dates, send ready notices, escalate delays, and keep customer communication attached to the ticket.",
      ["integrate", "operate"],
    ),
    l2(
      "fabric-care-garment-custody-exceptions",
      "fabric-care-operations",
      "Garment Custody Exceptions",
      40,
      "Handle missing, damaged, mixed, delayed, or ambiguous garments as custody exceptions with manager visibility and resolution evidence.",
      ["operate"],
    ),
    l2(
      "fabric-care-supplies-equipment",
      "fabric-care-operations",
      "Supplies Equipment And Plant Readiness",
      50,
      "Track cleaning chemistry, tags, hangers, bags, equipment maintenance, and consumable purchasing that protect ready promises.",
      ["operate"],
    ),
    l2(
      "fabric-care-pos-account-billing",
      "fabric-care-operations",
      "POS Account And Billing Readiness",
      60,
      "Prepare point-of-sale payment, route delivery charges, recurring laundry plans, commercial account billing, and reconciliation evidence.",
      ["consume", "operate", "integrate"],
    ),
  ],
};

const BIAN_BANKING_V14: BusinessCapabilityPerspective = {
  perspectiveId: "bian-banking-v14",
  label: "Banking (BIAN v14)",
  source:
    "BIAN Service Landscape v14.0 Value Chain View — docs/Reference/bian/bian-v14-service-landscape.json (curated SMB engagement-layer subset; L1=Business Area, L2=Business Domain, L3=Service Domain per the BIAN/CSDM v7.6 projection pattern)",
  capabilities: [
    // ── L1: BIAN Business Area "Customers" ─────────────────────────────────
    l1("bian-customers", "Customers", 200, "BIAN Business Area: acquire, know, serve, and grow customer relationships.", ["consume", "operate"]),
    l2("bian-relationship-management", "bian-customers", "Relationship Management", 10, "BIAN Business Domain: develop and maintain customer relationships, insight, and credit standing.", ["consume", "operate"]),
    l3("bian-customer-relationship-management", "bian-relationship-management", "Customer Relationship Management", 10, "Develops and executes a customer plan to maintain and build a customer relationship.", ["consume", "operate"]),
    l3("bian-customer-credit-rating", "bian-relationship-management", "Customer Credit Rating", 20, "Maintains and administers the bank's credit assessment for customers based on consolidated internal data and optionally external credit agency reports.", ["operate"]),
    l3("bian-customer-behavior-insights", "bian-relationship-management", "Customer Behavior Insights", 30, "Applies behavioral analysis to customer event history to maintain a range of customer ratings/scores.", ["explore"]),
    l2("bian-customer-care", "bian-customers", "Customer Care", 20, "BIAN Business Domain: handle customer servicing requests, cases, and contact.", ["consume", "operate"]),
    l3("bian-customer-case", "bian-customer-care", "Customer Case", 10, "Handles the initiation, tracking, resolution and reporting on customer cases.", ["operate"]),
    l3("bian-servicing-order", "bian-customer-care", "Servicing Order", 20, "Handles the processing of a customer servicing request as a predefined procedure.", ["operate"]),
    l2("bian-sales", "bian-customers", "Sales", 30, "BIAN Business Domain: offers, campaigns, leads, and party onboarding.", ["explore", "consume"]),
    l3("bian-customer-offer", "bian-sales", "Customer Offer", 10, "Orchestrates the processing of a product offer for a new or established customer.", ["consume"]),
    l3("bian-lead-opportunity-management", "bian-sales", "Lead and Opportunity Management", 20, "Captures, classifies and tracks sales leads/opportunities with established clients.", ["explore"]),
    l3("bian-party-lifecycle-management", "bian-sales", "Party Lifecycle Management", 30, "Tracks the state of a party relationship with the bank from the initial checks made during establishment — the membership/onboarding anchor.", ["consume", "operate"]),
    l2("bian-party-reference", "bian-customers", "Party Reference", 40, "BIAN Business Domain: canonical party and location reference data.", ["operate"]),
    l3("bian-party-reference-data-directory", "bian-party-reference", "Party Reference Data Directory", 10, "Maintains party reference information covering general reference details for customers and counterparties.", ["operate"]),

    // ── L1: BIAN Business Area "Products" ──────────────────────────────────
    l1("bian-products", "Products", 210, "BIAN Business Area: the deposit, lending, and card products the institution offers.", ["consume", "operate"]),
    l2("bian-loans-and-deposits", "bian-products", "Loans and Deposits", 10, "BIAN Business Domain: deposit and lending product fulfillment.", ["consume", "operate"]),
    l3("bian-savings-account", "bian-loans-and-deposits", "Savings Account", 10, "Orchestrates a consumer savings account including payments, deposits, interest, and fees.", ["operate"]),
    l3("bian-term-deposit", "bian-loans-and-deposits", "Term Deposit", 20, "An interest bearing account into which a customer places a fixed amount of funds for a fixed term — certificates of deposit / share certificates.", ["operate"]),
    l3("bian-consumer-loan", "bian-loans-and-deposits", "Consumer Loan", 30, "Handles the fulfillment of a consumer loan product including set-up and scheduled processing.", ["operate"]),
    l3("bian-mortgage-loan", "bian-loans-and-deposits", "Mortgage Loan", 40, "Fulfillment of a loan product for the purpose of property purchase.", ["operate"]),
    l3("bian-corporate-loan", "bian-loans-and-deposits", "Corporate Loan", 50, "Handles the fulfillment of a corporate loan product for business customers.", ["operate"]),
    l3("bian-underwriting", "bian-loans-and-deposits", "Underwriting", 60, "Manages the underwriting decision process for products as appropriate, including many loan types.", ["operate"]),
    l2("bian-consumer-banking", "bian-products", "Consumer Banking", 20, "BIAN Business Domain: everyday consumer banking facilities.", ["consume", "operate"]),
    l3("bian-current-account", "bian-consumer-banking", "Current Account", 10, "Orchestrates a consumer checking/demand deposit account with its range of services and fees.", ["operate"]),
    l3("bian-payment-order-initiation", "bian-consumer-banking", "Payment Order Initiation", 20, "Provides a customer payment service capturing payer and payee details and key payment properties.", ["consume"]),
    l2("bian-cards", "bian-products", "Cards", 30, "BIAN Business Domain: card products and servicing.", ["consume", "operate"]),
    l3("bian-credit-card", "bian-cards", "Credit Card", 10, "Orchestrates the scheduled maintenance and transactional activities associated with credit card products.", ["operate"]),

    // ── L1: BIAN Business Area "Operations" ────────────────────────────────
    l1("bian-operations", "Operations", 220, "BIAN Business Area: product and account back-office operations.", ["operate"]),
    l2("bian-accounting-services", "bian-operations", "Accounting Services", 10, "BIAN Business Domain: position keeping, customer positions, and reconciliation.", ["operate"]),
    l3("bian-position-keeping", "bian-accounting-services", "Position Keeping", 10, "Maintains a log of monetary or value transactions and entitlements posted to product facilities.", ["operate"]),
    l3("bian-customer-position", "bian-accounting-services", "Customer Position", 20, "Maintains a consolidated financial position for a customer, combining details from all products.", ["operate"]),
    l3("bian-account-reconciliation", "bian-accounting-services", "Account Reconciliation", 30, "Handles account reconciliation tasks.", ["operate"]),

    // ── L1: BIAN Business Area "Finance And Risk Management" ───────────────
    l1("bian-finance-risk", "Finance And Risk Management", 230, "BIAN Business Area: regulatory compliance and credit/fraud risk posture — where jurisdiction-specific regulatory governance attaches (spec §9.4).", ["operate"]),
    l2("bian-compliance", "bian-finance-risk", "Compliance", 10, "BIAN Business Domain: interpret regulatory requirements, test adherence, and report — anchors the install's jurisdiction/charter posture.", ["operate"]),
    l3("bian-regulatory-compliance", "bian-compliance", "Regulatory Compliance", 10, "Interprets regulatory requirements, provides guidance, and defines and implements compliance processes.", ["operate"]),
    l3("bian-guideline-compliance", "bian-compliance", "Guideline Compliance", 20, "Develops and applies a portfolio of guideline compliance tests to confirm adherence to bank and regulatory guidelines.", ["operate"]),
    l3("bian-regulatory-reporting", "bian-compliance", "Regulatory Reporting", 30, "Administers and orchestrates the tasks required to meet the institution's regulatory reporting obligations.", ["operate"]),
    l2("bian-credit-risk", "bian-finance-risk", "Credit Risk", 20, "BIAN Business Domain: credit qualification and fraud response.", ["operate"]),
    l3("bian-credit-management", "bian-credit-risk", "Credit Management", 10, "Provides a bank-wide oversight function to qualify credit pricing for offered products and services.", ["operate"]),
    l3("bian-fraud-resolution", "bian-credit-risk", "Fraud Resolution", 20, "Sets up and processes a fraud case resulting from fraud behavior detected during production.", ["operate"]),
  ],
};

function l1(
  key: string,
  name: string,
  sortOrder: number,
  description: string,
  it4itValueStreams: string[],
): BusinessCapabilitySeedDefinition {
  return {
    key,
    name,
    description,
    level: 1,
    sortOrder,
    currentMaturity: 1,
    targetMaturity: 3,
    it4itValueStreams,
  };
}

function l2(
  key: string,
  parentKey: string,
  name: string,
  sortOrder: number,
  description: string,
  it4itValueStreams: string[],
): BusinessCapabilitySeedDefinition {
  return {
    key,
    parentKey,
    name,
    description,
    level: 2,
    sortOrder,
    currentMaturity: 1,
    targetMaturity: 3,
    it4itValueStreams,
  };
}

function l3(
  key: string,
  parentKey: string,
  name: string,
  sortOrder: number,
  description: string,
  it4itValueStreams: string[],
): BusinessCapabilitySeedDefinition {
  return {
    key,
    parentKey,
    name,
    description,
    level: 3,
    sortOrder,
    currentMaturity: 1,
    targetMaturity: 3,
    it4itValueStreams,
  };
}

export function capabilityIdForSeedKey(key: string): string {
  return `${BUSINESS_CAPABILITY_SEED_PREFIX}${key}`;
}

export function resolveBusinessCapabilityPerspective(
  input: BusinessCapabilityPerspectiveInput,
): ResolvedBusinessCapabilityPerspective {
  const perspectives = [COMMON_SMALL_BUSINESS];

  if (input.archetypeId === "it-managed-services") {
    perspectives.push(IT_MANAGED_SERVICES);
  }

  if (input.category === "beauty-personal-care") {
    perspectives.push(BEAUTY_PERSONAL_CARE);
  }

  if (input.category === "trades-maintenance") {
    perspectives.push(TRADES_MAINTENANCE);
  }

  if (input.category === "fabric-care-services") {
    perspectives.push(FABRIC_CARE_SERVICES);
  }

  if (input.category === "banking-financial-services") {
    perspectives.push(BIAN_BANKING_V14);
  }

  return {
    sourcePerspectiveIds: perspectives.map((perspective) => perspective.perspectiveId),
    sources: perspectives.map((perspective) => ({
      perspectiveId: perspective.perspectiveId,
      label: perspective.label,
      source: perspective.source,
    })),
    capabilities: dedupeCapabilities(perspectives.flatMap((perspective) => perspective.capabilities)),
  };
}

export async function applyBusinessCapabilityPerspective(
  client: BusinessCapabilityStore,
  input: BusinessCapabilityPerspectiveInput,
): Promise<ApplyBusinessCapabilityPerspectiveResult> {
  const resolved = resolveBusinessCapabilityPerspective(input);
  const desiredIds = new Set(resolved.capabilities.map((capability) => capabilityIdForSeedKey(capability.key)));

  const existingSeedRows = await client.businessCapability.findMany({
    where: {
      capabilityId: { startsWith: BUSINESS_CAPABILITY_SEED_PREFIX },
      status: "active",
    },
    select: { id: true, capabilityId: true },
  });

  const idsByKey = new Map<string, string>();

  for (const capability of resolved.capabilities) {
    const parentId = capability.parentKey ? idsByKey.get(capability.parentKey) ?? null : null;
    if (capability.parentKey && !parentId) {
      throw new Error(`Parent capability ${capability.parentKey} must be projected before ${capability.key}`);
    }

    const record = await client.businessCapability.upsert({
      where: { capabilityId: capabilityIdForSeedKey(capability.key) },
      create: {
        capabilityId: capabilityIdForSeedKey(capability.key),
        name: capability.name,
        slug: capability.key,
        description: capability.description,
        level: capability.level,
        sortOrder: capability.sortOrder,
        status: "active",
        parentId,
        currentMaturity: capability.currentMaturity ?? 1,
        targetMaturity: capability.targetMaturity ?? 3,
        maturityRationale: capability.maturityRationale ?? null,
        it4itValueStreams: capability.it4itValueStreams ?? [],
      },
      update: {
        name: capability.name,
        slug: capability.key,
        description: capability.description,
        level: capability.level,
        sortOrder: capability.sortOrder,
        status: "active",
        parentId,
        it4itValueStreams: capability.it4itValueStreams ?? [],
      },
      select: { id: true, capabilityId: true },
    });

    idsByKey.set(capability.key, record.id);
  }

  const staleSeedIds = existingSeedRows
    .map((row) => row.capabilityId)
    .filter((capabilityId) => capabilityId.startsWith(BUSINESS_CAPABILITY_SEED_PREFIX))
    .filter((capabilityId) => !desiredIds.has(capabilityId));
  const deactivated = staleSeedIds.length > 0
    ? await client.businessCapability.updateMany({
      where: { capabilityId: { in: staleSeedIds } },
      data: { status: "inactive" },
    })
    : { count: 0 };

  return {
    sourcePerspectiveIds: resolved.sourcePerspectiveIds,
    appliedCount: resolved.capabilities.length,
    deactivatedCount: deactivated.count,
  };
}

export async function seedBusinessCapabilityPerspective(
  client: BusinessCapabilitySeedStore,
): Promise<ApplyBusinessCapabilityPerspectiveResult> {
  const storefront = await client.storefrontConfig.findFirst({
    select: {
      archetype: {
        select: { archetypeId: true, category: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return applyBusinessCapabilityPerspective(client, {
    archetypeId: storefront?.archetype?.archetypeId ?? null,
    category: storefront?.archetype?.category ?? null,
  });
}

function dedupeCapabilities(
  capabilities: BusinessCapabilitySeedDefinition[],
): BusinessCapabilitySeedDefinition[] {
  const seen = new Set<string>();
  const deduped: BusinessCapabilitySeedDefinition[] = [];

  for (const capability of capabilities) {
    if (seen.has(capability.key)) continue;
    seen.add(capability.key);
    deduped.push(capability);
  }

  return deduped;
}
