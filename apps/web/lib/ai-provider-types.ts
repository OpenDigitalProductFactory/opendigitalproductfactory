// apps/web/lib/ai-provider-types.ts

// ─── Schedule helpers ─────────────────────────────────────────────────────────

export const SCHEDULE_INTERVALS_MS = {
  daily:   1 * 24 * 60 * 60 * 1000,
  weekly:  7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
} as const;

export type ScheduleValue = "daily" | "weekly" | "monthly" | "disabled";

export function computeNextRunAt(schedule: string, from: Date): Date | null {
  if (schedule === "disabled") return null;
  const ms = SCHEDULE_INTERVALS_MS[schedule as keyof typeof SCHEDULE_INTERVALS_MS];
  if (ms === undefined) return null;
  return new Date(from.getTime() + ms);
}

// ─── Cost calculation ─────────────────────────────────────────────────────────

/** Token-priced provider cost (cloud APIs). */
export function computeTokenCost(
  inputTokens: number,
  outputTokens: number,
  inputPricePerMToken: number,
  outputPricePerMToken: number,
): number {
  return (inputTokens / 1_000_000) * inputPricePerMToken
       + (outputTokens / 1_000_000) * outputPricePerMToken;
}

/** Compute-priced provider cost (local inference, e.g. Ollama). */
export function computeComputeCost(
  inferenceMs: number,
  computeWatts: number,
  electricityRateKwh: number,
): number {
  return (inferenceMs / 3_600_000) * (computeWatts / 1_000) * electricityRateKwh;
}

// ─── Shared types ─────────────────────────────────────────────────────────────

export type ProviderRow = {
  id: string;
  providerId: string;
  name: string;
  families: string[];
  enabledFamilies: string[];
  status: string;
  costModel: string;
  category: string;
  baseUrl: string | null;
  authMethod: string;
  supportedAuthMethods: string[];
  authHeader: string | null;
  endpoint: string | null;
  inputPricePerMToken: number | null;
  outputPricePerMToken: number | null;
  computeWatts: number | null;
  electricityRateKwh: number | null;
  docsUrl: string | null;
  consoleUrl: string | null;
  billingLabel: string | null;
  costPerformanceNotes: string | null;
  endpointType: string;
  sensitivityClearance: string[];
  capabilityTier: string;
  costBand: string;
  taskTags: string[];
  mcpTransport: string | null;
  maxConcurrency: number | null;
  // Routing dimension scores (0–100)
  reasoning: number;
  codegen: number;
  toolFidelity: number;
  instructionFollowing: number;
  structuredOutput: number;
  conversational: number;
  contextRetention: number;
  authorizeUrl: string | null;
  tokenUrl: string | null;
  oauthClientId: string | null;
  oauthRedirectUri: string | null;
};

/** Client-safe credential info — secrets are never sent to the browser. */
export type CredentialRow = {
  providerId: string;
  secretHint: string | null;
  clientId: string | null;
  clientSecretHint: string | null;
  tokenEndpoint: string | null;
  scope: string | null;
  status: string;
  tokenExpiresAt: string | null;
  hasRefreshToken: boolean;
};

export type ProviderWithCredential = {
  provider: ProviderRow;
  credential: CredentialRow | null;
};

export type SpendByProvider = {
  providerId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
};

export type SpendByAgent = {
  agentId: string;
  agentName: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
};

export type ScheduledJobRow = {
  id: string;
  jobId: string;
  name: string;
  schedule: string;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  lastStatus: string | null;
  lastError: string | null;
};

export type DiscoveredModelRow = {
  id: string;
  providerId: string;
  modelId: string;
  rawMetadata: Record<string, unknown>;
  discoveredAt: Date;
  lastSeenAt: Date;
};

export type ModelProfileRow = {
  id: string;
  providerId: string;
  modelId: string;
  friendlyName: string;
  summary: string;
  capabilityTier: string;
  costTier: string;
  bestFor: string[];
  avoidFor: string[];
  contextWindow: string | null;
  speedRating: string | null;
  generatedBy: string;
  generatedAt: Date;
  // EP-INF-003: ModelCard fields
  modelClass?: string;
  modelFamily?: string | null;
  maxInputTokens?: number | null;
  maxOutputTokens?: number | null;
  capabilities?: Record<string, unknown>;
  pricing?: Record<string, unknown>;
  metadataSource?: string;
  metadataConfidence?: string;
  inputModalities?: string[];
  outputModalities?: string[];
};

// ─── Registry JSON shape ──────────────────────────────────────────────────────

