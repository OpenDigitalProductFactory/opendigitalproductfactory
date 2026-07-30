import type { Prisma, PrismaClient } from "../generated/client/client";
import { AI_WORKFORCE_PRODUCT_ID } from "./workforce-portfolio";
import { MARKETING_CAMPAIGN_EXECUTION_TOOL_NAMES } from "./coworker-service-backing";

type CoworkerServiceSeed = {
  ownerAreaSlug:
    | "products_and_services_sold"
    | "for_employees"
    | "manufacturing_and_delivery"
    | "foundational";
  serviceId: string;
  providerAgentId: string;
  name: string;
  summary: string;
  description: string;
  status: string;
  riskTier: string;
  hitlTier: number;
  authorityBoundary: string;
  availabilityScope: string;
  personas: Prisma.InputJsonValue;
  portfolioRoles: Prisma.InputJsonValue;
  valueStreams: Prisma.InputJsonValue;
  archetypes: Prisma.InputJsonValue;
  jurisdictions: Prisma.InputJsonValue;
  requiredInputs: Prisma.InputJsonValue;
  producedOutputs: Prisma.InputJsonValue;
  backingSkillIds: Prisma.InputJsonValue;
  backingToolNames: Prisma.InputJsonValue;
  backingGrantKeys: Prisma.InputJsonValue;
  costModel: Prisma.InputJsonValue;
  contractTerms: Prisma.InputJsonValue;
  dataBoundary: Prisma.InputJsonValue;
  metadata: Prisma.InputJsonValue;
};

type CoworkerOfferSeed = {
  offerId: string;
  serviceId: string;
  name: string;
  summary: string;
  description: string;
  status: string;
  version: string;
  providerOrganization: string;
  availabilityScope: string;
  riskTier: string;
  authorityBoundary: string;
  eligibleConsumers: Prisma.InputJsonValue;
  budgetEnvelope: Prisma.InputJsonValue;
  sla: Prisma.InputJsonValue;
  requiredApprovals: Prisma.InputJsonValue;
  legalTerms: Prisma.InputJsonValue;
  dataBoundary: Prisma.InputJsonValue;
  deliverables: Prisma.InputJsonValue;
  filters: Prisma.InputJsonValue;
  metadata: Prisma.InputJsonValue;
};

const LEGACY_COWORKER_CATALOG_PRODUCT_ID = "dpf-portal";

