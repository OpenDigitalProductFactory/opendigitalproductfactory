import { prisma } from "@dpf/db";

import type {
  CoworkerAuthorityBoundary,
  CoworkerAvailabilityScope,
  CoworkerCatalogRiskTier,
  CoworkerServiceStatus,
} from "./types";
import { hasExactCoworkerArchetypeDeclaration } from "./archetype-declarations";

type JsonRecord = Record<string, unknown>;

export type CoworkerCatalogRows = {
  services: CatalogServiceRow[];
  offers: CatalogOfferRow[];
  agents: CatalogAgentRow[];
  skills: CatalogSkillRow[];
  digitalProducts: CatalogDigitalProductRow[];
};

export type CatalogServiceRow = {
  serviceId: string;
  providerAgentId: string;
  name: string;
  summary: string | null;
  description: string | null;
  status: string;
  riskTier: string;
  hitlTier: number | null;
  authorityBoundary: string;
  availabilityScope: string;
  personas: unknown;
  portfolioRoles: unknown;
  valueStreams: unknown;
  archetypes: unknown;
  jurisdictions: unknown;
  requiredInputs: unknown;
  producedOutputs: unknown;
  backingSkillIds: unknown;
  backingToolNames: unknown;
  backingGrantKeys: unknown;
  costModel: unknown;
  contractTerms: unknown;
  dataBoundary: unknown;
  metadata: unknown;
  digitalProductId: string | null;
  serviceOfferingId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CatalogOfferRow = {
  offerId: string;
  serviceId: string;
  name: string;
  summary: string | null;
  description: string | null;
  status: string;
  version: string;
  providerOrganization: string | null;
  availabilityScope: string;
  riskTier: string;
  authorityBoundary: string;
  eligibleConsumers: unknown;
  budgetEnvelope: unknown;
  sla: unknown;
  requiredApprovals: unknown;
  legalTerms: unknown;
  dataBoundary: unknown;
  deliverables: unknown;
  filters: unknown;
  metadata: unknown;
  expiresAt: Date | null;
  digitalProductId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CatalogAgentRow = {
  agentId: string;
  displayName: string;
  name: string;
  kind: string;
  valueStream: string | null;
  hitlTierDefault: number;
  sensitivity: string;
  portfolio?: { slug: string; name: string } | null;
  toolGrants?: Array<{ grantKey: string }>;
};

export type CatalogSkillRow = {
  agentId: string;
  skillId: string;
  enabled: boolean;
  skill: {
    skillId: string;
    name: string;
    riskBand: string;
    allowedTools: string[];
  };
};

export type CatalogDigitalProductRow = {
  productId: string;
  name: string;
  portfolio?: { slug: string; name: string } | null;
};

export type CoworkerCatalog = {
  services: CoworkerServiceCatalogItem[];
  offers: CoworkerOfferCatalogItem[];
};

export type CoworkerProviderSummary = {
  agentId: string;
  displayName: string;
  kind: string;
  valueStream: string | null;
  hitlTierDefault: number;
  sensitivity: string;
  portfolio: { slug: string; name: string } | null;
};

export type CoworkerServiceCatalogItem = {
  serviceId: string;
  name: string;
  summary: string;
  description: string | null;
  status: CoworkerServiceStatus;
  riskTier: CoworkerCatalogRiskTier;
  hitlTier: number;
  authorityBoundary: CoworkerAuthorityBoundary;
  availabilityScope: CoworkerAvailabilityScope;
  personas: string[];
  portfolioRoles: string[];
  valueStreams: string[];
  archetypes: string[];
  jurisdictions: string[];
  requiredInputs: JsonRecord[];
  producedOutputs: JsonRecord[];
  costModel: JsonRecord;
  contractTerms: JsonRecord;
  dataBoundary: JsonRecord;
  metadata: JsonRecord;
  provider: CoworkerProviderSummary;
  backing: {
    skillIds: string[];
    toolNames: string[];
    grantKeys: string[];
  };
  digitalProduct: { productId: string; name: string; portfolio: { slug: string; name: string } | null } | null;
  serviceOfferingId: string | null;
};

export type CoworkerOfferCatalogItem = {
  offerId: string;
  serviceId: string;
  serviceName: string;
  name: string;
  summary: string;
  description: string | null;
  status: CoworkerServiceStatus;
  version: string;
  providerOrganization: string | null;
  availabilityScope: CoworkerAvailabilityScope;
  riskTier: CoworkerCatalogRiskTier;
  authorityBoundary: CoworkerAuthorityBoundary;
  eligibleConsumers: string[];
  budgetEnvelope: JsonRecord;
  sla: JsonRecord;
  requiredApprovals: JsonRecord[];
  legalTerms: JsonRecord;
  dataBoundary: JsonRecord;
  deliverables: string[];
  filters: JsonRecord;
  metadata: JsonRecord;
  expiresAt: string | null;
  provider: CoworkerProviderSummary;
  service: CoworkerServiceCatalogItem;
  digitalProduct: { productId: string; name: string; portfolio: { slug: string; name: string } | null } | null;
};

export type CoworkerOfferFilters = {
  query?: string;
  persona?: string;
  portfolioRole?: string;
  valueStream?: string;
  archetype?: string;
  jurisdiction?: string;
  riskTier?: string;
  availabilityScope?: string;
  artifact?: string;
};

export async function loadCoworkerCatalog(): Promise<CoworkerCatalog> {
  const [services, offers, agents, skills, digitalProducts] = await Promise.all([
    prisma.coworkerService.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }] }),
    prisma.coworkerOffer.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }] }),
    prisma.agent.findMany({
      where: { archived: false },
      include: { portfolio: { select: { slug: true, name: true } }, toolGrants: { select: { grantKey: true } } },
    }),
    prisma.skillAssignment.findMany({
      where: { enabled: true },
      include: { skill: { select: { skillId: true, name: true, riskBand: true, allowedTools: true } } },
    }),
    prisma.digitalProduct.findMany({
      include: { portfolio: { select: { slug: true, name: true } } },
    }),
  ]);

  return buildCoworkerCatalog({ services, offers, agents, skills, digitalProducts });
}

