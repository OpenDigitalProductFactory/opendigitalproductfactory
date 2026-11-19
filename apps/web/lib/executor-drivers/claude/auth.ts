// The one Claude credential resolver (BI-A01B06F6). Build Studio dispatch,
// Ideate, inference routing and the Workroom runtime each kept their own copy.
//
// The subscription provider ("anthropic-sub", Max Plan OAuth) is the default:
// flat-rate, where an API key ("anthropic") bills per token and burns $100 in a
// few hours vs. 5+ days on Max Plan for sustained build workloads.
//
// The subscription provider uses the refreshing bearer token:
// access tokens expire every few hours, and a cached one would be sent stale and
// fail with 401. Any other provider uses its stored API key.

import { getDecryptedCredential, getProviderBearerToken } from "@/lib/inference/ai-provider-internals";
import { providerSetupLocation } from "@/lib/ai-provider-routes";
import type { AccountConnection } from "../types";

export type ClaudeAuth = { mode: "oauth"; token: string } | { mode: "apikey"; apiKey: string };

export type ClaudeConnection = AccountConnection;

export async function resolveClaudeAuth(providerId: string, connection?: ClaudeConnection): Promise<ClaudeAuth> {
  if (providerId === "anthropic-sub") {
    const result = !connection
      ? await getProviderBearerToken(providerId)
      : connection.expectedExecutionVersion
        ? await getProviderBearerToken(providerId, connection.connectionId, connection.expectedExecutionVersion)
        : await getProviderBearerToken(providerId, connection.connectionId);
    if ("error" in result) {
      throw new Error(`OAuth token error for "${providerId}": ${result.error}. Re-authenticate via ${providerSetupLocation(providerId)}.`);
    }
    return { mode: "oauth", token: result.token };
  }
  const credential = !connection
    ? await getDecryptedCredential(providerId)
    : connection.expectedExecutionVersion
      ? await getDecryptedCredential(providerId, connection.connectionId, connection.expectedExecutionVersion)
      : await getDecryptedCredential(providerId, connection.connectionId);
  const apiKey = credential?.secretRef ?? credential?.cachedToken;
  if (!apiKey) throw new Error(`No Anthropic API key for provider "${providerId}". Configure via ${providerSetupLocation(providerId)}.`);
  return { mode: "apikey", apiKey };
}

/** The environment variable the CLI reads for this auth, and whether `--bare` applies (it disables OAuth). */
export function claudeCredential(auth: ClaudeAuth): { envVar: "CLAUDE_CODE_OAUTH_TOKEN" | "ANTHROPIC_API_KEY"; value: string; bare: boolean } {
  return auth.mode === "oauth"
    ? { envVar: "CLAUDE_CODE_OAUTH_TOKEN", value: auth.token, bare: false }
    : { envVar: "ANTHROPIC_API_KEY", value: auth.apiKey, bare: true };
}