export const COWORKER_SERVICE_CATALOG_SERVICE_SEEDS: readonly CoworkerServiceSeed[] = [
  serviceSeed("svc-build-sensitive-requirements", "build-specialist", {
    ownerAreaSlug: "foundational",
    name: "Build Studio sensitive-domain requirements broker",
    summary: "Routes regulated, paid-provider, and sensitive feature builds to the right specialist packet.",
    description:
      "Detects PCI, payroll, identity, provider-token, contract, and regulated-domain signals before implementation and emits bounded requirements for coding agents.",
    riskTier: "high",
    authorityBoundary: "requirements-gate",
    personas: ["builder", "product-owner", "coding-agent"],
    valueStreams: ["integrate"],
    requiredInputs: [{ key: "build-brief" }, { key: "design-doc" }, { key: "build-plan" }],
    producedOutputs: [{ key: "bounded-requirements-packet" }, { key: "specialist-routing" }],
    backingSkillIds: ["build-sensitive-domain-requirements"],
    backingToolNames: ["analyze_coworker_engagement_refinement"],
    backingGrantKeys: ["backlog_read", "architecture_read", "coworker_screen_read"],
    costModel: { pricing: "internal", metering: "per-build-trigger" },
    contractTerms: { posture: "internal-platform-control" },
    dataBoundary: { sensitivity: "confidential", retention: "build-evidence" },
    metadata: { aggregate: true, processMaturity: "codified" },
  }),
  serviceSeed("svc-compliance-pci-requirements", "compliance-officer", {
    ownerAreaSlug: "foundational",
    name: "PCI and regulated-control requirements",
    summary: "Translates compliance obligations into build acceptance criteria and evidence.",
    description:
      "Specialist packet for cardholder data, regulated operations, audit evidence, approval gates, and control ownership.",
    riskTier: "high",
    authorityBoundary: "proposal-only",
    personas: ["builder", "operator", "compliance-reviewer"],
    valueStreams: ["integrate", "operate"],
    requiredInputs: [{ key: "regulated-feature-scope" }, { key: "data-flow" }],
    producedOutputs: [{ key: "control-requirements" }, { key: "audit-evidence-plan" }],
    backingSkillIds: ["compliance-requirements-review"],
    backingToolNames: ["wiki_query", "create_backlog_item"],
    backingGrantKeys: ["policy_write", "data_governance_validate", "backlog_write"],
    costModel: { pricing: "internal", externalCost: "possible-assessor-or-provider-review" },
    contractTerms: { posture: "policy-and-audit-review-required" },
    dataBoundary: { sensitivity: "regulated", pii: "minimize", cardholderData: "no-storage-without-approved-pattern" },
    metadata: { triggerFamilies: ["pci-cardholder-data", "regulated-sensitive-domain"] },
  }),
  serviceSeed("svc-legal-counsel-packet", "legal-operations-counsel", {
    ownerAreaSlug: "foundational",
    name: "Legal and contract review packet",
    summary: "Prepares counsel-ready facts, questions, clauses, and risk notes.",
    description:
      "Internal legal operations coworker for contracts, terms, privacy clauses, supplier terms, and counsel handoff. It does not provide legal advice.",
    riskTier: "high",
    authorityBoundary: "proposal-only",
    personas: ["founder", "operator", "procurement"],
    valueStreams: ["cross-cutting"],
    requiredInputs: [{ key: "contract-or-terms" }, { key: "business-context" }],
    producedOutputs: [{ key: "counsel-packet" }, { key: "issue-list" }],
    backingSkillIds: ["prepare-counsel-packet"],
    backingToolNames: ["doc_search", "doc_save"],
    backingGrantKeys: ["document_read", "document_write", "registry_read"],
    costModel: { pricing: "internal", externalCost: "attorney-review-if-escalated" },
    contractTerms: { posture: "attorney-review-required-for-advice" },
    dataBoundary: { sensitivity: "confidential", privilegedMaterial: "segregate" },
    metadata: { legalRisk: "attorney-review-required" },
  }),
  serviceSeed("svc-finance-provider-cost-intake", "finance-controller", {
    ownerAreaSlug: "foundational",
    name: "Provider cost and purchasing intake",
    summary: "Captures paid provider, token, renewal, D&B, ADP, and subscription cost impacts.",
    description:
      "Budget and procurement coworker service for non-free dependencies introduced during feature definition or operations.",
    riskTier: "medium",
    authorityBoundary: "approval-required",
    personas: ["builder", "operator", "procurement"],
    valueStreams: ["integrate", "operate"],
    requiredInputs: [{ key: "provider-name" }, { key: "expected-usage" }, { key: "renewal-terms" }],
    producedOutputs: [{ key: "cost-record" }, { key: "approval-recommendation" }],
    backingSkillIds: ["provider-cost-intake"],
    backingToolNames: ["create_backlog_item"],
    backingGrantKeys: ["registry_read", "portfolio_read", "backlog_read"],
    costModel: { pricing: "internal", tracksExternalSpend: true },
    contractTerms: { posture: "finance-approval-before-production-use" },
    dataBoundary: { sensitivity: "confidential", financialData: true },
    metadata: { triggerFamilies: ["paid-provider-or-token", "contract-renewal-obligation"] },
  }),
  serviceSeed("svc-customer-sales-intake", "customer-advisor", {
    ownerAreaSlug: "products_and_services_sold",
    name: "Customer sales and service intake",
    summary: "External-facing customer inquiry, quote, support, and service-request triage.",
    description:
      "Customer-accessible AI coworker surface for authenticated external customers, with internal escalation to legal, finance, or fulfillment when needed.",
    riskTier: "medium",
    authorityBoundary: "proposal-only",
    availabilityScope: "external",
    personas: ["customer", "sales", "support"],
    valueStreams: ["consume"],
    requiredInputs: [{ key: "customer-intent" }, { key: "account-context" }],
    producedOutputs: [{ key: "qualified-request" }, { key: "escalation" }],
    backingSkillIds: ["customer-intake-triage"],
    backingToolNames: ["create_customer_case"],
    backingGrantKeys: ["consumer_read", "backlog_write"],
    costModel: { pricing: "included", metering: "per-customer-interaction" },
    contractTerms: { posture: "published-customer-terms" },
    dataBoundary: { sensitivity: "customer-confidential", externalSubject: "customer" },
    metadata: { externalInterface: true },
  }),
  serviceSeed("svc-marketing-partner-intake", "marketing-specialist", {
    ownerAreaSlug: "products_and_services_sold",
    name: "Marketing and campaign collaboration intake",
    summary: "External/partner-facing campaign, lead-source, and channel collaboration intake.",
    description:
      "Surface for customers or partners to request campaign collaboration while preserving approval, brand, consent, and data-use boundaries.",
    riskTier: "medium",
    authorityBoundary: "proposal-only",
    availabilityScope: "external",
    personas: ["customer", "partner", "marketing"],
    valueStreams: ["consume"],
    requiredInputs: [{ key: "campaign-goal" }, { key: "audience" }, { key: "consent-context" }],
    producedOutputs: [{ key: "campaign-brief" }, { key: "approval-checklist" }],
    backingSkillIds: ["marketing-collaboration-intake"],
    backingToolNames: ["create_backlog_item"],
    backingGrantKeys: ["marketing_read", "marketing_write", "consumer_read"],
    costModel: { pricing: "included", externalCost: "ad-spend-if-approved" },
    contractTerms: { posture: "brand-and-consent-review-required" },
    dataBoundary: { sensitivity: "customer-confidential", consentRequired: true },
    metadata: { externalInterface: true },
  }),
  serviceSeed("svc-external-provider-scout", "external-catalog-scout", {
    ownerAreaSlug: "foundational",
    name: "External provider and MCP catalog scout",
    summary: "Researches external AI coworkers, MCP servers, providers, and authority data sources for governed adoption.",
    description:
      "Specialist scout for D&B-style authority feeds, payroll providers, MCP tools, and other paid or external capabilities before onboarding.",
    riskTier: "medium",
    authorityBoundary: "proposal-only",
    personas: ["operator", "builder", "procurement"],
    valueStreams: ["explore", "integrate"],
    requiredInputs: [{ key: "capability-gap" }, { key: "provider-candidates" }],
    producedOutputs: [{ key: "tool-evaluation-candidate" }, { key: "adoption-risks" }],
    backingSkillIds: ["external-catalog-scout"],
    backingToolNames: ["create_backlog_item", "wiki_query"],
    backingGrantKeys: ["backlog_read", "backlog_write", "registry_read"],
    costModel: { pricing: "internal", externalCost: "provider-dependent" },
    contractTerms: { posture: "tool-evaluation-required-before-adoption" },
    dataBoundary: { sensitivity: "public-to-confidential", supplierData: true },
    metadata: { triggerFamilies: ["external-authority-data", "mcp-provider-adoption"] },
  }),
  // Internal marketing-execution services (EP-MARKETING-EXEC, BI-4C5F7A2D):
  // make the Marketing Strategist's execution capabilities discoverable in the
  // coworker catalog and projectable to internal A2A agent cards, the same way
  // build/compliance/legal specialists are registered. Internal scope → no
  // GAID/AIDoc required. backingToolNames cover every marketing-pack tool (a
  // drift-guard test asserts the union stays complete).
  serviceSeed("svc-marketing-campaign-execution", "marketing-specialist", {
    ownerAreaSlug: "products_and_services_sold",
    name: "Marketing campaign execution",
    summary: "Establishes and runs a campaign end to end: plan, brief, tracked links, content calendar, and cross-channel performance.",
    description:
      "The Marketing Strategist's execution surface — create/update a campaign aggregate, attach briefs and asset tasks, mint UTM tracked links, read the editorial content calendar, and roll up measured cross-channel performance against budget and KPI targets.",
    riskTier: "low",
    authorityBoundary: "autonomous-allowed",
    personas: ["marketing", "strategist", "operator"],
    valueStreams: ["consume"],
    archetypes: ["food-hospitality"],
    requiredInputs: [{ key: "business-context" }, { key: "campaign-goal" }],
    producedOutputs: [{ key: "campaign-plan" }, { key: "content-calendar" }, { key: "performance-rollup" }],
    backingToolNames: [...MARKETING_CAMPAIGN_EXECUTION_TOOL_NAMES],
    backingGrantKeys: ["marketing_read", "marketing_write"],
    costModel: { pricing: "internal", metering: "per-campaign" },
    contractTerms: { posture: "internal", approvalGate: "human-approval-before-external-publish" },
    dataBoundary: { sensitivity: "internal" },
    metadata: {
      aggregate: true,
      family: "marketing-execution",
      readinessProbe: {
        taskType: "tool-action",
        prompt:
          "Create a draft marketing campaign for a restaurant promotion using the campaign tools.",
        requiresToolUse: true,
      },
    },
  }),
  serviceSeed("svc-marketing-ab-testing", "marketing-specialist", {
    ownerAreaSlug: "products_and_services_sold",
    name: "Marketing A/B variant testing",
    summary: "Creates competing copy variants for an asset, records measured results, and recommends a statistically-guarded winner.",
    description:
      "Produce and compare multiple copy treatments per asset task; record impressions/clicks/conversions per variant; get a ranked winner recommendation by conversions-per-impression with a minimum-sample guard so noise is never crowned.",
    riskTier: "low",
    authorityBoundary: "autonomous-allowed",
    personas: ["marketing", "strategist"],
    valueStreams: ["consume"],
    requiredInputs: [{ key: "asset-task" }],
    producedOutputs: [{ key: "variant-set" }, { key: "winner-recommendation" }],
    backingToolNames: ["create_asset_variant", "record_variant_result", "get_asset_variants"],
    backingGrantKeys: ["marketing_read", "marketing_write"],
    costModel: { pricing: "internal", metering: "per-variant" },
    contractTerms: { posture: "internal" },
    dataBoundary: { sensitivity: "internal" },
    metadata: { family: "marketing-execution" },
  }),
  serviceSeed("svc-marketing-competitive-intelligence", "marketing-specialist", {
    ownerAreaSlug: "products_and_services_sold",
    name: "Product competitive intelligence",
    summary: "Proposes governed product research, maintains durable battlecards, and projects a competitive matrix.",
    description:
      "Create operator-reviewable research proposals before external evidence collection, then turn reviewed findings into durable battlecards and a reusable competitive matrix.",
    riskTier: "low",
    authorityBoundary: "autonomous-allowed",
    personas: ["marketing", "strategist", "product-owner"],
    valueStreams: ["consume"],
    requiredInputs: [{ key: "competitor-or-research-question" }],
    producedOutputs: [
      { key: "research-proposal" },
      { key: "battlecard" },
      { key: "competitive-matrix" },
    ],
    backingToolNames: [
      "propose_product_research",
      "create_battlecard",
      "get_battlecards",
    ],
    backingGrantKeys: ["marketing_read", "marketing_write"],
    costModel: { pricing: "internal", metering: "per-battlecard" },
    contractTerms: { posture: "internal" },
    dataBoundary: { sensitivity: "internal" },
    metadata: { family: "marketing-execution" },
  }),
];

