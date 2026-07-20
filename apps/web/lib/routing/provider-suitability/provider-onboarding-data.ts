import { prisma } from "@dpf/db";
import { buildProviderOnboardingRecommendation, resolveRuntimeConnectionStatus } from "./onboarding-recommendation";
import { resolveProviderTrustFacts } from "./provider-trust";
import type {
  BusinessSuitabilityProfile,
  ProviderCatalogTrustFacts,
  ProviderConnectionPosture,
} from "./types";
import { isEeaState } from "@dpf/db/eu-jurisdictions";
import { parseOrgAddress } from "@/lib/shared/org-address";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function catalogFacts(provider: {
  providerId: string;
  category: string;
  endpointType: string;
  catalogEntry: unknown;
}): ProviderCatalogTrustFacts {
  const entry = record(provider.catalogEntry);
  const trust = record(entry.trustCatalog);
  const local = provider.providerId === "local" || provider.providerId === "ollama" || provider.category === "local";
  const category = ["direct", "router", "local", "self-hosted"].includes(String(trust.category))
    ? trust.category as ProviderCatalogTrustFacts["category"]
    : local ? "local" : provider.category === "router" ? "router" : "direct";
  const externalEgress = ["none", "provider-cloud", "router-cloud", "self-hosted-network", "unknown"].includes(String(trust.externalEgress))
    ? trust.externalEgress as ProviderCatalogTrustFacts["externalEgress"]
    : local ? "none" : "unknown";
  const regionalEndpoints = Array.isArray(trust.regionalEndpoints)
    ? trust.regionalEndpoints.flatMap((value) => {
        const item = record(value);
        return typeof item.region === "string" && typeof item.baseUrl === "string"
          ? [{ region: item.region, baseUrl: item.baseUrl, requiresEnterpriseEnablement: item.requiresEnterpriseEnablement === true }]
          : [];
      })
    : [];
  const routerPassThroughRaw = record(trust.routerPassThrough);
  const routerPassThrough = category === "router" && Object.keys(routerPassThroughRaw).length > 0
    ? {
        exposesUnderlyingProvider: routerPassThroughRaw.exposesUnderlyingProvider === true,
        supportsProviderAllowlist: routerPassThroughRaw.supportsProviderAllowlist === true,
        supportsProviderBlocklist: routerPassThroughRaw.supportsProviderBlocklist === true,
        supportsZdrFilter: routerPassThroughRaw.supportsZdrFilter === true,
        supportsDataCollectionDeny: routerPassThroughRaw.supportsDataCollectionDeny === true,
        supportsBoundedFallbacks: routerPassThroughRaw.supportsBoundedFallbacks === true,
      }
    : undefined;
  return {
    providerId: provider.providerId,
    catalogProviderId: typeof entry.catalogProviderId === "string" ? entry.catalogProviderId : provider.providerId,
    category,
    jurisdictions: strings(trust.jurisdictions),
    externalEgress,
    supportsZdr: typeof trust.supportsZdr === "boolean" ? trust.supportsZdr : null,
    supportsNoTraining: typeof trust.supportsNoTraining === "boolean" ? trust.supportsNoTraining : null,
    supportsRegionalRouting: typeof trust.supportsRegionalRouting === "boolean" ? trust.supportsRegionalRouting : null,
    supportedRegions: strings(trust.supportedRegions),
    regionalEndpoints,
    ...(routerPassThrough ? { routerPassThrough } : {}),
  };
}

function connectionPosture(connection: {
  connectionId: string;
  providerId: string;
  executionChannel: string;
  accountClass: string;
  commercialBasis: string;
  authMethod: string;
  contractEvidence: unknown;
  entitlements: unknown;
  evidenceStatus: string;
  lastReviewedAt: Date | null;
}): ProviderConnectionPosture {
  return {
    providerConnectionId: connection.connectionId,
    providerId: connection.providerId,
    executionChannel: connection.executionChannel as ProviderConnectionPosture["executionChannel"],
    accountClass: connection.accountClass as ProviderConnectionPosture["accountClass"],
    commercialBasis: connection.commercialBasis as ProviderConnectionPosture["commercialBasis"],
    authMethod: connection.authMethod as ProviderConnectionPosture["authMethod"],
    contractEvidence: record(connection.contractEvidence),
    entitlements: record(connection.entitlements),
    evidenceStatus: connection.evidenceStatus as ProviderConnectionPosture["evidenceStatus"],
    lastReviewedAt: connection.lastReviewedAt?.toISOString() ?? null,
  };
}

export async function loadProviderOnboardingRecommendation() {
  const organization = await prisma.organization.findFirst({ select: { id: true, address: true } });
  const [businessContext, storefront, connections] = await Promise.all([
    organization ? prisma.businessContext.findUnique({ where: { organizationId: organization.id } }) : null,
    prisma.storefrontConfig.findFirst({ select: { archetypeId: true, archetype: { select: { category: true } } } }),
    prisma.aiProviderConnection.findMany({
      where: organization ? { OR: [{ organizationId: organization.id }, { organizationId: null }] } : undefined,
      include: { provider: { select: { providerId: true, name: true, category: true, endpointType: true, catalogEntry: true, status: true } } },
      orderBy: [{ status: "asc" }, { label: "asc" }],
    }),
  ]);

  const countryCode = parseOrgAddress(organization?.address).countryCode?.toLowerCase();
  const locationJurisdictions = countryCode
    ? [countryCode, ...(isEeaState(countryCode) ? ["eu"] : countryCode === "gb" ? ["uk"] : [])]
    : [];
  const profile: BusinessSuitabilityProfile = {
    organizationId: organization?.id ?? "unconfigured-organization",
    archetypeId: storefront?.archetypeId ?? null,
    archetypeCategory: storefront?.archetype?.category ?? businessContext?.industry ?? null,
    operatesIn: [...new Set([...(businessContext?.operatesIn ?? []), ...locationJurisdictions])].sort(),
    sellsTo: businessContext?.sellsTo ?? [],
    employsIn: businessContext?.employsIn ?? [],
    dataResidency: businessContext?.dataResidency ?? [],
    riskPosture: businessContext?.riskPosture === "conservative" || businessContext?.riskPosture === "balanced" || businessContext?.riskPosture === "progressive"
      ? businessContext.riskPosture
      : null,
  };

  return buildProviderOnboardingRecommendation({
    businessProfile: profile,
    handlesCardPayments: businessContext?.handlesCardPayments ?? false,
    connections: connections.map((connection) => ({
      label: connection.label || connection.provider.name,
      // ModelProvider owns runtime activation. AiProviderConnection may retain its
      // setup-state value after activation, so do not let that stale projection
      // downgrade (or accidentally upgrade) the onboarding recommendation.
      status: resolveRuntimeConnectionStatus(connection.provider.status, connection.status),
      facts: resolveProviderTrustFacts({
        catalog: catalogFacts(connection.provider),
        connection: connectionPosture(connection),
      }),
    })),
  });
}
