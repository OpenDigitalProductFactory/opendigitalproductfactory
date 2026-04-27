export const CONNECTOR_AUTH_MODES = [
  "none",
  "api_key_header",
  "api_key_query",
  "basic",
  "bearer_token",
  "oauth_client_credentials",
] as const;

export type ConnectorAuthMode = (typeof CONNECTOR_AUTH_MODES)[number];

export const CONNECTOR_TRANSPORT_MODES = [
  "rest_json",
  "mcp_http",
  "mcp_sse",
  "mcp_stdio",
] as const;

export type ConnectorTransportMode = (typeof CONNECTOR_TRANSPORT_MODES)[number];

export const CONNECTOR_CAPABILITIES = [
  "list",
  "get",
  "create",
  "update",
  "delete",
  "search",
  "polling_trigger",
  "webhook_trigger",
  "universal_api_call",
] as const;

export type ConnectorCapability = (typeof CONNECTOR_CAPABILITIES)[number];

export interface ConnectorProfile {
  authModes: ConnectorAuthMode[];
  transportModes: ConnectorTransportMode[];
  capabilities: ConnectorCapability[];
  supportsGenericConnector: boolean;
  metadataSource: "explicit" | "inferred";
}

export interface ConnectorProfileInput {
  name: string;
  slug?: string | null;
  category?: string | null;
  tags?: string[] | null;
  rawMetadata?: unknown;
}

type ExplicitConnectorProfile = Omit<ConnectorProfile, "metadataSource">;

const OAUTH_TOKENS = [
  "identity",
  "directory",
  "entra",
  "google",
  "google-admin",
  "microsoft",
  "teams",
  "gmail",
  "outlook",
  "security",
  "cloud",
  "workspace",
];

const WEBHOOK_TOKENS = [
  "webhook",
  "chat",
  "messaging",
  "teams",
  "slack",
  "ticketing",
  "service-desk",
  "helpdesk",
];

const POLLING_TOKENS = [
  "ticketing",
  "service-desk",
  "finance",
  "billing",
  "payments",
  "crm",
  "project",
  "work",
  "identity",
];

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function unique<T>(values: Iterable<T>): T[] {
  return Array.from(new Set(values));
}

function isAuthMode(value: unknown): value is ConnectorAuthMode {
  return typeof value === "string" && (CONNECTOR_AUTH_MODES as readonly string[]).includes(value);
}

function isTransportMode(value: unknown): value is ConnectorTransportMode {
  return typeof value === "string" && (CONNECTOR_TRANSPORT_MODES as readonly string[]).includes(value);
}

function isCapability(value: unknown): value is ConnectorCapability {
  return typeof value === "string" && (CONNECTOR_CAPABILITIES as readonly string[]).includes(value);
}

function coerceStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function collectTokens(input: ConnectorProfileInput): string[] {
  return unique(
    [input.name, input.slug ?? "", input.category ?? "", ...(input.tags ?? [])]
      .flatMap((piece) => piece.toLowerCase().split(/[^a-z0-9]+/g))
      .map((piece) => piece.trim())
      .filter(Boolean)
  );
}

function hasAnyToken(tokens: string[], candidates: readonly string[]): boolean {
  return candidates.some((candidate) => tokens.includes(candidate) || tokens.join(" ").includes(candidate));
}

function getExplicitConnectorProfile(rawMetadata: unknown): ExplicitConnectorProfile | null {
  const metadata = toRecord(rawMetadata);
  if (!metadata) return null;

  const explicit = toRecord(metadata.dpfConnectorProfile) ?? toRecord(metadata.connectorProfile);
  if (!explicit) return null;

  const authModes = coerceStringArray(explicit.authModes).filter(isAuthMode);
  const transportModes = coerceStringArray(explicit.transportModes).filter(isTransportMode);
  const capabilities = coerceStringArray(explicit.capabilities).filter(isCapability);
  const supportsGenericConnector =
    typeof explicit.supportsGenericConnector === "boolean" ? explicit.supportsGenericConnector : true;

  if (authModes.length === 0 || transportModes.length === 0 || capabilities.length === 0) {
    return null;
  }

  return {
    authModes,
    transportModes,
    capabilities,
    supportsGenericConnector,
  };
}

export function getIntegrationConnectorProfile(input: ConnectorProfileInput): ConnectorProfile {
  const explicit = getExplicitConnectorProfile(input.rawMetadata);
  if (explicit) {
    return { ...explicit, metadataSource: "explicit" };
  }

  const tokens = collectTokens(input);
  const category = (input.category ?? "").toLowerCase();
  const authModes: ConnectorAuthMode[] = hasAnyToken(tokens, OAUTH_TOKENS) || category === "cloud" || category === "communication"
    ? ["oauth_client_credentials"]
    : ["api_key_header"];

  const transportModes: ConnectorTransportMode[] = ["rest_json"];
  const capabilities: ConnectorCapability[] = [
    "list",
    "get",
    "search",
    "universal_api_call",
  ];

  if (category !== "communication" && !hasAnyToken(tokens, ["identity", "directory"])) {
    capabilities.push("create", "update");
  }

  if (hasAnyToken(tokens, POLLING_TOKENS) || category === "finance" || category === "crm") {
    capabilities.push("polling_trigger");
  }

  if (hasAnyToken(tokens, WEBHOOK_TOKENS) || category === "communication") {
    capabilities.push("webhook_trigger");
  }

  return {
    authModes: unique(authModes),
    transportModes: unique(transportModes),
    capabilities: unique(capabilities),
    supportsGenericConnector: true,
    metadataSource: "inferred",
  };
}