export function buildCoworkerCatalog(rows: CoworkerCatalogRows): CoworkerCatalog {
  const agentsById = new Map(rows.agents.map((agent) => [agent.agentId, agent]));
  const productsById = new Map(rows.digitalProducts.map((product) => [product.productId, product]));

  const services = rows.services.flatMap((service): CoworkerServiceCatalogItem[] => {
    const agent = agentsById.get(service.providerAgentId);
    if (!agent) return [];

    const explicitSkillIds = stringArray(service.backingSkillIds);
    const assignedSkills = rows.skills.filter((skill) => skill.agentId === agent.agentId && explicitSkillIds.includes(skill.skillId));
    const skillToolNames = assignedSkills.flatMap((skill) => skill.skill.allowedTools);
    const grantKeys = unique([...stringArray(service.backingGrantKeys), ...(agent.toolGrants ?? []).map((grant) => grant.grantKey)]);
    const product = service.digitalProductId ? productsById.get(service.digitalProductId) ?? null : null;

    return [
      {
        serviceId: service.serviceId,
        name: service.name,
        summary: service.summary ?? service.description ?? "",
        description: service.description,
        status: normalizeServiceStatus(service.status),
        riskTier: normalizeRiskTier(service.riskTier),
        hitlTier: service.hitlTier ?? agent.hitlTierDefault,
        authorityBoundary: normalizeAuthorityBoundary(service.authorityBoundary),
        availabilityScope: normalizeAvailabilityScope(service.availabilityScope),
        personas: stringArray(service.personas),
        portfolioRoles: stringArray(service.portfolioRoles),
        valueStreams: stringArray(service.valueStreams),
        archetypes: stringArray(service.archetypes),
        jurisdictions: stringArray(service.jurisdictions),
        requiredInputs: recordArray(service.requiredInputs),
        producedOutputs: recordArray(service.producedOutputs),
        costModel: record(service.costModel),
        contractTerms: record(service.contractTerms),
        dataBoundary: record(service.dataBoundary),
        metadata: record(service.metadata),
        provider: providerSummary(agent),
        backing: {
          skillIds: explicitSkillIds,
          toolNames: unique([...stringArray(service.backingToolNames), ...skillToolNames]),
          grantKeys,
        },
        digitalProduct: product ? productSummary(product) : null,
        serviceOfferingId: service.serviceOfferingId,
      },
    ];
  });

  const servicesById = new Map(services.map((service) => [service.serviceId, service]));
  const offers = rows.offers.flatMap((offer): CoworkerOfferCatalogItem[] => {
    const service = servicesById.get(offer.serviceId);
    if (!service) return [];
    const product = offer.digitalProductId
      ? productsById.get(offer.digitalProductId) ?? service.digitalProduct
      : service.digitalProduct;

    return [
      {
        offerId: offer.offerId,
        serviceId: offer.serviceId,
        serviceName: service.name,
        name: offer.name,
        summary: offer.summary ?? offer.description ?? "",
        description: offer.description,
        status: normalizeServiceStatus(offer.status),
        version: offer.version,
        providerOrganization: offer.providerOrganization,
        availabilityScope: normalizeAvailabilityScope(offer.availabilityScope),
        riskTier: normalizeRiskTier(offer.riskTier),
        authorityBoundary: normalizeAuthorityBoundary(offer.authorityBoundary),
        eligibleConsumers: stringArray(offer.eligibleConsumers),
        budgetEnvelope: record(offer.budgetEnvelope),
        sla: record(offer.sla),
        requiredApprovals: recordArray(offer.requiredApprovals),
        legalTerms: record(offer.legalTerms),
        dataBoundary: record(offer.dataBoundary),
        deliverables: stringArray(offer.deliverables),
        filters: record(offer.filters),
        metadata: record(offer.metadata),
        expiresAt: offer.expiresAt?.toISOString() ?? null,
        provider: service.provider,
        service,
        digitalProduct: product ? productSummary(product) : null,
      },
    ];
  });

  return { services, offers };
}

