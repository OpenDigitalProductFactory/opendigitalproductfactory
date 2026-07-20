import type { OpenRouterPolicyObligations } from "./types";

export type OpenRouterProviderSettings = {
  only?: string[];
  ignore?: string[];
  order?: string[];
  allow_fallbacks?: boolean;
  require_parameters?: boolean;
  data_collection?: "allow" | "deny";
  zdr?: boolean;
  sort?: "price" | "throughput" | "latency";
};

export type OpenRouterExecutionPolicy = {
  posture: "public" | "restricted";
  providerSettings: OpenRouterProviderSettings;
  requestRouterMetadata: true;
  requireUnderlyingProviderEvidence: boolean;
  providerConnectionId: string | null;
  requiredBaseUrl?: string;
};

export type OpenRouterRoutingEvidence = {
  underlyingProviderEvidence: "returned" | "not-returned";
  selectedProvider?: string;
  selectedModel?: string;
  region?: string;
  attempts: Array<{ provider: string; model?: string; status?: number }>;
};

export class OpenRouterPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenRouterPolicyError";
  }
}

function cleanSlugs(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? [])
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[a-z0-9][a-z0-9._/-]*$/.test(value)))];
}

function restricted(obligations: OpenRouterPolicyObligations): boolean {
  return obligations.requireProviderAllowlist ||
    obligations.requireProviderBlocklist ||
    obligations.requireZdr ||
    obligations.denyDataCollection ||
    obligations.requireBoundedFallbacks;
}

function requiresEu(region: string | null): boolean {
  return region === "eu" || region === "europe" || region?.startsWith("eu-") === true;
}

/** Compile account-scoped suitability obligations into the exact OpenRouter wire policy. */
export function compileOpenRouterExecutionPolicy(
  obligations: OpenRouterPolicyObligations,
  configured: OpenRouterProviderSettings = {},
): OpenRouterExecutionPolicy {
  const isRestricted = restricted(obligations);
  const only = cleanSlugs(obligations.approvedEndpointSlugs);

  if (isRestricted && only.length === 0) {
    throw new OpenRouterPolicyError(
      "Restricted OpenRouter routing requires at least one approved underlying-provider endpoint slug.",
    );
  }

  let requiredBaseUrl: string | undefined;
  if (requiresEu(obligations.requiredRegion)) {
    const entitled = obligations.accountClass === "enterprise" &&
      (obligations.evidenceStatus === "operator-attested" || obligations.evidenceStatus === "contract-uploaded") &&
      obligations.regionalProcessingEntitled === true &&
      obligations.enabledRegions.some((region) => requiresEu(region.toLowerCase()));
    if (!entitled) {
      throw new OpenRouterPolicyError(
        "EU OpenRouter routing requires enterprise entitlement proven for this specific provider connection.",
      );
    }
    if (obligations.requiredBaseUrl !== "https://eu.openrouter.ai/api/v1") {
      throw new OpenRouterPolicyError(
        "EU OpenRouter routing requires the approved https://eu.openrouter.ai/api/v1 endpoint.",
      );
    }
    requiredBaseUrl = obligations.requiredBaseUrl;
  }

  const providerSettings: OpenRouterProviderSettings = isRestricted
    ? {
        only,
        allow_fallbacks: false,
        require_parameters: true,
        data_collection: "deny",
        zdr: true,
      }
    : {
        ...(cleanSlugs(configured.only).length > 0 ? { only: cleanSlugs(configured.only) } : {}),
        ...(cleanSlugs(configured.ignore).length > 0 ? { ignore: cleanSlugs(configured.ignore) } : {}),
        ...(cleanSlugs(configured.order).length > 0 ? { order: cleanSlugs(configured.order) } : {}),
        ...(configured.allow_fallbacks !== undefined ? { allow_fallbacks: configured.allow_fallbacks } : {}),
        ...(configured.require_parameters !== undefined ? { require_parameters: configured.require_parameters } : {}),
        ...(configured.data_collection !== undefined ? { data_collection: configured.data_collection } : {}),
        ...(configured.zdr !== undefined ? { zdr: configured.zdr } : {}),
        ...(configured.sort !== undefined ? { sort: configured.sort } : {}),
      };

  return {
    posture: isRestricted ? "restricted" : "public",
    providerSettings,
    requestRouterMetadata: true,
    requireUnderlyingProviderEvidence: isRestricted,
    providerConnectionId: obligations.providerConnectionId,
    ...(requiredBaseUrl ? { requiredBaseUrl } : {}),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 200 ? value : undefined;
}

/** Whitelist routing fields so prompts, outputs, plugin data, and future fields never enter receipts. */
export function parseOpenRouterRoutingEvidence(metadata: unknown): OpenRouterRoutingEvidence {
  const root = record(metadata);
  if (!root) return { underlyingProviderEvidence: "not-returned", attempts: [] };

  const endpoints = record(root.endpoints);
  const available = Array.isArray(endpoints?.available) ? endpoints.available : [];
  const selected = available.map(record).find((item) => item?.selected === true);
  const selectedProvider = boundedString(selected?.provider);
  const selectedModel = boundedString(selected?.model);
  const attempts = (Array.isArray(root.attempts) ? root.attempts : [])
    .map(record)
    .filter((item): item is Record<string, unknown> => item !== null)
    .slice(0, 20)
    .flatMap((item) => {
      const provider = boundedString(item.provider);
      if (!provider) return [];
      const model = boundedString(item.model);
      const status = typeof item.status === "number" && Number.isInteger(item.status) ? item.status : undefined;
      return [{ provider, ...(model ? { model } : {}), ...(status !== undefined ? { status } : {}) }];
    });
  const region = boundedString(root.region);

  if (!selectedProvider && attempts.length === 0) {
    return { underlyingProviderEvidence: "not-returned", attempts: [] };
  }
  return {
    underlyingProviderEvidence: "returned",
    ...(selectedProvider ? { selectedProvider } : {}),
    ...(selectedModel ? { selectedModel } : {}),
    ...(region ? { region } : {}),
    attempts,
  };
}
