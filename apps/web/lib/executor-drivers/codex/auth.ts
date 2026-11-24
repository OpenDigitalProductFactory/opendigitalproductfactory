import { prisma } from "@dpf/db";
import { getDecryptedCredential, getProviderBearerToken } from "@/lib/inference/ai-provider-internals";
import { providerSetupLocation } from "@/lib/ai-provider-routes";
import type { CodexCatalogLogin } from "@/lib/routing/codex-cli-model-catalog";
import { matchesScopedOAuthConnection } from "@/lib/provider-oauth";
import type { AccountConnection } from "../types";

export type CodexAuth =
  | { mode: "apikey"; apiKey: string }
  | { mode: "oauth"; accessToken: string; refreshToken: string; accountId: string | null };

/** Token claims identify the selected credential and confer no authority. */
function chatgptClaims(token: string): { chatgpt_account_id?: unknown; chatgpt_plan_type?: unknown } | undefined {
  try {
    if (token.split(".").length !== 3) return;
    return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"))?.["https://api.openai.com/auth"];
  } catch {
    return undefined;
  }
}

export function resolveCodexAuth(providerId: string, connection?: AccountConnection): Promise<CodexAuth>;
export function resolveCodexAuth(providerId: string, connection: AccountConnection, transport: "app-server"): Promise<CodexCatalogLogin>;
export async function resolveCodexAuth(providerId: string, connection?: AccountConnection, transport?: "app-server"): Promise<CodexAuth | CodexCatalogLogin> {
  const connectionId = connection?.connectionId;
  const credentialArgs: [string, string?, string?] = [providerId];
  if (connectionId !== undefined) credentialArgs.push(connectionId);
  if (connection?.expectedExecutionVersion) credentialArgs.push(connection.expectedExecutionVersion);

  const selected = transport && await prisma.aiProviderConnection.findUnique({ where: { connectionId: connectionId!, providerId } });
  if (transport && (!selected || selected.providerId !== providerId || selected.status === "disabled" || !selected.credentialEntryId)) {
    throw new Error("Selected provider account is unavailable");
  }
  const credential = await getDecryptedCredential(...credentialArgs);
  if (selected && credential?.id !== selected.credentialEntryId) throw new Error("Selected account credential changed");
  if (!credential) throw new Error(`No credential for "${providerId}". Configure via ${providerSetupLocation(providerId)}.`);
  const apiKey = selected ? selected.authMethod === "api-key" : credential.secretRef && !credential.cachedToken;
  let auth: CodexAuth | CodexCatalogLogin;
  if (apiKey) {
    if (!credential.secretRef) throw new Error("Selected account API key is not configured");
    auth = transport ? { type: "apiKey", apiKey: credential.secretRef } : { mode: "apikey", apiKey: credential.secretRef };
  } else {
    if (selected && selected.authMethod !== "oauth") throw new Error("Selected account authentication is unsupported by Codex app-server");
    const bearer = await getProviderBearerToken(...credentialArgs);
    if ("error" in bearer) {
      throw new Error(`OAuth token error for "${providerId}": ${bearer.error}. Re-authenticate via ${providerSetupLocation(providerId)}.`);
    }
    const token = bearer.token;
    const claims = chatgptClaims(token);
    const id = claims?.chatgpt_account_id;
    const accountId = typeof id === "string" && id.trim() ? id : null;
    if ((transport || connection && connectionId !== `provider-default-${providerId}`) && !accountId) {
      throw new Error("Selected account has no supported ChatGPT identity; reconnect this account");
    }
    const planType = claims?.chatgpt_plan_type;
    auth = transport && accountId
      ? { type: "chatgptAuthTokens", accessToken: token, chatgptAccountId: accountId, ...(typeof planType === "string" ? { chatgptPlanType: planType } : {}) }
      : { mode: "oauth", accessToken: token, refreshToken: credential.refreshToken ?? "", accountId };
  }
  if (selected && !matchesScopedOAuthConnection(await prisma.aiProviderConnection.findUnique({ where: { connectionId: selected.connectionId, providerId } }), selected)) {
    throw new Error("Selected account changed during authentication — retry");
  }
  return auth;
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
