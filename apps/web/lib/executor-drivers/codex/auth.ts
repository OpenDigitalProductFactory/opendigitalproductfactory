// Codex credentials (BI-A01B06F6): the one resolver Build Studio dispatch,
// Ideate and inference routing use. It was three: two copies wrote the stored
// token as-is, never refreshed, with no account id and no API-key path;
// routing's refreshed it, carried the account and supported API keys. This is
// routing's, so all three callers now get the refresh.

import { getDecryptedCredential, getProviderBearerToken } from "@/lib/inference/ai-provider-internals";
import { providerSetupLocation } from "@/lib/ai-provider-routes";
import type { AccountConnection } from "../types";

export type CodexAuth =
  | { mode: "apikey"; apiKey: string }
  | { mode: "oauth"; accessToken: string; refreshToken: string; accountId: string | null };

/** The ChatGPT account a token names, if it carries the claim. */
function chatgptAccountId(accessToken: string): string | null {
  try {
    const claims = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8"));
    const value = claims?.["https://api.openai.com/auth"]?.chatgpt_account_id;
    return typeof value === "string" && value.trim() ? value : null;
  } catch {
    return null; // Legacy credentials may predate a supported identity claim.
  }
}

export async function resolveCodexAuth(providerId: string, connection?: AccountConnection): Promise<CodexAuth> {
  const credential = !connection
    ? await getDecryptedCredential(providerId)
    : connection.expectedExecutionVersion
      ? await getDecryptedCredential(providerId, connection.connectionId, connection.expectedExecutionVersion)
      : await getDecryptedCredential(providerId, connection.connectionId);
  if (!credential) {
    throw new Error(`No credential for "${providerId}". Configure via ${providerSetupLocation(providerId)}.`);
  }
  if (credential.secretRef && !credential.cachedToken) return { mode: "apikey", apiKey: credential.secretRef };

  const bearer = !connection
    ? await getProviderBearerToken(providerId)
    : connection.expectedExecutionVersion
      ? await getProviderBearerToken(providerId, connection.connectionId, connection.expectedExecutionVersion)
      : await getProviderBearerToken(providerId, connection.connectionId);
  if ("error" in bearer) {
    throw new Error(`OAuth token error for "${providerId}": ${bearer.error}. Re-authenticate via ${providerSetupLocation(providerId)}.`);
  }
  const accountId = chatgptAccountId(bearer.token);
  // A named account must be the one the token is for; the default may be a legacy token.
  if (connection && connection.connectionId !== `provider-default-${providerId}` && !accountId) {
    throw new Error("Selected account has no supported ChatGPT identity; reconnect this account");
  }
  return { mode: "oauth", accessToken: bearer.token, refreshToken: credential.refreshToken ?? "", accountId };
}

/**
 * The `auth.json` the Codex CLI reads from its home (codex-rs/login AuthDotJson).
 * `chatgptAuthTokens` makes Codex use the tokens as given instead of refreshing
 * them itself; the platform owns the refresh.
 */
export function codexAuthJson(auth: CodexAuth, now = new Date()): string {
  if (auth.mode === "apikey") return JSON.stringify({ OPENAI_API_KEY: auth.apiKey });
  // Codex parses id_token as a JWT, so a non-JWT token gets an unsigned placeholder.
  const idToken = auth.accessToken.split(".").length === 3
    ? auth.accessToken
    : `${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${Buffer.from('{"sub":"dpf"}').toString("base64url")}.`;
  return JSON.stringify({
    auth_mode: "chatgptAuthTokens",
    tokens: { access_token: auth.accessToken, refresh_token: auth.refreshToken, id_token: idToken, account_id: auth.accountId },
    last_refresh: now.toISOString(),
  });
}
