import { prisma } from "@dpf/db";
import { getTestUrl, parseModelsResponse } from "./ai-provider-types";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { isLocalProviderId } from "@/lib/routing/provider-locality";
import { getDecryptedCredential, getProviderBearerToken, getProviderExtraHeaders, profileModelsInternal, upsertDiscoveredModels } from "./ai-provider-internals";
import { discoverCodexCliModels } from "@/lib/routing/codex-cli-model-catalog";

/** Account availability is independent of the shared vendor model catalog. No absence here retires another account's models. */
export async function discoverProviderAccountModels(connectionId: string): Promise<ActionResult<{ modelIds: string[] }>> {
  const connection = await prisma.aiProviderConnection.findUnique({ where: { connectionId } });
  if (!connection || connection.status === "disabled") return err("Provider account is unavailable");
  const provider = await prisma.modelProvider.findUnique({ where: { providerId: connection.providerId } });
  if (!provider) return err("Provider not found");
  const headers = getProviderExtraHeaders(connection.providerId);
  const subscriptionCli = connection.authMethod === "oauth" && ["codex", "chatgpt"].includes(connection.providerId);
  if (connection.authMethod === "api-key") {
    const credential = await getDecryptedCredential(connection.providerId, connectionId);
    if (!credential?.secretRef) return err("Account API key not configured");
    if (provider.authHeader) headers[provider.authHeader] = provider.authHeader === "Authorization" ? `Bearer ${credential.secretRef}` : credential.secretRef;
  } else if (!subscriptionCli && (connection.authMethod !== "local" || !isLocalProviderId(connection.providerId))) {
    const bearer = await getProviderBearerToken(connection.providerId, connectionId);
    if ("error" in bearer) return err(bearer.error);
    headers.Authorization = `Bearer ${bearer.token}`;
  }
  try {
    let models: Array<{ modelId: string; rawMetadata: Record<string, unknown> }>;
    if (subscriptionCli) {
      models = await discoverCodexCliModels(connection.providerId, connectionId);
    } else {
      const url = getTestUrl(provider);
      if (!url) return err("No provider discovery endpoint configured");
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return err(`Account discovery failed — HTTP ${response.status}`);
      models = parseModelsResponse(connection.providerId, await response.json());
    }
    const modelIds = [...new Set(models.map((model) => model.modelId))].sort();
    await upsertDiscoveredModels(connection.providerId, models);
    await profileModelsInternal(connection.providerId, modelIds);
    const recorded = await prisma.aiProviderConnection.updateMany({ where: { connectionId, updatedAt: connection.updatedAt, status: { not: "disabled" } }, data: { accessibleModelIds: modelIds, modelsVerifiedAt: new Date() } });
    if (recorded.count !== 1) return err("Account changed during discovery — retry with its current credentials");
    return ok({ modelIds });
  } catch (error) { return err(getErrorMessage(error)); }
}
