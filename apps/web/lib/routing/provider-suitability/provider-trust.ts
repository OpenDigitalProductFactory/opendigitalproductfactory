import type {
  ProviderCatalogTrustFacts,
  ProviderConnectionPosture,
  ProviderConnectionSourceFacts,
  ProviderTrustFacts,
} from "./types";

function sortedUnique(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort();
}

function authMethod(value: string | null): ProviderConnectionPosture["authMethod"] {
  if (value === "api_key") return "api-key";
  if (value === "oauth2_authorization_code") return "oauth";
  if (value === "oauth2_client_credentials") return "workload-identity";
  if (value === "none") return "local";
  return "unknown";
}

export function deriveProviderConnectionAccessPosture(
  input: ProviderConnectionSourceFacts,
): ProviderConnectionPosture {
  const resolvedAuth = authMethod(input.modelProviderAuthMethod);
  const executionChannel: ProviderConnectionPosture["executionChannel"] =
    input.externalEgress === "none"
      ? "local-runtime"
      : input.providerCategory === "router"
        ? "hosted-router"
        : input.cloudTenant
          ? "cloud-tenant"
          : resolvedAuth === "oauth" && input.cliEngine
            ? "subscription-cli"
            : "direct-api";

  const accountClass = input.accountClassAttestation ?? "unknown";
  const commercialBasis =
    input.commercialBasisAttestation ??
    (executionChannel === "local-runtime"
      ? "local-compute"
      : executionChannel === "subscription-cli"
        ? "subscription-included"
        : input.costModel === "token"
          ? "usage-metered"
          : "unknown");

  return {
    providerConnectionId: input.providerConnectionId,
    providerId: input.providerId,
    executionChannel,
    accountClass,
    commercialBasis,
    authMethod: resolvedAuth,
    contractEvidence: { ...(input.contractEvidence ?? {}) },
    entitlements: {
      ...(input.entitlements ?? {}),
      enabledRegions: sortedUnique(input.entitlements?.enabledRegions),
    },
    evidenceStatus: input.evidenceStatus ?? "unreviewed",
    lastReviewedAt: input.lastReviewedAt ?? null,
  };
}

/**
 * Resolve catalog capability and connected-account posture without allowing
 * vendor-wide facts to manufacture account entitlements. This is deliberately
 * pure: DB/credential/finance adapters must first project their owned facts into
 * the connection posture.
 */
export function resolveProviderTrustFacts(input: {
  catalog: ProviderCatalogTrustFacts;
  connection: ProviderConnectionPosture;
}): ProviderTrustFacts {
  if (input.catalog.providerId !== input.connection.providerId) {
    throw new Error(
      `provider trust mismatch: catalog ${input.catalog.providerId} != connection ${input.connection.providerId}`,
    );
  }

  return {
    ...input.catalog,
    ...input.connection,
    jurisdictions: sortedUnique(input.catalog.jurisdictions),
    supportedRegions: sortedUnique(input.catalog.supportedRegions),
    regionalEndpoints: [...input.catalog.regionalEndpoints]
      .map((endpoint) => ({ ...endpoint, region: endpoint.region.toLowerCase() }))
      .sort((a, b) => a.region.localeCompare(b.region)),
    contractEvidence: { ...input.connection.contractEvidence },
    entitlements: {
      ...input.connection.entitlements,
      enabledRegions: sortedUnique(input.connection.entitlements.enabledRegions),
    },
  };
}