export type RegistryProviderEntry = {
  providerId: string;
  name: string;
  families: string[];
  category: "direct" | "router" | "agent" | "mcp-subscribed" | "mcp-internal";
  baseUrl: string | null;
  authMethod: "api_key" | "oauth2_client_credentials" | "oauth2_authorization_code" | "none";
  supportedAuthMethods: string[];
  authHeader: string | null;
  costModel: string;
  inputPricePerMToken?: number;
  outputPricePerMToken?: number;
  computeWatts?: number;
  electricityRateKwh?: number;
  docsUrl?: string | null;
  consoleUrl?: string | null;
  billingLabel?: string | null;
  costPerformanceNotes?: string | null;
  // Model restrictions — allowlist of model ID glob patterns this provider can call
  modelRestrictions?: string[];
  // Catalog fields (EP-AGENT-CAP-001 Task 11)
  catalogVisibility?: "visible" | "hidden";
  endpointType?: string;
  catalogEntry?: {
    description?: string;
    pricingInfo?: string;
    enableUrl?: string;
  } | null;
  authorizeUrl?: string | null;
  tokenUrl?: string | null;
  oauthClientId?: string | null;
  oauthRedirectUri?: string | null;
};

// ─── Model discovery ──────────────────────────────────────────────────────────

export function parseModelsResponse(
  providerId: string,
  json: unknown,
): { modelId: string; rawMetadata: Record<string, unknown> }[] {
  if (typeof json !== "object" || json === null) return [];

  // Ollama + Cohere: { models: [{ name: "..." }] }
  if (providerId === "ollama" || providerId === "cohere") {
    const obj = json as { models?: { name?: string }[] };
    return (obj.models ?? [])
      .filter((m) => typeof m.name === "string")
      .map((m) => ({ modelId: m.name as string, rawMetadata: m as Record<string, unknown> }));
  }

  // Gemini: { models: [{ name: "models/gemini-2.0-flash", ... }] }
  if (providerId === "gemini") {
    const obj = json as { models?: { name?: string }[] };
    return (obj.models ?? [])
      .filter((m) => typeof m.name === "string")
      .map((m) => ({
        // Strip the "models/" prefix — Gemini returns "models/gemini-2.0-flash" but the API expects just "gemini-2.0-flash"
        modelId: (m.name as string).replace(/^models\//, ""),
        rawMetadata: m as Record<string, unknown>,
      }));
  }

  // OpenAI-compatible: { data: [{ id: "..." }] }
  const obj = json as { data?: { id?: string }[] };
  return (obj.data ?? [])
    .filter((m) => typeof m.id === "string")
    .map((m) => ({ modelId: m.id as string, rawMetadata: m as Record<string, unknown> }));
}

// ─── Billing label ───────────────────────────────────────────────────────────

type BillingLabelInput = {
  costModel: string;
  billingLabel: string | null;
  inputPricePerMToken: number | null;
  outputPricePerMToken: number | null;
};

/** Human-readable billing label. Returns explicit label if set, auto-generates from pricing otherwise. */
export function getBillingLabel(provider: BillingLabelInput): string | null {
  if (provider.billingLabel) return provider.billingLabel;

  if (provider.costModel === "token") {
    if (provider.inputPricePerMToken != null && provider.outputPricePerMToken != null) {
      return `Pay-per-use · $${provider.inputPricePerMToken.toFixed(2)}/$${provider.outputPricePerMToken.toFixed(2)} per M tokens`;
    }
    return "Pay-per-use · rates vary by model";
  }

  if (provider.costModel === "compute") {
    return "Local compute · electricity cost only";
  }

  return null;
}

// ─── URL helpers ──────────────────────────────────────────────────────────────

/**
 * Returns the connectivity-test URL for a provider.
 * Ollama uses /api/tags; all others use /models.
 * Returns null when neither baseUrl nor endpoint is available.
 */
export function getTestUrl(provider: Pick<ProviderRow, "providerId" | "baseUrl" | "endpoint">): string | null {
  const base = provider.baseUrl ?? provider.endpoint;
  if (!base) return null;
  if (provider.providerId === "ollama") return `${base}/api/tags`;
  return `${base}/models`;
}

// ── EP-INF-010: Platform Services UX types ──────────────────────────────────

/** Aggregated model summary for provider grid display. */
export type ProviderModelSummary = {
  totalModels: number;
  activeModels: number;
  nonChatClasses: string[];
};

/** Row shape for activated MCP servers on the providers grid. */
export type McpServerGridRow = {
  id: string;
  serverId: string;
  name: string;
  status: string;
  transport: string | null;
  healthStatus: string;
  lastHealthCheck: string | null;   // ISO string
  category: string | null;
  tags: string[];
  activatedBy: string | null;
  activatedAt: string | null;       // ISO string
  integrationName: string | null;
  integrationLogoUrl: string | null;
  integrationCategory: string | null;
  toolCount: number;
  enabledToolCount: number;
};

/** Row shape for execution recipes on the provider detail page. */
export type RecipeGridRow = {
  id: string;
  contractFamily: string;
  modelId: string;
  executionAdapter: string;
  status: string;
  version: number;
  origin: string;
};

/** Row shape for async inference operations. */
export type AsyncOpRow = {
  id: string;
  providerId: string;
  modelId: string;
  contractFamily: string;
  status: string;
  progressPct: number | null;
  progressMessage: string | null;
  errorMessage: string | null;
  createdAt: string;          // ISO string
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string;
};

/** Single item in the combined tool inventory. */
export type ToolInventoryItem = {
  name: string;
  source: string;
  type: "platform" | "mcp";
  enabled: boolean;
  gating: string | null;
  originalName?: string;      // For MCP tools: un-namespaced name
};
