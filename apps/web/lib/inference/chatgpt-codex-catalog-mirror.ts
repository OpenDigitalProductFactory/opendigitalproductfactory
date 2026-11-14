// apps/web/lib/inference/chatgpt-codex-catalog-mirror.ts
//
// BI-AA618693: the chatgpt provider's routed transport is the Codex backend
// (/backend-api/codex/responses), which accepts only the models the same
// ChatGPT account's Codex catalog lists. Consumer discovery at
// /backend-api/models can refuse (HTTP 403 on the reference install), and the
// old fallback seeded a static gpt-5.4 that the transport rejects — so the
// router learned-excluded the endpoint and Build Studio's codex engine with
// it. Mirror the account-authoritative Codex CLI catalog instead.
//
// BI-F0ECD797: from 2026-11-05 the consumer endpoint stopped refusing and began
// returning the ChatGPT app catalog (gpt-6.1-sol-wm, gpt-5-6-thinking, ...).
// Those slugs are not served by the Codex transport ("not supported when using
// Codex with a ChatGPT account"), and their arrival retired every slug the
// transport does serve. The consumer list is never the chatgpt routing catalog:
// chatgpt always mirrors the Codex catalog, read with its own credential.

import { getErrorMessage } from "@/lib/shared/get-error-message";
import { persistDiscoveredInventory } from "./discovered-model-inventory";

type DiscoveryResult = { discovered: number; newCount: number; modelIds?: string[]; error?: string };

/** Discovery for the Codex/ChatGPT subscription providers via the ChatGPT backend /models endpoint. */
export async function discoverViaChatGptBackend(input: {
  providerId: string;
  authMethod: string;
  baseUrl?: string;
}): Promise<DiscoveryResult> {
  if (input.providerId === "chatgpt") return mirrorCodexCatalogForChatgpt({ authMethod: input.authMethod });
  const internals = await import("@/lib/inference/ai-provider-internals");
  const tokenResult = await internals.getProviderBearerToken(input.providerId);
  if ("error" in tokenResult) return { discovered: 0, newCount: 0, error: tokenResult.error };
  const result = await internals.discoverChatGptBackendModels(
    input.providerId,
    { Authorization: `Bearer ${tokenResult.token}` },
    input.baseUrl,
  );
  if (result.models.length === 0) {
    return { discovered: 0, newCount: 0, error: result.error ?? "Provider returned no models; previous inventory retained" };
  }
  return persistDiscoveredInventory(input.providerId, input.authMethod, result.models);
}

export async function mirrorCodexCatalogForChatgpt(input: {
  authMethod: string;
}): Promise<DiscoveryResult> {
  try {
    const { discoverCodexCliModels } = await import("./codex-cli-catalog-auth");
    // The chatgpt connection's own sign-in selects the account whose Codex
    // catalog the routed transport will serve; never borrow the codex account.
    const models = await discoverCodexCliModels("chatgpt");
    if (models.length === 0) {
      return { discovered: 0, newCount: 0, error: "Codex catalog listed no models; previous inventory retained" };
    }
    return await persistDiscoveredInventory("chatgpt", input.authMethod, models);
  } catch (err) {
    return { discovered: 0, newCount: 0, error: `Codex catalog mirror failed: ${getErrorMessage(err)}; previous inventory retained` };
  }
}
