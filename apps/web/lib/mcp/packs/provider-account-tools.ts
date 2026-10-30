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
    description: "Manage an explicit provider account. Test verifies authentication without restoring default subscription quota. Recheck-quota sends one bounded synthetic Responses request for the exact selected active subscription account and model; CLI and other-model restrictions remain separate. Its optional hourly flag explicitly commissions or stops bounded recovery checks. Discovery synchronizes models. Activation, credentials and consequential recovery retain approval checks. Authentication never grants data clearance.",
    inputSchema: { type: "object", properties: {
      operation: { type: "string", enum: ["add", "configure", "enable", "disable", "sign-in", "disconnect", "test", "discover", "recheck-quota"] },
      modelId: { type: "string", description: "Required for recheck-quota. Only this exact model on the selected account's Responses endpoint is checked; CLI and other model limits remain separate." },
      hourly: { type: "boolean", description: "For recheck-quota only: explicitly commission or stop bounded hourly rechecks of this account/model. Omission preserves an existing commission and otherwise performs one check." },
      providerId: { type: "string", description: "Required for add; otherwise checked against the selected account" },
      connectionId: { type: "string", description: "Account identity returned by get_provider_accounts or add" },
      label: { type: "string", description: "Account display name, required for add" },
      authMethod: { type: "string", enum: ["api_key", "oauth2_authorization_code", "oauth2_client_credentials"], description: "Required for add" },
      secretRef: { type: "string", writeOnly: true, description: "API key; encrypted at rest and redacted from audit parameters" },
      clientId: { type: "string" },
      clientSecret: { type: "string", writeOnly: true },
      tokenEndpoint: { type: "string" },
      scope: { type: "string" },
      providerWorkspaceId: { type: "string", description: "Anthropic API-key workspace ID (wrkspc_...). Required for organization-scoped keys; empty clears it." },
    }, required: ["operation"] },
    requiredCapability: "manage_provider_connections", sideEffect: true, consequence: "authority",
    consequenceForCall: providerAccountConsequence,
  },
];