export function filterCoworkerOffers(
  offers: readonly CoworkerOfferCatalogItem[],
  filters: CoworkerOfferFilters,
): CoworkerOfferCatalogItem[] {
  const query = filters.query?.trim().toLowerCase();
  return offers.filter((offer) => {
    if (query && !`${offer.name} ${offer.summary} ${offer.provider.displayName} ${offer.serviceName}`.toLowerCase().includes(query)) return false;
    if (filters.persona && !offer.eligibleConsumers.includes(filters.persona)) return false;
    if (filters.portfolioRole && !offer.service.portfolioRoles.includes(filters.portfolioRole)) return false;
    if (filters.valueStream && !offer.service.valueStreams.includes(filters.valueStream)) return false;
    if (
      filters.archetype &&
      !hasExactCoworkerArchetypeDeclaration(offer.service.archetypes, filters.archetype)
    ) {
      return false;
    }
    if (filters.jurisdiction && !matchesStringOrArray(offer.filters.jurisdiction, filters.jurisdiction) && !offer.service.jurisdictions.includes(filters.jurisdiction)) return false;
    if (filters.riskTier && offer.riskTier !== filters.riskTier) return false;
    if (filters.availabilityScope && offer.availabilityScope !== filters.availabilityScope) return false;
    if (filters.artifact && offer.filters.artifact !== filters.artifact && !offer.deliverables.includes(filters.artifact)) return false;
    return true;
  });
}

function providerSummary(agent: CatalogAgentRow): CoworkerProviderSummary {
  return {
    agentId: agent.agentId,
    displayName: agent.displayName,
    kind: agent.kind,
    valueStream: agent.valueStream,
    hitlTierDefault: agent.hitlTierDefault,
    sensitivity: agent.sensitivity,
    portfolio: agent.portfolio ?? null,
  };
}

function productSummary(product: CatalogDigitalProductRow) {
  return {
    productId: product.productId,
    name: product.name,
    portfolio: product.portfolio ?? null,
  };
}

function normalizeServiceStatus(value: string): CoworkerServiceStatus {
  if (value === "active" || value === "retired") return value;
  return "draft";
}

function normalizeRiskTier(value: string): CoworkerCatalogRiskTier {
  if (value === "medium" || value === "high" || value === "critical") return value;
  return "low";
}

function normalizeAuthorityBoundary(value: string): CoworkerAuthorityBoundary {
  if (
    value === "proposal-only" ||
    value === "approval-required" ||
    value === "autonomous-allowed" ||
    value === "never-allowed"
  ) {
    return value;
  }
  return "advice-only";
}

function normalizeAvailabilityScope(value: string): CoworkerAvailabilityScope {
  if (value === "external" || value === "partner") return value;
  return "internal";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [];
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function recordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((entry): entry is JsonRecord => !!entry && typeof entry === "object" && !Array.isArray(entry)) : [];
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function matchesStringOrArray(value: unknown, expected: string): boolean {
  return value === expected || (Array.isArray(value) && value.includes(expected));
}
