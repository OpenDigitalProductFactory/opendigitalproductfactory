// Coworker service catalog tool pack.
//
// Owns the human/model-facing discovery and engagement request tools for
// coworker services/offers. The tools stay in a scoped pack so mcp-tools.ts
// remains a composition layer instead of growing the frozen inline switch.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "list_coworker_services",
    description: "List AI coworker service capabilities with provider, risk, authority, persona, and execution backing.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional text search." },
        providerAgentId: { type: "string", description: "Optional provider coworker id." },
        riskTier: { type: "string", description: "Optional risk tier." },
        availabilityScope: { type: "string", description: "Optional availability scope." },
        limit: { type: "number", description: "Max rows (default 25, max 100)." },
      },
      required: [],
    },
    requiredCapability: "view_platform",
    sideEffect: false,
  },
  {
    name: "list_coworker_offers",
    description: "List packaged AI coworker offers for discovery and engagement planning.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional text search." },
        persona: { type: "string", description: "Optional consumer persona." },
        portfolioRole: { type: "string", description: "Optional portfolio role." },
        valueStream: { type: "string", description: "Optional IT4IT value stream." },
        archetype: { type: "string", description: "Optional archetype filter." },
        jurisdiction: { type: "string", description: "Optional jurisdiction filter." },
        riskTier: { type: "string", description: "Optional risk tier." },
        availabilityScope: { type: "string", description: "Optional availability scope." },
        artifact: { type: "string", description: "Optional required artifact or deliverable." },
        limit: { type: "number", description: "Max rows (default 25, max 100)." },
      },
      required: [],
    },
    requiredCapability: "view_platform",
    sideEffect: false,
  },
  {
    name: "get_coworker_offer",
    description: "Get one coworker offer with service, provider, authority, funding, terms, and deliverables.",
    inputSchema: {
      type: "object",
      properties: {
        offerId: { type: "string", description: "Coworker offer id." },
      },
      required: ["offerId"],
    },
    requiredCapability: "view_platform",
    sideEffect: false,
  },
  {
    name: "request_coworker_engagement",
    description: "Create a governed request to engage a coworker offer. High-risk or external offers return approval requirements.",
    inputSchema: {
      type: "object",
      properties: {
        offerId: { type: "string", description: "Coworker offer id." },
        requestedOutcome: { type: "string", description: "Desired outcome." },
        requestedForPersona: { type: "string", description: "Optional consumer persona." },
        priority: { type: "string", description: "Optional priority." },
        inputPayload: { type: "object", description: "Inputs for the provider coworker." },
        fundingContext: { type: "object", description: "Budget or funding context." },
        contractContext: { type: "object", description: "Terms and data-boundary context." },
        metadata: { type: "object", description: "Additional engagement metadata." },
      },
      required: ["offerId", "requestedOutcome"],
    },
    requiredCapability: "view_platform",
    sideEffect: true,
    coworkerArtifact: true,
  },
];

async function listCoworkerServices(params: Record<string, unknown>): Promise<ToolResult> {
  const { loadCoworkerCatalog } = await import("@/lib/coworker-service-catalog/catalog");
  const catalog = await loadCoworkerCatalog();
  const query = typeof params["query"] === "string" ? params["query"].trim().toLowerCase() : "";
  const providerAgentId = typeof params["providerAgentId"] === "string" ? params["providerAgentId"].trim() : "";
  const riskTier = typeof params["riskTier"] === "string" ? params["riskTier"].trim() : "";
  const availabilityScope = typeof params["availabilityScope"] === "string" ? params["availabilityScope"].trim() : "";
  const take = typeof params["limit"] === "number" ? Math.min(Math.max(1, params["limit"]), 100) : 25;
  const services = catalog.services
    .filter((service) => !query || `${service.name} ${service.summary} ${service.provider.displayName}`.toLowerCase().includes(query))
    .filter((service) => !providerAgentId || service.provider.agentId === providerAgentId)
    .filter((service) => !riskTier || service.riskTier === riskTier)
    .filter((service) => !availabilityScope || service.availabilityScope === availabilityScope)
    .slice(0, take);
  const lines = services.map((service) =>
    `${service.name} (${service.serviceId}) - ${service.provider.displayName} - ${service.riskTier} - ${service.authorityBoundary}`,
  );
  return {
    success: true,
    message: services.length ? `${services.length} coworker service(s):\n${lines.join("\n")}` : "No coworker services matched.",
    data: { services },
  };
}

