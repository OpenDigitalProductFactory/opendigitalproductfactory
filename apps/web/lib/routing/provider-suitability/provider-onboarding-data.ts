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
import { resolveProviderTrustEvidence } from "./evidence";
import {
  parseApplicability,
  regulationApplies,
} from "@dpf/db/regulation-applicability";
import type { RegulationSuitabilityResult } from "./types";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function providerCatalogFacts(provider: {
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

export function connectionPosture(connection: {
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

export type ProviderSuitabilitySourceContext = {
  businessProfile: BusinessSuitabilityProfile;
  handlesCardPayments: boolean;
  regulationResults: RegulationSuitabilityResult[];
  connections: Array<{
    label: string;
    status: string;
    facts: ReturnType<typeof resolveProviderTrustFacts>;
  }>;
};

export type BusinessSuitabilityContext = {
  businessProfile: BusinessSuitabilityProfile;
  handlesCardPayments: boolean;
  businessContextConfigured: boolean;
};

/** Canonical business requirements, bounded to organization context only. */
export async function loadBusinessSuitabilityContext(): Promise<BusinessSuitabilityContext> {
  const organization = await prisma.organization.findFirst({ select: { id: true, address: true } });
  const [businessContext, storefront] = await Promise.all([
    organization ? prisma.businessContext.findUnique({ where: { organizationId: organization.id } }) : null,
    prisma.storefrontConfig.findFirst({ select: { archetypeId: true, archetype: { select: { category: true } } } }),
  ]);
  const countryCode = parseOrgAddress(organization?.address).countryCode?.toLowerCase();
  const locationJurisdictions = countryCode
    ? [countryCode, ...(isEeaState(countryCode) ? ["eu"] : countryCode === "gb" ? ["uk"] : [])]
    : [];
  return {
    businessContextConfigured: Boolean(businessContext),
    handlesCardPayments: businessContext?.handlesCardPayments ?? false,
    businessProfile: {
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
    },
  };
}

/** Shared account/business fact loader for onboarding preview and live routing. */
export async function loadProviderSuitabilitySourceContext(
  applicableRegulationIds: readonly string[] = [],
): Promise<ProviderSuitabilitySourceContext> {
  const businessContext = await loadBusinessSuitabilityContext();
  const profile = businessContext.businessProfile;
  const organizationId = profile.organizationId === "unconfigured-organization" ? null : profile.organizationId;
  const connections = await prisma.aiProviderConnection.findMany({
      where: organizationId ? { OR: [{ organizationId }, { organizationId: null }] } : undefined,
      include: {
        provider: { select: { providerId: true, name: true, category: true, endpointType: true, catalogEntry: true, status: true } },
        trustEvidence: true,
        supplierContract: { select: { contractId: true, status: true, startDate: true, endDate: true } },
      },
      orderBy: [{ status: "asc" }, { label: "asc" }],
    });
  const regulationRows = applicableRegulationIds.length > 0
    ? await prisma.regulation.findMany({
        where: { regulationId: { in: [...new Set(applicableRegulationIds)] } },
        select: { regulationId: true, applicability: true },
      })
    : [];
  const regulationResults: RegulationSuitabilityResult[] = regulationRows.map((regulation) => {
    const applicability = parseApplicability(regulation.applicability);
    return {
      regulationId: regulation.regulationId,
      applicability: applicability
        ? regulationApplies(applicability, {
            operatesIn: profile.operatesIn,
            sellsTo: profile.sellsTo,
            employsIn: profile.employsIn,
            dataResidency: profile.dataResidency,
            archetype: profile.archetypeCategory ?? undefined,
            archetypeId: profile.archetypeId ?? undefined,
          })
        : {
            applies: false,
            reason: "Regulation applicability is not declared in the generic evaluator.",
            matchedBasis: [],
            undeclared: true,
          },
    };
  });

  return {
    businessProfile: profile,
    handlesCardPayments: businessContext.handlesCardPayments,
    regulationResults,
    connections: connections.map((connection) => {
      const evidence = resolveProviderTrustEvidence({
        connection: connectionPosture(connection),
        evidenceConnectionId: connection.id,
        records: connection.trustEvidence,
        supplierContract: connection.supplierContract ?? undefined,
      });
      return {
        label: connection.label || connection.provider.name,
        // ModelProvider owns runtime activation. AiProviderConnection may retain its
        // setup-state value after activation, so do not let that stale projection
        // downgrade (or accidentally upgrade) the onboarding recommendation.
        status: resolveRuntimeConnectionStatus(connection.provider.status, connection.status),
        facts: resolveProviderTrustFacts({
          catalog: providerCatalogFacts(connection.provider),
          connection: evidence.posture,
        }),
      };
    }),
  };
}

export async function loadProviderOnboardingRecommendation() {
  const context = await loadProviderSuitabilitySourceContext();
  return buildProviderOnboardingRecommendation(context);
}