export const COWORKER_SERVICE_CATALOG_OFFER_SEEDS: readonly CoworkerOfferSeed[] = [
  offerSeed("offer-build-sensitive-domain-requirements", "svc-build-sensitive-requirements", {
    name: "Sensitive-domain build requirements packet",
    summary: "Bounded requirements packet for coding agents when a feature touches PCI, payroll, paid providers, or regulated domains.",
    riskTier: "high",
    authorityBoundary: "requirements-gate",
    eligibleConsumers: ["build-studio", "coding-agent", "review-agent"],
    deliverables: ["Requirements packet", "Specialist routing list", "Acceptance criteria"],
    filters: { triggerFamilies: ["pci-cardholder-data", "payroll-provider", "paid-provider-or-token"] },
  }),
  offerSeed("offer-pci-control-requirements", "svc-compliance-pci-requirements", {
    name: "PCI control requirements review",
    summary: "Compliance requirements for features that touch payment cards, tokens, checkout, or cardholder data.",
    riskTier: "high",
    eligibleConsumers: ["builder", "operator", "compliance-reviewer"],
    requiredApprovals: [{ type: "compliance-review", required: true }],
    deliverables: ["Control checklist", "Evidence plan", "Forbidden implementation patterns"],
    filters: { jurisdiction: ["us", "global"], domain: "pci" },
  }),
  offerSeed("offer-legal-contract-packet", "svc-legal-counsel-packet", {
    name: "Legal contract and counsel packet",
    summary: "Internal packet for terms, supplier contracts, privacy clauses, or policy-sensitive activity before counsel review.",
    riskTier: "high",
    eligibleConsumers: ["operator", "procurement", "finance", "builder"],
    requiredApprovals: [{ type: "attorney-review", required: true }],
    deliverables: ["Counsel packet", "Issue list", "Clause and source inventory"],
    filters: { artifact: "contract-or-terms", jurisdiction: ["us", "global"] },
  }),
  offerSeed("offer-provider-cost-intake", "svc-finance-provider-cost-intake", {
    name: "Paid provider and token cost intake",
    summary: "Finance/procurement intake when a feature needs D&B, ADP, provider tokens, subscriptions, or non-free services.",
    riskTier: "medium",
    authorityBoundary: "approval-required",
    eligibleConsumers: ["builder", "operator", "procurement", "finance"],
    requiredApprovals: [{ type: "finance-approval", required: true }],
    deliverables: ["Cost record", "Approval path", "Renewal tracking notes"],
    filters: { triggerFamilies: ["paid-provider-or-token", "contract-renewal-obligation"] },
  }),
  externalOfferSeed("offer-customer-sales-intake", "svc-customer-sales-intake", "customer-advisor", {
    name: "Customer sales and service intake",
    summary: "Authenticated customer-facing intake for inquiries, quotes, cases, and service requests.",
    eligibleConsumers: ["authenticated-customer", "sales", "support"],
    deliverables: ["Qualified request", "Suggested next action", "Escalation path"],
    filters: { exposure: "external", channel: "customer" },
  }),
  externalOfferSeed("offer-marketing-partner-intake", "svc-marketing-partner-intake", "marketing-specialist", {
    name: "Marketing partner collaboration intake",
    summary: "Authenticated external/partner intake for campaign collaboration, lead-source requests, and channel coordination.",
    eligibleConsumers: ["authenticated-customer", "partner", "marketing"],
    deliverables: ["Campaign brief", "Consent checklist", "Approval path"],
    filters: { exposure: "external", channel: "marketing" },
  }),
  offerSeed("offer-external-provider-scout", "svc-external-provider-scout", {
    name: "External provider and MCP scout pass",
    summary: "Research and governed intake for external providers, authority data sources, MCP tools, and paid AI capabilities.",
    riskTier: "medium",
    eligibleConsumers: ["operator", "builder", "procurement"],
    deliverables: ["Provider comparison", "Tool evaluation candidate", "Cost and contract risks"],
    filters: { domain: "external-provider-adoption" },
  }),
  // Internal marketing-execution offers (EP-MARKETING-EXEC, BI-4C5F7A2D).
  offerSeed("offer-marketing-campaign-execution", "svc-marketing-campaign-execution", {
    name: "Campaign execution and measurement",
    summary: "Plan, produce, and measure a marketing campaign end to end — brief, tracked links, content calendar, and cross-channel performance.",
    eligibleConsumers: ["marketing", "operator", "product"],
    deliverables: ["Campaign plan", "Content calendar", "Cross-channel performance rollup"],
    filters: { domain: "marketing-execution", family: "campaign" },
  }),
  offerSeed("offer-marketing-ab-testing", "svc-marketing-ab-testing", {
    name: "A/B variant testing",
    summary: "Create competing copy variants, record results, and get a guarded winner recommendation.",
    eligibleConsumers: ["marketing", "product"],
    deliverables: ["Variant set", "Per-variant performance", "Winner recommendation"],
    filters: { domain: "marketing-execution", family: "experimentation" },
  }),
  offerSeed("offer-marketing-competitive-intelligence", "svc-marketing-competitive-intelligence", {
    name: "Competitive battlecards",
    summary: "Durable per-competitor battlecards and a competitive matrix for positioning.",
    eligibleConsumers: ["marketing", "product", "operator"],
    deliverables: ["Battlecard", "Competitive matrix"],
    filters: { domain: "marketing-execution", family: "competitive" },
  }),
];

