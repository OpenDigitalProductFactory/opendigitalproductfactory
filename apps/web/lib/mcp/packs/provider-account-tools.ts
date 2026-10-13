import type { ToolDefinition } from "@/lib/mcp-tool-types";
import { providerAccountConsequence } from "@/lib/mcp/provider-account-consequence";

export const providerAccountDefinitions: ToolDefinition[] = [
  {
    name: "get_provider_accounts",
    description: "Read configured provider accounts, authentication state and account-specific trust posture. Credentials are masked; unconfigured and disabled accounts remain visible.",
    inputSchema: { type: "object", properties: { providerId: { type: "string", description: "Optionally restrict to one provider" }, limit: { type: "integer", minimum: 1, maximum: 100, description: "Accounts per page, default 25" }, cursor: { type: "string", description: "nextCursor from the previous page" } } },
    requiredCapability: "manage_provider_connections", sideEffect: false,
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "manage_provider_account",
    description: "Add, configure, enable, disable, sign in, disconnect, test or discover models for a provider account. Every operation except add requires an explicit account identity. Discovery uses existing credentials to synchronize model availability. Delegated development maintenance may disable credentialless default local runtimes. Credential and account-activation changes retain approval checks; authentication never grants data clearance.",
    inputSchema: { type: "object", properties: {
      operation: { type: "string", enum: ["add", "configure", "enable", "disable", "sign-in", "disconnect", "test", "discover"] },
      providerId: { type: "string", description: "Required for add; otherwise checked against the selected account" },
      connectionId: { type: "string", description: "Account identity returned by get_provider_accounts or add" },
      label: { type: "string", description: "Account display name, required for add" },
      authMethod: { type: "string", enum: ["api_key", "oauth2_authorization_code", "oauth2_client_credentials"], description: "Required for add" },
      secretRef: { type: "string", writeOnly: true, description: "API key; encrypted at rest and redacted from audit parameters" },
      clientId: { type: "string" },
      clientSecret: { type: "string", writeOnly: true },
      tokenEndpoint: { type: "string" },
      scope: { type: "string" },
    }, required: ["operation"] },
    requiredCapability: "manage_provider_connections", sideEffect: true, consequence: "authority",
    consequenceForCall: providerAccountConsequence,
  },
];
