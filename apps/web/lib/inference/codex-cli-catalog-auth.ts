import { prisma } from "@dpf/db";
import { getDecryptedCredential, getProviderBearerToken } from "@/lib/inference/ai-provider-internals";
import { discoverCodexCliModels as readCodexCliCatalog, type CodexCatalogLogin } from "@/lib/routing/codex-cli-model-catalog";

/** Token claims identify the already selected credential; they never grant data clearance. */
function externalLogin(token: string): CodexCatalogLogin {
  let claims: Record<string, unknown>;
  try {
    if (token.split(".").length !== 3) throw new Error();
    claims = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));
  } catch { throw new Error("Selected account token has no supported ChatGPT identity — reconnect this account"); }
  const auth = claims?.["https://api.openai.com/auth"] as Record<string, unknown> | undefined;
  const accountId = auth?.chatgpt_account_id;
  if (typeof accountId !== "string" || !accountId.trim()) {
    throw new Error("Selected account token has no ChatGPT account ID — reconnect this account");
  }
  return { type: "chatgptAuthTokens", accessToken: token, chatgptAccountId: accountId,
    ...(typeof auth?.chatgpt_plan_type === "string" ? { chatgptPlanType: auth.chatgpt_plan_type } : {}) };
}

/** Default and additional catalog reads use the same explicit, owned credential boundary. */
export async function resolveCodexCatalogAuth(providerId: string, connectionId?: string): Promise<CodexCatalogLogin> {
  if (!["codex", "chatgpt"].includes(providerId)) throw new Error("Unsupported Codex catalog provider");
  const selectedId = connectionId ?? `provider-default-${providerId}`;
  if (!selectedId.trim()) throw new Error("Provider connection identity is required");
  const connection = await prisma.aiProviderConnection.findUnique({ where: { connectionId: selectedId } });
  if (!connection || connection.providerId !== providerId || connection.status === "disabled" || !connection.credentialEntryId) {
    throw new Error("Selected provider account is unavailable");
  }
  const credential = await getDecryptedCredential(providerId, selectedId);
  if (!credential || credential.id !== connection.credentialEntryId) throw new Error("Selected account credential changed");
  let login: CodexCatalogLogin;
  if (connection.authMethod === "api-key") {
    if (!credential.secretRef) throw new Error("Selected account API key is not configured");
    login = { type: "apiKey", apiKey: credential.secretRef };
  } else if (connection.authMethod === "oauth") {
    const bearer = await getProviderBearerToken(providerId, selectedId);
    if ("error" in bearer) throw new Error("Selected account authentication failed — reconnect this account");
    login = externalLogin(bearer.token);
  } else { throw new Error("Selected account authentication is unsupported by Codex model discovery"); }
  const current = await prisma.aiProviderConnection.findUnique({ where: { connectionId: selectedId } });
  if (!current || current.providerId !== providerId || current.status === "disabled"
    || current.credentialEntryId !== connection.credentialEntryId || current.authMethod !== connection.authMethod
    || current.updatedAt.getTime() !== connection.updatedAt.getTime()) {
    throw new Error("Selected account changed during authentication — retry discovery");
  }
  return login;
}

/** Inference owns selected credentials; the inner catalog transport accepts only prepared auth. */
export async function discoverCodexCliModels(providerId = "codex", connectionId?: string) {
  return readCodexCliCatalog(await resolveCodexCatalogAuth(providerId, connectionId));
}
