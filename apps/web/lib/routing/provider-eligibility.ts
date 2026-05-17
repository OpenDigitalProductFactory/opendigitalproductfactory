export type ProviderEligibilityMetadata = {
  providerId?: string | null;
  endpointType?: string | null;
  category?: string | null;
  serviceKind?: string | null;
  authMethod?: string | null;
  cliEngine?: string | null;
};

export const MODEL_ROUTING_ENDPOINT_TYPES = [
  "llm",
  "chat",
  "responses",
  "gemini",
  "ollama",
] as const;

export const BACKGROUND_EVAL_ENDPOINT_TYPES = [
  "llm",
  "chat",
  "gemini",
  "ollama",
] as const;

const MODEL_ROUTING_ENDPOINT_TYPE_SET = new Set<string>(MODEL_ROUTING_ENDPOINT_TYPES);
const BACKGROUND_EVAL_ENDPOINT_TYPE_SET = new Set<string>(BACKGROUND_EVAL_ENDPOINT_TYPES);

function normalizedEndpointType(provider: ProviderEligibilityMetadata): string {
  return (provider.endpointType ?? "llm").toLowerCase();
}

function normalizedCategory(provider: ProviderEligibilityMetadata): string {
  return (provider.category ?? "").toLowerCase();
}

function normalizedServiceKind(provider: ProviderEligibilityMetadata): string {
  return (provider.serviceKind ?? "").toLowerCase();
}

export function isModelRoutingProvider(provider: ProviderEligibilityMetadata): boolean {
  if (!provider.providerId) return false;

  const endpointType = normalizedEndpointType(provider);
  const category = normalizedCategory(provider);
  const serviceKind = normalizedServiceKind(provider);

  if (endpointType === "service" || endpointType === "transcription") return false;
  if (serviceKind === "mcp") return false;
  if (category.startsWith("mcp")) return false;

  return MODEL_ROUTING_ENDPOINT_TYPE_SET.has(endpointType) || Boolean(provider.cliEngine);
}

export function canRunStartupModelDiscovery(provider: ProviderEligibilityMetadata): boolean {
  return isModelRoutingProvider(provider);
}

export function canQueueBackgroundModelEvals(provider: ProviderEligibilityMetadata): boolean {
  if (!isModelRoutingProvider(provider)) return false;
  if ((provider.authMethod ?? "").toLowerCase() === "oauth2_authorization_code") return false;
  return BACKGROUND_EVAL_ENDPOINT_TYPE_SET.has(normalizedEndpointType(provider));
}

export function backgroundModelEvalSkipReason(provider: ProviderEligibilityMetadata | null): string {
  if (!provider) return "provider metadata not found";
  if (!isModelRoutingProvider(provider)) return "provider is not a model-routing endpoint";
  if ((provider.authMethod ?? "").toLowerCase() === "oauth2_authorization_code") {
    return "user-delegated OAuth providers cannot run unattended background evals";
  }
  return `endpointType=${normalizedEndpointType(provider)} does not have a background eval adapter`;
}