async function listCoworkerOffers(params: Record<string, unknown>): Promise<ToolResult> {
  const { filterCoworkerOffers, loadCoworkerCatalog } = await import("@/lib/coworker-service-catalog/catalog");
  const catalog = await loadCoworkerCatalog();
  const take = typeof params["limit"] === "number" ? Math.min(Math.max(1, params["limit"]), 100) : 25;
  const offers = filterCoworkerOffers(catalog.offers, {
    query: typeof params["query"] === "string" ? params["query"] : undefined,
    persona: typeof params["persona"] === "string" ? params["persona"] : undefined,
    portfolioRole: typeof params["portfolioRole"] === "string" ? params["portfolioRole"] : undefined,
    valueStream: typeof params["valueStream"] === "string" ? params["valueStream"] : undefined,
    archetype: typeof params["archetype"] === "string" ? params["archetype"] : undefined,
    jurisdiction: typeof params["jurisdiction"] === "string" ? params["jurisdiction"] : undefined,
    riskTier: typeof params["riskTier"] === "string" ? params["riskTier"] : undefined,
    availabilityScope: typeof params["availabilityScope"] === "string" ? params["availabilityScope"] : undefined,
    artifact: typeof params["artifact"] === "string" ? params["artifact"] : undefined,
  }).slice(0, take);
  const lines = offers.map((offer) =>
    `${offer.name} (${offer.offerId}) - ${offer.provider.displayName} - ${offer.riskTier} - ${offer.authorityBoundary}`,
  );
  return {
    success: true,
    message: offers.length ? `${offers.length} coworker offer(s):\n${lines.join("\n")}` : "No coworker offers matched.",
    data: { offers },
  };
}

async function getCoworkerOffer(params: Record<string, unknown>): Promise<ToolResult> {
  const offerId = typeof params["offerId"] === "string" ? params["offerId"].trim() : "";
  if (!offerId) return { success: false, error: "missing_offerId", message: "offerId is required." };
  const { loadCoworkerCatalog } = await import("@/lib/coworker-service-catalog/catalog");
  const catalog = await loadCoworkerCatalog();
  const offer = catalog.offers.find((candidate) => candidate.offerId === offerId);
  if (!offer) return { success: false, error: "not_found", message: `Coworker offer ${offerId} not found.` };
  return {
    success: true,
    message: `${offer.name} - ${offer.provider.displayName} - ${offer.riskTier} - ${offer.authorityBoundary}`,
    data: { offer },
  };
}

async function requestCoworkerEngagement(
  params: Record<string, unknown>,
  userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const offerId = typeof params["offerId"] === "string" ? params["offerId"].trim() : "";
  const requestedOutcome = typeof params["requestedOutcome"] === "string" ? params["requestedOutcome"].trim() : "";
  if (!offerId || !requestedOutcome) {
    return { success: false, error: "missing_fields", message: "offerId and requestedOutcome are required." };
  }
  const { createCoworkerEngagement } = await import("@/lib/coworker-service-catalog/engagements");
  try {
    const engagement = await createCoworkerEngagement({
      offerId,
      requestedOutcome,
      requestedByUserId: userId,
      requestedByAgentId: context?.agentId ?? null,
      requestedForPersona: typeof params["requestedForPersona"] === "string" ? params["requestedForPersona"] : null,
      priority: typeof params["priority"] === "string" ? params["priority"] : undefined,
      inputPayload: params["inputPayload"] ?? {},
      fundingContext: params["fundingContext"] ?? {},
      contractContext: typeof params["contractContext"] === "object" && params["contractContext"] !== null ? params["contractContext"] as Record<string, unknown> : null,
      metadata: params["metadata"] ?? {},
    });
    return {
      success: true,
      message: engagement.approvalContext.required
        ? `Created engagement ${engagement.engagementId}; approval is required before execution.`
        : `Created engagement ${engagement.engagementId}.`,
      data: { engagement },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: "engagement_failed", message: msg };
  }
}

export const coworkerServiceCatalogPack: ToolPack = {
  packId: "coworker-service-catalog",
  definitions,
  handlers: {
    list_coworker_services: (params) => listCoworkerServices(params),
    list_coworker_offers: (params) => listCoworkerOffers(params),
    get_coworker_offer: (params) => getCoworkerOffer(params),
    request_coworker_engagement: (params, userId, context) =>
      requestCoworkerEngagement(params, userId, context),
  },
  grants: {
    list_coworker_services: ["coworker_catalog_read"],
    list_coworker_offers: ["coworker_catalog_read"],
    get_coworker_offer: ["coworker_catalog_read"],
    request_coworker_engagement: ["coworker_engagement_write"],
  },
};