export async function seedCoworkerServiceCatalog(prisma: PrismaClient): Promise<void> {
  const ownerAreaSlugs = [
    ...new Set(
      COWORKER_SERVICE_CATALOG_SERVICE_SEEDS.map(
        (service) => service.ownerAreaSlug,
      ),
    ),
  ];
  const ownerAreas = await prisma.portfolio.findMany({
    where: { slug: { in: ownerAreaSlugs } },
    select: { id: true, slug: true },
  });
  const ownerAreaIdBySlug = new Map(
    ownerAreas.map((portfolio) => [portfolio.slug, portfolio.id]),
  );
  const missingOwnerAreas = ownerAreaSlugs.filter(
    (slug) => !ownerAreaIdBySlug.has(slug),
  );
  if (missingOwnerAreas.length > 0) {
    throw new Error(
      `Coworker service owner areas are missing: ${missingOwnerAreas.join(", ")}`,
    );
  }

  for (const service of COWORKER_SERVICE_CATALOG_SERVICE_SEEDS) {
    const portfolioId = ownerAreaIdBySlug.get(service.ownerAreaSlug)!;
    const { ownerAreaSlug: _ownerAreaSlug, ...serviceData } = service;
    await prisma.coworkerService.upsert({
      where: { serviceId: service.serviceId },
      create: { ...serviceData, portfolioId },
      update: serviceUpdate(service, portfolioId),
    });
  }

  await prisma.coworkerService.updateMany({
    where: {
      serviceId: { in: COWORKER_SERVICE_CATALOG_SERVICE_SEEDS.map((service) => service.serviceId) },
      archetypes: { equals: ["software-and-platforms"] },
    },
    data: { archetypes: [] },
  });

  await prisma.coworkerService.updateMany({
    where: {
      serviceId: "svc-marketing-campaign-execution",
      archetypes: { equals: [] },
    },
    data: { archetypes: ["food-hospitality"] },
  });

  await prisma.coworkerService.updateMany({
    where: {
      serviceId: { in: COWORKER_SERVICE_CATALOG_SERVICE_SEEDS.map((service) => service.serviceId) },
      digitalProductId: LEGACY_COWORKER_CATALOG_PRODUCT_ID,
    },
    data: { digitalProductId: null },
  });

  for (const offer of COWORKER_SERVICE_CATALOG_OFFER_SEEDS) {
    await prisma.coworkerOffer.upsert({
      where: { offerId: offer.offerId },
      create: { ...offer, digitalProductId: AI_WORKFORCE_PRODUCT_ID },
      update: offer,
    });
  }

  await prisma.coworkerOffer.updateMany({
    where: {
      offerId: { in: COWORKER_SERVICE_CATALOG_OFFER_SEEDS.map((offer) => offer.offerId) },
      digitalProductId: LEGACY_COWORKER_CATALOG_PRODUCT_ID,
    },
    data: { digitalProductId: AI_WORKFORCE_PRODUCT_ID },
  });
}

