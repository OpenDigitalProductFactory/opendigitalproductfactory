import { CATEGORY_BUSINESS_CAPABILITY_PERSPECTIVES } from "./business-capability-category-corpus";

export { COVERED_BUSINESS_CAPABILITY_CATEGORIES } from "./business-capability-category-corpus";

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

export type BusinessCapabilityPerspective = {
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


export function capabilityIdForSeedKey(key: string): string {
  return `${BUSINESS_CAPABILITY_SEED_PREFIX}${key}`;
}

export function resolveBusinessCapabilityPerspective(
  input: BusinessCapabilityPerspectiveInput,
): ResolvedBusinessCapabilityPerspective {
  const perspectives = [COMMON_SMALL_BUSINESS];
  const categoryPerspective = input.category
    ? CATEGORY_BUSINESS_CAPABILITY_PERSPECTIVES[input.category]
    : undefined;

  if (categoryPerspective) {
    perspectives.push(categoryPerspective);
  }

  if (input.archetypeId === "it-managed-services") {
    perspectives.push(IT_MANAGED_SERVICES);
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
