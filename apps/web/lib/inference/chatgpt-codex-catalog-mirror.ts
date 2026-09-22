// apps/web/lib/inference/chatgpt-codex-catalog-mirror.ts
//
// BI-AA618693: the chatgpt provider's routed transport is the Codex backend
// (/backend-api/codex/responses), which accepts only the models the same
// ChatGPT account's Codex catalog lists. Consumer discovery at
// /backend-api/models can refuse (HTTP 403 on the reference install), and the
// old fallback seeded a static gpt-5.4 that the transport rejects — so the
// router learned-excluded the endpoint and Build Studio's codex engine with
// it. Mirror the account-authoritative Codex CLI catalog instead.

import { getErrorMessage } from "@/lib/shared/get-error-message";

type DiscoveryResult = { discovered: number; newCount: number; modelIds?: string[]; error?: string };

/** Discovery for the Codex/ChatGPT subscription providers via the ChatGPT backend /models endpoint. */
export async function discoverViaChatGptBackend(input: {
  providerId: string;
  authMethod: string;
  baseUrl?: string;
}): Promise<DiscoveryResult> {
  const internals = await import("@/lib/inference/ai-provider-internals");
  const tokenResult = await internals.getProviderBearerToken(input.providerId);
  if ("error" in tokenResult) return { discovered: 0, newCount: 0, error: tokenResult.error };
  const result = await internals.discoverChatGptBackendModels(
    input.providerId,
    { Authorization: `Bearer ${tokenResult.token}` },
    input.baseUrl,
  );
  if (result.error && result.models.length === 0) {
    if (input.providerId === "chatgpt") {
      return mirrorCodexCatalogForChatgpt({ authMethod: input.authMethod, consumerError: result.error });
    }
    return { discovered: 0, newCount: 0, error: result.error };
  }
  const newCount = await internals.upsertDiscoveredModels(input.providerId, result.models);
  return { discovered: result.models.length, newCount };
}

export async function mirrorCodexCatalogForChatgpt(input: {
  authMethod: string;
  consumerError?: string;
}): Promise<DiscoveryResult> {
  const consumerError = input.consumerError ?? "consumer discovery returned no models";
  try {
    const [{ discoverCodexCliModels }, internals] = await Promise.all([
      import("@/lib/routing/codex-cli-model-catalog"),
      import("@/lib/inference/ai-provider-internals"),
    ]);
    const models = await discoverCodexCliModels("codex");
    if (models.length === 0) {
      return { discovered: 0, newCount: 0, error: `${consumerError}; Codex catalog listed no models` };
    }
    console.log(
      `[discovery] chatgpt: consumer backend refused (${JSON.stringify(consumerError)}); ` +
      `mirroring ${models.length} Codex-catalog model(s) of the shared ChatGPT account.`,
    );
    const modelIds = models.map((model) => model.modelId);
    const newCount = await internals.upsertDiscoveredModels("chatgpt", models);
    await internals.reconcileDiscoveredModelPresence("chatgpt", new Set(modelIds));
    await internals.readmitListedModels("chatgpt", input.authMethod, modelIds);
    return { discovered: models.length, newCount, modelIds };
  } catch (err) {
    return { discovered: 0, newCount: 0, error: `${consumerError}; Codex catalog mirror failed: ${getErrorMessage(err)}` };
  }
}