function serviceUpdate({
  archetypes: _archetypes,
  ownerAreaSlug: _ownerAreaSlug,
  ...update
}: CoworkerServiceSeed, portfolioId: string) {
  return { ...update, portfolioId };
}

function serviceSeed(
  serviceId: string,
  providerAgentId: string,
  overrides: Partial<Omit<CoworkerServiceSeed, "ownerAreaSlug">> &
    Pick<CoworkerServiceSeed, "ownerAreaSlug">,
): CoworkerServiceSeed {
  return {
    ownerAreaSlug: overrides.ownerAreaSlug,
    serviceId,
    providerAgentId,
    name: overrides.name ?? serviceId,
    summary: overrides.summary ?? "",
    description: overrides.description ?? "",
    status: overrides.status ?? "active",
    riskTier: overrides.riskTier ?? "low",
    hitlTier: overrides.hitlTier ?? 2,
    authorityBoundary: overrides.authorityBoundary ?? "proposal-only",
    availabilityScope: overrides.availabilityScope ?? "internal",
    personas: overrides.personas ?? [],
    portfolioRoles: overrides.portfolioRoles ?? ["workforce"],
    valueStreams: overrides.valueStreams ?? ["cross-cutting"],
    archetypes: overrides.archetypes ?? [],
    jurisdictions: overrides.jurisdictions ?? ["us", "global"],
    requiredInputs: overrides.requiredInputs ?? [],
    producedOutputs: overrides.producedOutputs ?? [],
    backingSkillIds: overrides.backingSkillIds ?? [],
    backingToolNames: overrides.backingToolNames ?? [],
    backingGrantKeys: overrides.backingGrantKeys ?? [],
    costModel: overrides.costModel ?? { pricing: "internal" },
    contractTerms: overrides.contractTerms ?? { posture: "internal" },
    dataBoundary: overrides.dataBoundary ?? { sensitivity: "internal" },
    metadata: overrides.metadata ?? {},
  };
}

function offerSeed(
  offerId: string,
  serviceId: string,
  overrides: Partial<CoworkerOfferSeed>,
): CoworkerOfferSeed {
  return {
    offerId,
    serviceId,
    name: overrides.name ?? offerId,
    summary: overrides.summary ?? "",
    description: overrides.description ?? overrides.summary ?? "",
    status: overrides.status ?? "active",
    version: overrides.version ?? "1.0.0",
    providerOrganization: overrides.providerOrganization ?? "Digital Product Factory",
    availabilityScope: overrides.availabilityScope ?? "internal",
    riskTier: overrides.riskTier ?? "low",
    authorityBoundary: overrides.authorityBoundary ?? "proposal-only",
    eligibleConsumers: overrides.eligibleConsumers ?? [],
    budgetEnvelope: overrides.budgetEnvelope ?? { estimate: "internal-budget", approval: "owner" },
    sla: overrides.sla ?? { response: "1 business day" },
    requiredApprovals: overrides.requiredApprovals ?? [],
    legalTerms: overrides.legalTerms ?? { posture: "internal-use" },
    dataBoundary: overrides.dataBoundary ?? { sensitivity: "internal" },
    deliverables: overrides.deliverables ?? [],
    filters: overrides.filters ?? {},
    metadata: overrides.metadata ?? {},
  };
}

function externalOfferSeed(
  offerId: string,
  serviceId: string,
  providerAgentId: string,
  overrides: Partial<CoworkerOfferSeed>,
): CoworkerOfferSeed {
  return offerSeed(offerId, serviceId, {
    ...overrides,
    availabilityScope: "external",
    riskTier: overrides.riskTier ?? "medium",
    authorityBoundary: overrides.authorityBoundary ?? "proposal-only",
    legalTerms: {
      posture: "published-external-terms",
      consentRequired: true,
    },
    dataBoundary: {
      sensitivity: "customer-confidential",
      externalSubject: true,
      retention: "published-policy",
    },
    metadata: {
      ...(typeof overrides.metadata === "object" && !Array.isArray(overrides.metadata) ? overrides.metadata : {}),
      gaid: `gaid:public:dpf:${providerAgentId}`,
      aidocRef: `aidoc://dpf/public/${providerAgentId}/${offerId}`,
      gaidAuthority: {
        state: "verified",
        exposure: "public",
        subjectAgentId: providerAgentId,
        verifiedAt: "2026-06-30T00:00:00.000Z",
        expiresAt: "2027-06-30T00:00:00.000Z",
      },
    },
  });
}
